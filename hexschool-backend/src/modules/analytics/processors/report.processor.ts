import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  REPORTS_QUEUE,
  type ReportJob,
} from '../../../queues/queues.constants';
import { ReportRunsRepository } from '../repositories/report-runs.repository';
import { ReportDeliveryService } from '../services/report-delivery.service';
import { ReportEngineService } from '../services/report-engine.service';

/**
 * The report worker (roadmap §4's async execution queue).
 *
 * It is deliberately three lines of orchestration: run, reload, deliver.
 * Everything that can fail is handled inside `ReportEngineService.execute`
 * — which records FAILED on the row rather than throwing — so this
 * processor almost never rejects, and BullMQ's retry is reserved for the
 * failures that really are transient (Redis dropped, the process
 * restarted mid-job).
 *
 * The row is **re-read** after execution rather than passed along, because
 * `execute` is what stamped the file, the row count and the duration onto
 * it, and the delivery message quotes all three.
 */
@Processor(REPORTS_QUEUE)
export class ReportProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportProcessor.name);

  constructor(
    private readonly engine: ReportEngineService,
    private readonly runs: ReportRunsRepository,
    private readonly delivery: ReportDeliveryService,
  ) {
    super();
  }

  async process(job: Job<ReportJob>): Promise<{ runId: string }> {
    const { runId } = job.data;
    await this.engine.execute(runId);

    const run = await this.runs.findById(runId);
    if (run?.status === 'DONE' && run.scheduleId) {
      const { sent } = await this.delivery.deliver(run);
      this.logger.log(`Report run ${runId} delivered to ${sent} recipient(s)`);
    }
    return { runId };
  }
}
