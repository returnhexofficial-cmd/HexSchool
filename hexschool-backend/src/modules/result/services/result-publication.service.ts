import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ResultPublication, ResultStatus } from '@prisma/client';
import { ExamStatus } from '../../../common/constants';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { NotificationService } from '../../communication/services/notification.service';
import { ExamsService } from '../../exam/services/exams.service';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { StudentGuardiansRepository } from '../../student/repositories/student-guardians.repository';
import { MarkCorrectionsRepository } from '../repositories/mark-corrections.repository';
import { ResultPublicationsRepository } from '../repositories/result-publications.repository';
import { ResultsRepository } from '../repositories/results.repository';
import { PublishResultsDto, UnpublishResultsDto } from '../dto';
import { ResultReadinessGate } from './result-readiness.gate';

export interface PublicationSummary {
  publication: ResultPublication;
  results: number;
  smsQueued: number;
}

/**
 * Publishing results (roadmap M15 §4/§6).
 *
 * The design decision worth stating: **visibility is the active
 * publication row, not `exams.status`.** Module 14's status machine
 * deliberately cannot rewind past PUBLISHED — a published result is
 * corrected by re-issue, not by a quiet rewind of a column — so
 * "unpublish" needed a switch of its own. Unpublishing revokes the
 * active version; republishing after a correction writes version N+1
 * with its own note, which is what the roadmap's "corrections create a
 * new publication version with a visible changelog" means on disk.
 *
 * A partial unique index guarantees at most one active version, because
 * every reader resolves "the" active publication.
 */
@Injectable()
export class ResultPublicationService {
  private readonly logger = new Logger(ResultPublicationService.name);

  constructor(
    private readonly publications: ResultPublicationsRepository,
    private readonly results: ResultsRepository,
    private readonly corrections: MarkCorrectionsRepository,
    private readonly studentGuardians: StudentGuardiansRepository,
    private readonly exams: ExamsService,
    private readonly gate: ResultReadinessGate,
    private readonly auditContext: AuditContextService,
    private readonly notifications: NotificationService,
    private readonly schools: SchoolsRepository,
  ) {}

  async history(examId: string, schoolId: string) {
    await this.exams.loadExam(examId, schoolId);
    const [publications, active] = await Promise.all([
      this.publications.findHistory(examId),
      this.publications.findActive(examId),
    ]);
    return { publications, active, published: active !== null };
  }

  /**
   * Publish (or republish) an exam's results.
   *
   * The first publication also walks the exam's status machine to
   * PUBLISHED, which is where Module 14's `EXAM_RESULT_GATE` — bound for
   * real by this module — asks whether the results are actually
   * processed. A republish leaves the status alone: the exam is already
   * published, and what changed is the version.
   */
  async publish(
    examId: string,
    dto: PublishResultsDto,
    actor: AccessTokenPayload,
  ): Promise<PublicationSummary> {
    const schoolId = actor.schoolId;
    const exam = await this.exams.loadExam(examId, schoolId);

    const results = await this.results.findForExam(examId);
    if (results.length === 0) {
      throw new ConflictException(
        `${exam.name} has no processed results — run processing first`,
      );
    }

    // Ask the readiness gate BEFORE writing anything.
    //
    // Relying on `ExamsService.changeStatus` to consult it further down
    // was a real defect the e2e suite caught: the publication row was
    // already committed by then, so a refused publish left an ACTIVE
    // publication behind — and a REPUBLISH never reached the status
    // machine at all, so it was never gated. Checking here covers both.
    // (The gate reads everything it needs off the exam id; the
    // `schoolId` in the `ExamResultGate` interface is for future
    // implementations that need it.)
    const readiness = await this.gate.canPublish(examId);
    if (!readiness.ready) {
      throw new ConflictException({
        message: readiness.reason ?? 'Results are not ready to publish',
        details: readiness.detail ?? {},
      });
    }

    const channels = {
      portal: dto.channels?.portal ?? true,
      website: dto.channels?.website ?? false,
      sms: dto.channels?.sms ?? false,
    };

    const previous = await this.publications.findActive(examId);
    const publication = await this.publications.withTransaction(async (tx) => {
      if (previous) {
        await this.publications.revokeActive(examId, actor.sub, tx);
      }
      const version = await this.publications.nextVersion(examId, tx);
      const created = await this.publications.create(
        {
          schoolId,
          examId,
          version,
          channels,
          isActive: true,
          note:
            dto.note ??
            (previous ? await this.changelog(examId, previous) : null),
          publishedBy: actor.sub,
        },
        tx,
      );
      await this.results.setPublishedAt(examId, new Date(), tx);
      return created;
    });

    // First publication only — the status machine has no second step.
    if (exam.status !== ExamStatus.PUBLISHED) {
      await this.exams.changeStatus(
        examId,
        { status: ExamStatus.PUBLISHED, reason: 'Results published' },
        actor,
      );
    }

    const smsQueued = channels.sms
      ? await this.queueResultSms(exam.name, results, schoolId)
      : 0;

    this.auditContext.set({
      entityType: 'ResultPublication',
      entityId: publication.id,
      oldValues: previous ? { version: previous.version } : undefined,
      newValues: {
        examId,
        exam: exam.name,
        version: publication.version,
        channels,
        results: results.length,
        smsQueued,
      },
    });

    return { publication, results: results.length, smsQueued };
  }

