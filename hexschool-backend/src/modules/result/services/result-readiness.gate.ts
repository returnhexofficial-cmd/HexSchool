import { Injectable } from '@nestjs/common';
import { ResultRunStatus, ResultStatus } from '../../../common/constants';
import type {
  ExamResultGate,
  ResultReadiness,
} from '../../exam/services/exam.gates';
import { MarksRepository } from '../repositories/marks.repository';
import { ResultRunsRepository } from '../repositories/result-runs.repository';
import { ResultsRepository } from '../repositories/results.repository';

/**
 * The real `EXAM_RESULT_GATE` — Module 14 shipped this token bound to a
 * no-op that allowed publication and logged an apology. This is the
 * provider that makes the roadmap's "cannot PUBLISH before processing is
 * complete" true, with no change to any caller (the M08 →M13
 * `TIMETABLE_CONFLICT_CHECKER` precedent, re-applied exactly).
 *
 * **Where it is bound matters.** This class lives in the result module
 * but is provided *inside* `ExamModule` over re-provisioned
 * repositories: `ResultModule` imports `ExamModule` for the exam
 * aggregate, so binding it the other way round would close a cycle. The
 * repositories are stateless (they hold only `PrismaService`), which is
 * what makes re-provisioning safe — the same trick M08/M11/M13 used.
 *
 * Three things are checked, in the order a user would ask them:
 *   1. has anything been processed at all?
 *   2. did the last run actually finish?
 *   3. have the marks moved since — i.e. are the results on file still a
 *      description of the marks on file?
 */
@Injectable()
export class ResultReadinessGate implements ExamResultGate {
  constructor(
    private readonly results: ResultsRepository,
    private readonly runs: ResultRunsRepository,
    private readonly marks: MarksRepository,
  ) {}

  async canPublish(examId: string): Promise<ResultReadiness> {
    const [total, byStatus, latest, lastCompleted, lastMarkChange] =
      await Promise.all([
        this.results.countForExam(examId),
        this.results.countByStatus(examId),
        this.runs.findLatest(examId),
        this.runs.findLatestCompleted(examId),
        this.marks.lastChangedAt(examId),
      ]);

    if (total === 0) {
      return {
        ready: false,
        reason:
          'No results have been processed for this exam — run processing before publishing',
        detail: { results: 0 },
      };
    }

    if (
      latest &&
      (latest.status === ResultRunStatus.QUEUED ||
        latest.status === ResultRunStatus.RUNNING)
    ) {
      return {
        ready: false,
        reason: `A processing run is still ${latest.status} — wait for it to finish`,
        detail: { runId: latest.id, status: latest.status },
      };
    }

    if (latest?.status === ResultRunStatus.FAILED) {
      return {
        ready: false,
        reason: `The last processing run failed: ${latest.error ?? 'unknown error'}`,
        detail: { runId: latest.id },
      };
    }

    // A mark edited after the last completed run means the numbers about
    // to go home with students were computed from something else.
    if (
      lastCompleted?.finishedAt &&
      lastMarkChange &&
      lastMarkChange > lastCompleted.finishedAt
    ) {
      return {
        ready: false,
        reason:
          'Marks have changed since the last processing run — reprocess before publishing',
        detail: {
          lastProcessedAt: lastCompleted.finishedAt.toISOString(),
          lastMarkChangeAt: lastMarkChange.toISOString(),
        },
      };
    }

    const counts = Object.fromEntries(
      byStatus.map((row) => [row.status, row.count]),
    );
    const incomplete = counts[ResultStatus.INCOMPLETE] ?? 0;

    // INCOMPLETE results are allowed through deliberately: a school
    // publishes a class whose transferred-out student will never have a
    // full sheet. The count is surfaced so the publish dialog can say so.
    return {
      ready: true,
      detail: {
        results: total,
        incomplete,
        byStatus: counts,
        lastProcessedAt: lastCompleted?.finishedAt?.toISOString() ?? null,
      },
    };
  }
}
