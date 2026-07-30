import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssignmentStatus, LearningMaterialType } from '@prisma/client';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SessionsService } from '../../academic/services/sessions.service';
import { EnrollmentsService } from '../../enrollment/services/enrollments.service';
import { pendingFor } from '../calc/assignment-stats.engine';
import {
  REFUSAL_MESSAGES,
  submissionVerdict,
} from '../calc/submission-window.engine';
import type { SubmitAssignmentDto } from '../dto';
import { AssignmentsRepository } from '../repositories/assignments.repository';
import { SubmissionsRepository } from '../repositories/submissions.repository';
import { AssignmentSettingsService } from './assignment-settings.service';
import { LearningMaterialsService } from './learning-materials.service';
import { SubmissionsService } from './submissions.service';

export type PortalTab = 'PENDING' | 'SUBMITTED' | 'EVALUATED';

/**
 * The student/parent view of Module 22 — what PortalModule (M18)
 * composes into `/portal/assignments`.
 *
 * It lives **here**, not in PortalModule, because everything it does is
 * assignment business: resolving the candidate's enrollment, hiding
 * DRAFT work, deciding whether a submission is still open. PortalModule
 * supplies only the ownership answer ("which student is this?"), which is
 * the split every other portal panel already uses.
 *
 * Two rules are enforced by construction rather than by a filter:
 *
 *   - **A student sees only their own section's published work.** The
 *     list starts from their enrollment's section, so there is no
 *     assignment id to tamper with and nothing to leak.
 *   - **Only a student may submit.** A parent reads the same lists (§5
 *     "parent portal: child's pending/late overview") and gets a 403 on
 *     `submit`, because the school's record of who did the work must
 *     mean what it says.
 */
@Injectable()
export class StudentAssignmentsService {
  constructor(
    private readonly assignments: AssignmentsRepository,
    private readonly submissions: SubmissionsRepository,
    private readonly submissionsService: SubmissionsService,
    private readonly materials: LearningMaterialsService,
    private readonly enrollments: EnrollmentsService,
    private readonly sessions: SessionsService,
    private readonly config: AssignmentSettingsService,
  ) {}

  /** The candidate's live enrollment for the session in question. */
  private async enrollmentFor(
    studentId: string,
    schoolId: string,
    sessionId?: string,
  ) {
    const resolved =
      sessionId ?? (await this.sessions.getCurrent(schoolId))?.id;
    if (!resolved) {
      throw new NotFoundException(
        'This school has no current academic session',
      );
    }
    const enrollment = await this.enrollments.getStudentCurrentEnrollment(
      studentId,
      resolved,
      schoolId,
    );
    if (!enrollment) {
      throw new NotFoundException(
        'This student is not enrolled in the selected session',
      );
    }
    return enrollment;
  }

