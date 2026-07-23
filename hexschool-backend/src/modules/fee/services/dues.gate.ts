import { Injectable } from '@nestjs/common';
import type { DuesStatus, ExamDuesGate } from '../../exam/services/exam.gates';
import { InvoicesRepository } from '../repositories/invoices.repository';

/**
 * The real `EXAM_DUES_GATE` — Module 14 shipped this token bound to a
 * no-op that reported nobody as owing anything, so
 * `exam.admit_card_block_dues` was inert. This is the provider that
 * makes it bite, with no change to any caller (the M08→M13
 * `TIMETABLE_CONFLICT_CHECKER` and M14→M15 `EXAM_RESULT_GATE`
 * precedents, re-applied a third time).
 *
 * **Where it is bound matters.** This class lives in the fee module but
 * is provided *inside* `ExamModule` over a re-provisioned
 * `InvoicesRepository`: `FeeModule` imports `ExamModule`-adjacent
 * services, and binding it the other way round would risk a cycle. The
 * repository is stateless (it holds only `PrismaService`), which is what
 * makes re-provisioning safe.
 *
 * Deliberately one grouped query however many candidates are asked
 * about — the admit-card batch calls this with a whole class.
 */
@Injectable()
export class InvoiceDuesGate implements ExamDuesGate {
  constructor(private readonly invoices: InvoicesRepository) {}

  async check(
    enrollmentIds: string[],
    schoolId: string,
  ): Promise<DuesStatus[]> {
    if (enrollmentIds.length === 0) return [];

    const outstanding = await this.invoices.outstandingByEnrollment(
      enrollmentIds,
      schoolId,
    );

    return enrollmentIds.map((enrollmentId) => {
      const amount = outstanding.get(enrollmentId) ?? 0;
      return {
        enrollmentId,
        // A rounding artefact must never block an admit card, so the
        // test is "owes more than a paisa", not "is non-zero".
        hasDues: amount > 0.009,
        outstanding: amount > 0 ? amount : 0,
      };
    });
  }
}
