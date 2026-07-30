import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationRecipientType,
} from '../../../common/constants';
import { NotificationService } from '../../communication/services/notification.service';
import { PrismaService } from '../../../database/prisma/prisma.service';
import type { AssignmentWithRelations } from '../repositories/assignments.repository';
import type { AssignmentConfig } from './assignment-settings.service';

interface SectionRecipient {
  studentId: string;
  studentName: string;
  /** The student's own portal account, when they have one. */
  studentUserId: string | null;
  /** Primary guardian's account + phone, for the SMS/parent bell. */
  guardianUserId: string | null;
  guardianPhone: string | null;
}

/**
 * Module 22's outbound messages, all through `NotificationService.send()`
 * — the M17 rule that there are no direct gateway calls anywhere.
 *
 * Two shapes of delivery, and the difference matters:
 *
 *   - **IN_APP** goes to the *student's own* account, because the portal
 *     bell a student reads is keyed on their user id (M17). A guardian
 *     also gets one, so the parent portal shows the same thing.
 *   - **SMS** goes to the guardian's phone only. A BD school's student
 *     frequently has no handset of their own, and the number on file is
 *     the parent's — sending "your homework is due" to a parent is the
 *     correct message either way.
 *
 * Every send is wrapped: a school with an empty SMS balance or an
 * unreachable gateway must not make publishing an assignment fail. That
 * is the M07 credential-notification rule and M20's "an auto-post failure
 * is logged, never rethrown", applied to the classroom.
 */
@Injectable()
export class AssignmentNotificationsService {
  private readonly logger = new Logger(AssignmentNotificationsService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly prisma: PrismaService,
  ) {}

  async announcePublished(
    assignment: AssignmentWithRelations,
    cfg: AssignmentConfig,
  ): Promise<number> {
    return this.fanOut(assignment, cfg, 'ASSIGNMENT_NEW', {
      due: this.formatDue(assignment.dueAt),
      type: assignment.type === 'HOMEWORK' ? 'homework' : 'assignment',
    });
  }

  /**
   * The 24-hour reminder. `skipEnrollmentIds` are the candidates who have
   * already handed the work in — nagging them is how a school teaches
   * people to ignore its messages.
   */
  async remindDueSoon(
    assignment: AssignmentWithRelations,
    cfg: AssignmentConfig,
    skipEnrollmentIds: ReadonlySet<string>,
  ): Promise<number> {
    return this.fanOut(
      assignment,
      cfg,
      'ASSIGNMENT_DUE_SOON',
      { due: this.formatDue(assignment.dueAt) },
      skipEnrollmentIds,
    );
  }

  /** Roadmap §8 — nudge the teacher after due + N days with nothing in. */
  async nudgeTeacher(assignment: AssignmentWithRelations): Promise<void> {
    const teacher = await this.prisma.teacher.findFirst({
      where: { id: assignment.teacherId, deletedAt: null },
      select: { userId: true },
    });
    if (!teacher?.userId) return;

    await this.safeSend({
      schoolId: assignment.schoolId,
      code: 'ASSIGNMENT_NO_SUBMISSIONS',
      channel: NotificationChannel.IN_APP,
      // TEACHER is not a recipient type — a teacher's bell is their
      // USER account, which is what M17's `/notifications/me` reads.
      recipient: {
        type: NotificationRecipientType.USER,
        id: teacher.userId,
      },
      vars: {
        title: assignment.title,
        subject: assignment.subject.name,
        section: `${assignment.section.class.name} ${assignment.section.name}`,
        due: this.formatDue(assignment.dueAt),
      },
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  private async fanOut(
    assignment: AssignmentWithRelations,
    cfg: AssignmentConfig,
    code: string,
    extraVars: Record<string, unknown>,
    skipEnrollmentIds: ReadonlySet<string> = new Set(),
  ): Promise<number> {
    const recipients = await this.recipientsFor(
      assignment.sectionId,
      assignment.sessionId,
      assignment.schoolId,
      skipEnrollmentIds,
    );

    const school = await this.prisma.school.findFirst({
      where: { id: assignment.schoolId },
      select: { name: true },
    });

    let sent = 0;
    for (const person of recipients) {
      const vars = {
        student_name: person.studentName,
        title: assignment.title,
        subject: assignment.subject.name,
        school: school?.name ?? 'School',
        ...extraVars,
      };

      if (cfg.notificationChannel === NotificationChannel.SMS) {
        if (!person.guardianPhone) continue;
        const ok = await this.safeSend({
          schoolId: assignment.schoolId,
          code,
          channel: NotificationChannel.SMS,
          recipient: {
            type: NotificationRecipientType.GUARDIAN,
            id: person.guardianUserId,
            destination: person.guardianPhone,
          },
          vars,
          dedupe: true,
        });
        if (ok) sent++;
        continue;
      }

      // IN_APP: the student's bell, and the guardian's if they have one.
      for (const [userId, type] of [
        [person.studentUserId, NotificationRecipientType.STUDENT],
        [person.guardianUserId, NotificationRecipientType.GUARDIAN],
      ] as const) {
        if (!userId) continue;
        const ok = await this.safeSend({
          schoolId: assignment.schoolId,
          code,
          channel: NotificationChannel.IN_APP,
          recipient: { type, id: userId },
          vars,
        });
        if (ok) sent++;
      }
    }
    return sent;
  }

  /**
   * The section's live roster with the accounts a message can reach.
   * One query rather than one per student — the M17 `AudienceRepository`
   * shape, kept here because AssignmentModule already reads enrollments.
   */
  private async recipientsFor(
    sectionId: string,
    sessionId: string,
    schoolId: string,
    skipEnrollmentIds: ReadonlySet<string>,
  ): Promise<SectionRecipient[]> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        sectionId,
        sessionId,
        schoolId,
        deletedAt: null,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            userId: true,
            guardians: {
              where: { isPrimary: true },
              select: {
                guardian: { select: { userId: true, phone: true } },
              },
              take: 1,
            },
          },
        },
      },
    });

    return enrollments
      .filter((e) => !skipEnrollmentIds.has(e.id))
      .map((e) => {
        const primary = e.student.guardians[0]?.guardian ?? null;
        return {
          studentId: e.student.id,
          studentName: `${e.student.firstName} ${e.student.lastName}`.trim(),
          studentUserId: e.student.userId,
          guardianUserId: primary?.userId ?? null,
          guardianPhone: primary?.phone ?? null,
        };
      });
  }

  private async safeSend(
    input: Parameters<NotificationService['send']>[0],
  ): Promise<boolean> {
    try {
      await this.notifications.send(input);
      return true;
    } catch (error) {
      this.logger.warn(
        `Assignment notification ${input.code} failed: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /** `Thu 30 Jul, 6:00 pm` in Asia/Dhaka — what a parent reads. */
  private formatDue(due: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dhaka',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(due);
  }
}
