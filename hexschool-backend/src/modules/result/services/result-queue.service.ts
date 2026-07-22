import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ResultRun } from '@prisma/client';
import type { Queue } from 'bullmq';
import {
  RESULTS_QUEUE,
  ResultProcessingJob,
} from '../../../queues/queues.constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { ProcessResultsDto } from '../dto';
import { ResultProcessingService } from './result-processing.service';

export interface DispatchedRun {
  run: ResultRun;
  /** How the run is executing — the UI polls either way. */
  mode: 'queued' | 'inline';
}

/**
 * Dispatch a processing run (roadmap M15 §4 asks for BullMQ).
 *
 * The run row is created first and the queue only carries its id, so
 * progress is durable in Postgres and `GET /process/status` keeps
 * answering across a Redis restart.
 *
 * **If the queue cannot take the job, the run executes inline.** A
 * school with Redis down should still be able to process a class's
 * results — a queue is a latency optimisation here, not a correctness
 * requirement, and the alternative is a run stuck at QUEUED forever with
 * nothing to explain why (the M07 "delivery must never block the
 * mutation" reasoning, inverted: here the work must not be *lost*).
 */
@Injectable()
export class ResultQueueService {
  private readonly logger = new Logger(ResultQueueService.name);

  constructor(
    private readonly processing: ResultProcessingService,
    @InjectQueue(RESULTS_QUEUE)
    private readonly queue: Queue<ResultProcessingJob>,
  ) {}

  async dispatch(
    examId: string,
    dto: ProcessResultsDto,
    actor: AccessTokenPayload,
  ): Promise<DispatchedRun> {
    const run = await this.processing.enqueue(examId, dto, actor);

    try {
      await this.queue.add(
        'process',
        { runId: run.id, schoolId: actor.schoolId },
        { jobId: run.id },
      );
      return { run, mode: 'queued' };
    } catch (error) {
      this.logger.warn(
        `Could not queue result run ${run.id} (${
          error instanceof Error ? error.message : String(error)
        }) — running inline`,
      );
      const executed = await this.processing.execute(run.id, actor.schoolId);
      return { run: executed, mode: 'inline' };
    }
  }
}