  async list(
    studentId: string,
    schoolId: string,
    options: { sessionId?: string; subjectId?: string; tab?: string } = {},
  ) {
    const enrollment = await this.enrollmentFor(
      studentId,
      schoolId,
      options.sessionId,
    );

    // PUBLISHED **and** CLOSED: a closed assignment is still part of a
    // student's record — they need to read the mark they were given. A
    // DRAFT is invisible, which is the whole point of the status.
    const all = await this.assignments.findAllFor(schoolId, {
      sessionId: enrollment.sessionId,
      sectionId: enrollment.sectionId,
      subjectId: options.subjectId,
    });
    const visible = all.filter((a) => a.status !== AssignmentStatus.DRAFT);

    const byAssignment = await this.submissions.statusByAssignment(
      [enrollment.id],
      visible.map((a) => a.id),
    );

    const now = Date.now();
    const cfg = await this.config.load(schoolId);

    const rows = visible.map((a) => {
      const submission = byAssignment.get(a.id) ?? null;
      const verdict = submissionVerdict({
        status: a.status,
        dueAt: a.dueAt.getTime(),
        now,
        allowLate: a.allowLate,
        allowResubmission: cfg.allowResubmission,
        resubmissionUntilDue: cfg.resubmissionUntilDue,
        existing: submission ? { status: submission.status } : null,
      });

      return {
        id: a.id,
        type: a.type,
        title: a.title,
        instructions: a.instructions,
        attachments: a.attachmentUrls,
        subject: a.subject,
        teacher: `${a.teacher.firstName} ${a.teacher.lastName}`.trim(),
        assignedAt: a.assignedAt,
        dueAt: a.dueAt,
        fullMarks: a.fullMarks,
        allowLate: a.allowLate,
        status: a.status,
        overdue: !submission && a.dueAt.getTime() < now,
        submission: submission
          ? {
              id: submission.id,
              status: submission.status,
              submittedAt: submission.submittedAt,
              isLate: submission.isLate,
              attempt: submission.attempt,
              textAnswer: submission.textAnswer,
              attachments: submission.attachmentUrls,
              marks: submission.marks,
              feedback: submission.feedback,
              evaluatedAt: submission.evaluatedAt,
            }
          : null,
        canSubmit: verdict.allowed,
        // Why not, in words the portal can print without a lookup table.
        submitBlockedReason: verdict.reason
          ? REFUSAL_MESSAGES[verdict.reason]
          : null,
      };
    });

    const summary = pendingFor(
      visible.map((a) => ({ id: a.id, dueAt: a.dueAt.getTime() })),
      [...byAssignment.values()].map((s) => ({
        assignmentId: s.assignmentId,
        status: s.status,
      })),
      now,
    );

    const tab = (options.tab ?? '').toUpperCase() as PortalTab;
    const filtered =
      tab === 'PENDING'
        ? rows.filter(
            (r) => !r.submission || r.submission.status === 'RETURNED',
          )
        : tab === 'SUBMITTED'
          ? rows.filter(
              (r) =>
                r.submission &&
                (r.submission.status === 'SUBMITTED' ||
                  r.submission.status === 'RESUBMITTED'),
            )
          : tab === 'EVALUATED'
            ? rows.filter((r) => r.submission?.status === 'EVALUATED')
            : rows;

    return {
      enrollmentId: enrollment.id,
      sectionId: enrollment.sectionId,
      assignments: filtered,
      summary: {
        total: rows.length,
        pending: summary.pending.length,
        overdue: summary.overdue,
        dueSoon: summary.dueSoon,
        submitted: rows.filter((r) => r.submission).length,
        evaluated: rows.filter((r) => r.submission?.status === 'EVALUATED')
          .length,
      },
    };
  }

  async detail(studentId: string, schoolId: string, assignmentId: string) {
    const { assignments } = await this.list(studentId, schoolId).then((r) => ({
      assignments: r.assignments,
    }));
    const found = assignments.find((a) => a.id === assignmentId);
    // Same 404 whether the assignment is another section's, a draft, or
    // does not exist — the M15/M19 rule that a read must not confirm
    // something the caller may not see.
    if (!found) throw new NotFoundException('Assignment not found');
    return found;
  }

  /**
   * Hand work in. `actor` must BE the student — a parent gets a 403 even
   * for their own child.
   */
  async submit(
    studentId: string,
    assignmentId: string,
    dto: SubmitAssignmentDto,
    actor: AccessTokenPayload,
    options: { isStudentSelf: boolean },
  ) {
    if (!options.isStudentSelf) {
      throw new ForbiddenException(
        'Only the student may submit their own work',
      );
    }
    const assignment = await this.assignments.findDetail(
      assignmentId,
      actor.schoolId,
    );
    if (!assignment || assignment.status === AssignmentStatus.DRAFT) {
      throw new NotFoundException('Assignment not found');
    }

    const enrollment = await this.enrollmentFor(
      studentId,
      actor.schoolId,
      assignment.sessionId,
    );

    return this.submissionsService.submit(
      assignmentId,
      enrollment.id,
      dto,
      actor,
    );
  }

  /** The materials library (roadmap §5 "filter by subject"). */
  async materialsFor(
    studentId: string,
    schoolId: string,
    options: {
      sessionId?: string;
      subjectId?: string;
      type?: LearningMaterialType;
    } = {},
  ) {
    const enrollment = await this.enrollmentFor(
      studentId,
      schoolId,
      options.sessionId,
    );
    return this.materials.visibleFor(
      schoolId,
      enrollment.sessionId,
      enrollment.classId,
      enrollment.sectionId,
      { subjectId: options.subjectId, type: options.type },
    );
  }
}
