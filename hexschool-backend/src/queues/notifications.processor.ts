import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { createTransport, Transporter } from 'nodemailer';
import { NOTIFICATIONS_QUEUE, NotificationJob } from './queues.constants';

/**
 * Interim notification worker (Module 02): email goes out via SMTP
 * (Mailpit in dev), SMS is logged only — the real BD SMS gateway adapter
 * arrives with Module 17. Jobs retry with exponential backoff (queue
 * defaults), satisfying "OTP gateway down → queue retries" (M02 §8).
 */
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);
  private readonly mailer: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    super();
    this.from = config.getOrThrow<string>('smtp.from');
    const user = config.get<string>('smtp.user');
    this.mailer = createTransport({
      host: config.getOrThrow<string>('smtp.host'),
      port: config.getOrThrow<number>('smtp.port'),
      secure: false,
      auth: user ? { user, pass: config.get<string>('smtp.pass') } : undefined,
    });
  }

  async process(job: Job<NotificationJob>): Promise<void> {
    const data = job.data;
    if (data.type === 'email') {
      await this.mailer.sendMail({
        from: this.from,
        to: data.to,
        subject: data.subject,
        text: data.text,
      });
      this.logger.log(`Email sent to ${data.to} (${data.subject})`);
      return;
    }
    // SMS gateway lands in Module 17 — log-only until then. Never log the
    // message body in prod paths once real codes flow through here.
    this.logger.log(`[SMS:log-only] to=${data.to} text="${data.text}"`);
  }
}
