import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  RESULTS_QUEUE,
  ResultProcessingJob,
} from '../../../queues/queues.constants';
import { ResultProcessingService } from '../services/result-processing.service';

/**
 * Executes queued processing runs. Deliberately thin: every decision —
 * idempotency, the merit second pass, the frozen grade scale — lives in
 * `ResultProcessingService`, which the correction flow also calls
 * directly. The processor only decides *when*.
 *
 * A failure is recorded on the run row by the service before it
 * rethrows, so BullMQ's retry and the user-visible FAILED status stay in
 * agreement.
 */
@Processor(RESULTS_QUEUE)
export class ResultProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(ResultProcessingProcessor.name);

  constructor(private readonly processing: ResultProcessingService) {
    super();
  }

  async process(job: Job<ResultProcessingJob>): Promise<void> {
    const { runId, schoolId } = job.data;
    const run = await this.processing.execute(runId, schoolId);
    this.logger.log(
      `Result run ${runId}: ${run.status} (${run.processed}/${run.total} candidates)`,
    );
  }
}