  /**
   * Retire the active publication. The results stay exactly as
   * processed — this hides them from the portal and the public search,
   * it does not delete or restate anything.
   */
  async unpublish(
    examId: string,
    dto: UnpublishResultsDto,
    actor: AccessTokenPayload,
  ): Promise<{ revoked: number }> {
    const exam = await this.exams.loadExam(examId, actor.schoolId);
    const active = await this.publications.findActive(examId);
    if (!active) {
      throw new ConflictException(`${exam.name}'s results are not published`);
    }

    const revoked = await this.publications.withTransaction(async (tx) => {
      const count = await this.publications.revokeActive(examId, actor.sub, tx);
      await this.results.setPublishedAt(examId, null, tx);
      return count;
    });

    this.auditContext.set({
      entityType: 'ResultPublication',
      entityId: active.id,
      oldValues: { version: active.version, isActive: true },
      newValues: { isActive: false, reason: dto.reason },
    });

    return { revoked };
  }

  // ── internals ───────────────────────────────────────────────────────

  /**
   * What changed since the version being replaced. Written onto the new
   * publication so the history reads as a changelog rather than as a
   * list of identical timestamps.
   */
  private async changelog(
    examId: string,
    previous: ResultPublication,
  ): Promise<string> {
    const corrections = await this.corrections.countForExamSince(
      examId,
      previous.publishedAt,
    );
    return corrections > 0
      ? `Re-issued after ${corrections} mark correction(s)`
      : 'Re-issued after reprocessing';
  }

  /**
   * The "GPA 4.83, Merit 3" SMS (roadmap §4). **Retro-wired to M17**:
   * sends through `NotificationService.send` with the `RESULT_PUBLISHED`
   * template — admin-editable body, credit accounting, delivery log —
   * instead of a raw queue job. Still never awaited on the delivery, so a
   * slow gateway cannot fail a publication (the M07 precedent).
   *
   * WITHHELD results are skipped — the whole point of withholding is
   * that the number does not go out.
   */
  private async queueResultSms(
    examName: string,
    results: Awaited<ReturnType<ResultsRepository['findForExam']>>,
    schoolId: string,
  ): Promise<number> {
    const [primaries, school] = await Promise.all([
      this.studentGuardians.findPrimaryForStudents(
        results.map((r) => r.enrollment.student.id),
      ),
      this.schools.findById(schoolId),
    ]);
    const phoneByStudent = new Map(
      primaries.map((link) => [link.studentId, link.guardian.phone]),
    );
    let queued = 0;

    for (const result of results) {
      if (result.status === ResultStatus.WITHHELD) continue;

      const phone = phoneByStudent.get(result.enrollment.student.id);
      if (!phone) continue;

      try {
        const row = await this.notifications.send({
          schoolId,
          code: 'RESULT_PUBLISHED',
          channel: 'SMS',
          recipient: { type: 'GUARDIAN', destination: phone },
          vars: {
            student_name:
              `${result.enrollment.student.firstName} ${result.enrollment.student.lastName}`.trim(),
            exam: examName,
            gpa: Number(result.gpa).toFixed(2),
            grade: result.grade,
            merit: String(result.meritPositionClass ?? '—'),
            school: school?.name ?? '',
          },
        });
        if (row) queued += 1;
      } catch (error) {
        this.logger.warn(
          `Could not queue result SMS for ${result.enrollmentId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return queued;
  }
}
