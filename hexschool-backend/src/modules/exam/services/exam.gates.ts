import { Injectable, Logger } from '@nestjs/common';

/**
 * Cross-module hooks this module declares but does not implement — the
 * same DI-token pattern M08 used for `TIMETABLE_CONFLICT_CHECKER`, which
 * M13 later bound for real.
 *
 * Both are bound to no-ops here so the exam cycle is fully usable today;
 * Modules 15 and 16 replace the providers without touching a caller.
 */

// ── Module 15: result processing ─────────────────────────────────────

export interface ResultReadiness {
  ready: boolean;
  /** Why publication is refused — surfaced verbatim in the 409. */
  reason?: string;
  /** Progress detail for the UI (papers processed / total). */
  detail?: Record<string, unknown>;
}

export interface ExamResultGate {
  /** May this exam move PROCESSING → PUBLISHED? */
  canPublish(examId: string, schoolId: string): Promise<ResultReadiness>;
}

export const EXAM_RESULT_GATE = Symbol('EXAM_RESULT_GATE');

/**
 * Until Module 15 exists there is nothing to process, so publication is
 * allowed and logged. The roadmap's "can't PUBLISH before Module 15
 * processing complete" becomes true the moment M15 binds its own
 * provider to this token — deliberately NOT a hard refusal today, which
 * would make the status machine untestable and the module unusable.
 */
@Injectable()
export class NoopExamResultGate implements ExamResultGate {
  private readonly logger = new Logger(NoopExamResultGate.name);

  canPublish(examId: string): Promise<ResultReadiness> {
    this.logger.log(
      `Publishing exam ${examId} without result processing — Module 15 will gate this`,
    );
    return Promise.resolve({
      ready: true,
      detail: { processor: 'noop', module: 15 },
    });
  }
}

// ── Module 16: fees / dues ───────────────────────────────────────────

export interface DuesStatus {
  enrollmentId: string;
  hasDues: boolean;
  outstanding?: number;
}

export interface ExamDuesGate {
  /** Outstanding-dues status per candidate, for the admit-card block. */
  check(enrollmentIds: string[], schoolId: string): Promise<DuesStatus[]>;
}

export const EXAM_DUES_GATE = Symbol('EXAM_DUES_GATE');

/**
 * No fees module yet, so nobody has dues and `exam.admit_card_block_dues`
 * has nothing to block on. Module 16 binds the real ledger check here and
 * the setting starts biting without an admit-card code change.
 */
@Injectable()
export class NoopExamDuesGate implements ExamDuesGate {
  check(enrollmentIds: string[]): Promise<DuesStatus[]> {
    return Promise.resolve(
      enrollmentIds.map((enrollmentId) => ({
        enrollmentId,
        hasDues: false,
      })),
    );
  }
}
