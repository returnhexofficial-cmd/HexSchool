import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { PermissionsService } from '../../rbac/services/permissions.service';

export interface TeachingSlot {
  sessionId: string;
  sectionId: string;
  subjectId: string;
}

export interface AssignmentActor {
  /** The teacher row behind this account, if any. */
  teacherId: string | null;
  /** Holds `assignment.all` — may act outside their own section-subjects. */
  seesAll: boolean;
}

/**
 * Module 22 — who may set, edit and mark a piece of work.
 *
 * **The policy reads `teacher_section_subjects` live, never
 * `assignments.teacher_id`.** That single choice is what delivers
 * roadmap §8's "teacher reassigned → new teacher inherits evaluation
 * rights for that section-subject" with no data migration and no
 * reassignment sweep: the M08 assignment table already moved, so the
 * answer to "may this person mark 8B's physics?" changes the moment the
 * duty roster does. Trusting the stored `teacher_id` would instead leave
 * a departed teacher marking work and the incoming one locked out —
 * exactly the situation §8 names.
 *
 * `assignment.all` is the widening code (roadmap §6 "teacher sees only
 * own; head/admin see all"), checked at runtime rather than as a route
 * decorator because one route serves both cases — the M08
 * assignment-override / M12 holiday-override convention.
 *
 * A narrow read over PrismaService (the M17 `AudienceRepository` / M18
 * `DashboardRepository` precedent) so the module does not have to import
 * TeacherModule for one query.
 */
@Injectable()
export class AssignmentPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async resolveActor(actor: AccessTokenPayload): Promise<AssignmentActor> {
    const [teacher, seesAll] = await Promise.all([
      this.prisma.teacher.findFirst({
        where: { userId: actor.sub, schoolId: actor.schoolId, deletedAt: null },
        select: { id: true },
      }),
      this.has(actor, 'assignment.all'),
    ]);
    return { teacherId: teacher?.id ?? null, seesAll };
  }

  async has(actor: AccessTokenPayload, code: string): Promise<boolean> {
    if (actor.userType === UserType.SUPER_ADMIN) return true;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    return codes.includes(code);
  }

  /** Every (section, subject) this teacher holds in a session. */
  async slotsFor(
    teacherId: string,
    schoolId: string,
    sessionId?: string,
  ): Promise<TeachingSlot[]> {
    const rows = await this.prisma.teacherSectionSubject.findMany({
      where: {
        teacherId,
        schoolId,
        ...(sessionId ? { sessionId } : {}),
      },
      select: { sessionId: true, sectionId: true, subjectId: true },
    });
    return rows;
  }

  async teaches(
    teacherId: string,
    schoolId: string,
    slot: TeachingSlot,
  ): Promise<boolean> {
    const row = await this.prisma.teacherSectionSubject.findFirst({
      where: {
        teacherId,
        schoolId,
        sessionId: slot.sessionId,
        sectionId: slot.sectionId,
        subjectId: slot.subjectId,
      },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * The gate every write goes through. Returns the teacher id the work
   * should be attributed to.
   *
   * A caller holding `assignment.all` may name any teacher; everyone else
   * is pinned to their own account and must actually hold the slot.
   */
  async assertMayActOn(
    actor: AccessTokenPayload,
    slot: TeachingSlot,
    requestedTeacherId?: string | null,
  ): Promise<string> {
    const resolved = await this.resolveActor(actor);

    if (resolved.seesAll) {
      const teacherId = requestedTeacherId ?? resolved.teacherId;
      if (!teacherId) {
        throw new NotFoundException(
          'Name the teacher this work belongs to — this account has no teacher profile',
        );
      }
      await this.assertTeacherExists(teacherId, actor.schoolId);
      return teacherId;
    }

    if (!resolved.teacherId) {
      throw new ForbiddenException(
        'Only a teacher may set work for a section (or hold assignment.all)',
      );
    }
    if (requestedTeacherId && requestedTeacherId !== resolved.teacherId) {
      throw new ForbiddenException(
        'You may only set work in your own name (needs assignment.all)',
      );
    }
    if (!(await this.teaches(resolved.teacherId, actor.schoolId, slot))) {
      throw new ForbiddenException(
        'You do not teach this subject in this section',
      );
    }
    return resolved.teacherId;
  }

  /**
   * Read/act on an EXISTING assignment. Deliberately checks the live
   * duty roster rather than `assignment.teacherId` — see the class doc.
   */
  async assertMayTouch(
    actor: AccessTokenPayload,
    assignment: TeachingSlot & { teacherId: string },
  ): Promise<AssignmentActor> {
    const resolved = await this.resolveActor(actor);
    if (resolved.seesAll) return resolved;

    if (!resolved.teacherId) {
      throw new ForbiddenException('You may not act on this assignment');
    }
    // The author keeps access even if the roster moved under them —
    // otherwise a teacher who set work on Monday and was reassigned on
    // Tuesday could not read the marks they had already given.
    if (resolved.teacherId === assignment.teacherId) return resolved;

    if (!(await this.teaches(resolved.teacherId, actor.schoolId, assignment))) {
      throw new ForbiddenException(
        'You do not teach this subject in this section',
      );
    }
    return resolved;
  }

  private async assertTeacherExists(
    teacherId: string,
    schoolId: string,
  ): Promise<void> {
    const teacher = await this.prisma.teacher.findFirst({
      where: { id: teacherId, schoolId, deletedAt: null },
      select: { id: true },
    });
    if (!teacher) throw new NotFoundException(`Teacher ${teacherId} not found`);
  }
}
