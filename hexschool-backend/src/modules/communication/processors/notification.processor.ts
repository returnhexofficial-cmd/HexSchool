import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  NOTIFICATIONS_QUEUE,
  NotificationJob,
} from '../../../queues/queues.constants';
import { NotificationDispatchService } from '../services/notification-dispatch.service';

/**
 * The real notification worker (Module 17), replacing the M02 interim
 * log-only processor. Handles both the new `notification` job (a stored
 * row the dispatcher renders and sends) and the legacy raw `sms`/`email`
 * jobs still pushed by OTP and credential flows.
 *
 * A thrown error propagates to BullMQ, which retries with the queue's
 * exponential backoff (roadmap M17 §6 "auto-retry ×2 with backoff"); the
 * dispatcher marks a definitive gateway rejection FAILED without a throw,
 * so only transient failures burn retries. When the last attempt fails,
 * the row is force-marked FAILED so it never lingers QUEUED.
 */
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly dispatch: NotificationDispatchService) {
    super();
  }

  async process(job: Job<NotificationJob>): Promise<void> {
    const data = job.data;
    try {
      if (data.type === 'notification') {
        await this.dispatch.dispatch(data.notificationId);
        return;
      }
      if (data.type === 'email') {
        await this.dispatch.dispatchRaw(
          'EMAIL',
          data.to,
          data.text,
          data.subject,
        );
        return;
      }
      // data.type === 'sms'
      await this.dispatch.dispatchRaw('SMS', data.to, data.text);
    } catch (error) {
      const attempts = job.opts.attempts ?? 1;
      // On the final attempt, force the row FAILED so it is not stuck
      // QUEUED forever (only the `notification` job owns a row to mark).
      if (job.attemptsMade + 1 >= attempts && data.type === 'notification') {
        await this.dispatch.forceFail(
          data.notificationId,
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
  }
}
