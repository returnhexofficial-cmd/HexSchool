import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssignmentStatus, Prisma, SubmissionStatus } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { EnrollmentsService } from '../../enrollment/services/enrollments.service';
import { attachmentSetIssues } from '../calc/attachment.util';
import {
  bulkEvaluationIssues,
  evaluationIssues,
  returnIssues,
  roundMarks,
  type EvaluationContext,
} from '../calc/evaluation.engine';
import {
  REFUSAL_MESSAGES,
  submissionVerdict,
} from '../calc/submission-window.engine';
import type {
  BulkEvaluateDto,
  EvaluateSubmissionDto,
  ReturnSubmissionDto,
  SubmitAssignmentDto,
} from '../dto';
import { AssignmentsRepository } from '../repositories/assignments.repository';
import {
  SubmissionsRepository,
  type SubmissionWithStudent,
} from '../repositories/submissions.repository';
import { AssignmentPolicyService } from './assignment-policy.service';
import { AssignmentSettingsService } from './assignment-settings.service';
import { AssignmentsService } from './assignments.service';

export interface SubmissionGridRow {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  studentUid: string;
  rollNo: number;
  /** NULL when this candidate has not handed anything in. */
  submission: SubmissionWithStudent | null;
  /** True for a submitter who is no longer on the section's roster. */
  transferredOut: boolean;
}

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly submissions: SubmissionsRepository,
    private readonly assignments: AssignmentsRepository,
    private readonly assignmentsService: AssignmentsService,
    private readonly policy: AssignmentPolicyService,
    private readonly config: AssignmentSettingsService,
    private readonly enrollments: EnrollmentsService,
    private readonly audit: AuditContextService,
  ) {}

  // ── teacher side ────────────────────────────────────────────────────

  /**
   * The evaluation grid: **every candidate the section holds, plus every
   * candidate who submitted**, so a student who transferred out after
   * handing work in is still shown with their work rather than vanishing
   * from the teacher's list along with it (roadmap §8).
   */
  async grid(
    assignmentId: string,
    actor: AccessTokenPayload,
  ): Promise<{
    rows: SubmissionGridRow[];
    stats: Awaited<ReturnType<AssignmentsService['statsFor']>>;
  }> {
    const assignment = await this.assignmentsService.findOrFail(
      assignmentId,
      actor.schoolId,
    );
    await this.policy.assertMayTouch(actor, assignment);

    const [roster, submissions] = await Promise.all([
      this.enrollments.getSectionStudents(assignment.sectionId, actor.schoolId),
      this.submissions.findForAssignment(assignmentId, actor.schoolId),
    ]);

    const byEnrollment = new Map(submissions.map((s) => [s.enrollmentId, s]));
    const rows: SubmissionGridRow[] = roster.map((e) => ({
      enrollmentId: e.id,
      studentId: e.student.id,
      studentName: `${e.student.firstName} ${e.student.lastName}`.trim(),
      studentUid: e.student.studentUid,
      rollNo: e.rollNo,
      submission: byEnrollment.get(e.id) ?? null,
      transferredOut: false,
    }));

    const rosterIds = new Set(roster.map((e) => e.id));
    for (const s of submissions) {
      if (rosterIds.has(s.enrollmentId)) continue;
      rows.push({
        enrollmentId: s.enrollmentId,
        studentId: s.enrollment.student.id,
        studentName:
          `${s.enrollment.student.firstName} ${s.enrollment.student.lastName}`.trim(),
        studentUid: s.enrollment.student.studentUid,
        rollNo: s.enrollment.rollNo,
        submission: s,
        transferredOut: true,
      });
    }

    rows.sort((a, b) => a.rollNo - b.rollNo);

    return {
      rows,
      stats: await this.assignmentsService.statsFor(assignment),
    };
  }

  async evaluate(
    id: string,
    dto: EvaluateSubmissionDto,
    actor: AccessTokenPayload,
  ) {
    const { submission, ctx } = await this.evaluationContext(id, actor);

    const issues = evaluationIssues(
      { submissionId: id, marks: dto.marks, feedback: dto.feedback },
      ctx,
    );
    if (issues.length > 0) this.refuse(issues);

    const updated = await this.submissions.evaluate(id, {
      marks:
        dto.marks === undefined || dto.marks === null
          ? null
          : roundMarks(dto.marks),
      feedback: dto.feedback?.trim() || null,
      status: SubmissionStatus.EVALUATED,
      evaluatedBy: actor.sub,
      evaluatedAt: new Date(),
    });

    this.audit.set({
      entityType: 'AssignmentSubmission',
      entityId: id,
      oldValues: { marks: submission.marks, status: submission.status },
      newValues: { marks: updated.marks, status: updated.status },
    });

    return updated;
  }

  /** Hand the work back for revision (roadmap §4 return-for-revision). */
  async returnForRevision(
    id: string,
    dto: ReturnSubmissionDto,
    actor: AccessTokenPayload,
  ) {
    const { submission, ctx } = await this.evaluationContext(id, actor);

    const issues = returnIssues(id, dto.feedback, ctx);
    if (issues.length > 0) this.refuse(issues);

    // The mark goes with it: the work being returned is the work the
    // mark described, and leaving a number on a submission the student
    // is about to replace would print a grade for something nobody can
    // read any more (the M15 "re-entry clears the grade" rule).
    const updated = await this.submissions.evaluate(id, {
      marks: null,
      feedback: dto.feedback.trim(),
      status: SubmissionStatus.RETURNED,
      evaluatedBy: actor.sub,
      evaluatedAt: new Date(),
    });

    this.audit.set({
      entityType: 'AssignmentSubmission',
      entityId: id,
      oldValues: { status: submission.status },
      newValues: { status: SubmissionStatus.RETURNED },
    });

    return updated;
  }

  /**
   * The bulk grid (roadmap §4). All-or-nothing inside one transaction,
   * with **every** bad cell returned at once — the M15 mark-entry rule.
   */
  async evaluateBulk(
    assignmentId: string,
    dto: BulkEvaluateDto,
    actor: AccessTokenPayload,
  ): Promise<{ updated: number }> {
    const assignment = await this.assignmentsService.findOrFail(
      assignmentId,
      actor.schoolId,
    );
    await this.policy.assertMayTouch(actor, assignment);
    await this.assertMayEvaluate(actor);

    const ctx: EvaluationContext = {
      fullMarks:
        assignment.fullMarks === null ? null : Number(assignment.fullMarks),
      closed: assignment.status === AssignmentStatus.CLOSED,
      mayEditLocked: await this.policy.has(
        actor,
        'assignment.evaluate.override',
      ),
    };

    const issues = bulkEvaluationIssues(dto.rows, ctx);

    // Every id in the batch must belong to THIS assignment. Without the
    // check a teacher who legitimately holds one section could post
    // another section's submission ids into the payload and mark them.
    const owned = await this.submissions.findByIds(
      dto.rows.map((r) => r.submissionId),
      actor.schoolId,
    );
    const ownedIds = new Set(
      owned.filter((s) => s.assignmentId === assignmentId).map((s) => s.id),
    );
    for (const row of dto.rows) {
      if (!ownedIds.has(row.submissionId)) {
        issues.push({
          submissionId: row.submissionId,
          field: 'status',
          message: 'This submission does not belong to this assignment',
        });
      }
    }

    if (issues.length > 0) this.refuse(issues);

    const evaluatedAt = new Date();
    await this.submissions.withTransaction(async (tx) => {
      for (const row of dto.rows) {
        await this.submissions.evaluate(
          row.submissionId,
          {
            marks:
              row.marks === undefined || row.marks === null
                ? null
                : roundMarks(row.marks),
            feedback: row.feedback?.trim() || null,
            status: SubmissionStatus.EVALUATED,
            evaluatedBy: actor.sub,
            evaluatedAt,
          },
          tx,
        );
      }
    });

    this.audit.set({
      entityType: 'Assignment',
      entityId: assignmentId,
      newValues: { evaluated: dto.rows.length },
    });

    return { updated: dto.rows.length };
  }

  // ── student side ────────────────────────────────────────────────────

  /**
   * A student hands work in. `enrollmentId` is resolved by the caller
   * from the logged-in account — never from the request body, which is
   * what stops one student submitting as another. A **parent may not
   * reach this at all**: the school's record of who did the work has to
   * mean what it says.
   */
  async submit(
    assignmentId: string,
    enrollmentId: string,
    dto: SubmitAssignmentDto,
    actor: AccessTokenPayload,
  ) {
    const cfg = await this.config.load(actor.schoolId);
    const assignment = await this.assignmentsService.findOrFail(
      assignmentId,
      actor.schoolId,
    );

    // The candidate must be in the section the work was set for. A
    // published assignment is visible to its section and nobody else.
    const enrollment = await this.enrollments.getSectionStudents(
      assignment.sectionId,
      actor.schoolId,
    );
    if (!enrollment.some((e) => e.id === enrollmentId)) {
      throw new ForbiddenException(
        'This assignment was not set for your section',
      );
    }

    const existing = await this.submissions.findOneFor(
      assignmentId,
      enrollmentId,
    );

    const verdict = submissionVerdict({
      status: assignment.status,
      dueAt: assignment.dueAt.getTime(),
      now: Date.now(),
      allowLate: assignment.allowLate,
      allowResubmission: cfg.allowResubmission,
      resubmissionUntilDue: cfg.resubmissionUntilDue,
      existing: existing ? { status: existing.status } : null,
    });
    if (!verdict.allowed) {
      throw new ConflictException(REFUSAL_MESSAGES[verdict.reason!]);
    }

    const attachments = dto.attachments ?? [];
    const attachmentProblems = attachmentSetIssues(attachments, cfg.limits);
    if (attachmentProblems.length > 0) {
      throw new BadRequestException({
        message: 'Some attachments were refused',
        details: { issues: attachmentProblems },
      });
    }

    const text = dto.textAnswer?.trim() || null;
    if (!text && attachments.length === 0) {
      throw new BadRequestException(
        'Write an answer or attach a file — an empty submission is not a submission',
      );
    }

    const saved = await this.submissions.upsertSubmission(
      { assignmentId, enrollmentId },
      {
        schoolId: actor.schoolId,
        textAnswer: text,
        attachmentUrls: attachments as unknown as Prisma.InputJsonValue,
        submittedAt: new Date(),
        isLate: verdict.late,
        // The engine returns 2 for any resubmission; the real count is
        // one more than what is on file, so a fourth attempt reads as 4.
        attempt: existing ? existing.attempt + 1 : 1,
        status: verdict.nextStatus,
        actorId: actor.sub,
      },
    );

    this.audit.set({
      entityType: 'AssignmentSubmission',
      entityId: saved.id,
      newValues: {
        assignment: assignment.title,
        attempt: saved.attempt,
        isLate: saved.isLate,
      },
    });

    return saved;
  }

  async findDetailOrFail(id: string, schoolId: string) {
    const found = await this.submissions.findDetail(id, schoolId);
    if (!found) throw new NotFoundException(`Submission ${id} not found`);
    return found;
  }

  /**
   * Reading ONE submission by id. Goes through the same policy check the
   * grid does, because `assignment.view` is held by every teacher in the
   * school and a bare school-scoped read would let any of them page
   * through another section's work by id.
   */
  async detail(id: string, actor: AccessTokenPayload) {
    const submission = await this.findDetailOrFail(id, actor.schoolId);
    const assignment = await this.assignmentsService.findOrFail(
      submission.assignmentId,
      actor.schoolId,
    );
    await this.policy.assertMayTouch(actor, assignment);
    return submission;
  }

  // ── internals ───────────────────────────────────────────────────────

  private async evaluationContext(id: string, actor: AccessTokenPayload) {
    const submission = await this.findDetailOrFail(id, actor.schoolId);
    const assignment = await this.assignmentsService.findOrFail(
      submission.assignmentId,
      actor.schoolId,
    );
    await this.policy.assertMayTouch(actor, assignment);
    await this.assertMayEvaluate(actor);

    const ctx: EvaluationContext = {
      fullMarks:
        assignment.fullMarks === null ? null : Number(assignment.fullMarks),
      closed: assignment.status === AssignmentStatus.CLOSED,
      mayEditLocked: await this.policy.has(
        actor,
        'assignment.evaluate.override',
      ),
    };
    return { submission, assignment, ctx };
  }

  private async assertMayEvaluate(actor: AccessTokenPayload): Promise<void> {
    if (!(await this.policy.has(actor, 'assignment.evaluate'))) {
      throw new ForbiddenException('You may not evaluate submissions');
    }
  }

  private refuse(issues: ReturnType<typeof evaluationIssues>): never {
    throw new BadRequestException({
      message: 'Some cells were refused — nothing was saved',
      details: { issues },
    });
  }
}
