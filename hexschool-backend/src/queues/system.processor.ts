import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SYSTEM_QUEUE } from './queues.constants';

/**
 * Demo worker proving the BullMQ wiring end-to-end. Real heavy work
 * (SMS, email, PDF generation) gets its own queues from Module 02 onward.
 */
@Processor(SYSTEM_QUEUE)
export class SystemProcessor extends WorkerHost {
  private readonly logger = new Logger(SystemProcessor.name);

  process(job: Job): Promise<{ ok: true }> {
    this.logger.log(`Processing system job ${job.id ?? '?'} (${job.name})`);
    return Promise.resolve({ ok: true });
  }
}
