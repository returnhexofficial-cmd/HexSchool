import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PrismaService } from '../../../database/prisma/prisma.service';

export interface PortalChild {
  studentId: string;
  name: string;
  studentUid: string;
  status: string;
  photoUrl: string | null;
}

export interface PortalPrincipal {
  userId: string;
  schoolId: string;
  userType: UserType;
  /** The student this user IS (STUDENT type), if any. */
  studentId: string | null;
  /** The guardian this user IS (PARENT type), if any. */
  guardianId: string | null;
  /** The teacher this user IS (TEACHER type), if any. */
  teacherId: string | null;
  /** Every student this user may read — self for a student, children for a parent. */
  children: PortalChild[];
}

/**
 * Resolves the logged-in portal user to the profile rows they own
 * (roadmap M18 §4 "me-scope guards"). The single source of truth for
 * **which students a portal user may read** — a student reads only
 * themselves, a parent only the children linked to them via
 * `student_guardians`. Every ownership check funnels through
 * `assertOwnsStudent`, so there is one place IDOR is prevented.
 *
 * A narrow read over PrismaService (the M12/M17 `AudienceRepository`
 * precedent), so PortalModule stays a leaf that aggregates the feature
 * modules without pulling their internals into a guard.
 */
@Injectable()
export class PortalResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async principal(actor: AccessTokenPayload): Promise<PortalPrincipal> {
    const base: PortalPrincipal = {
      userId: actor.sub,
      schoolId: actor.schoolId,
      userType: actor.userType,
      studentId: null,
      guardianId: null,
      teacherId: null,
      children: [],
    };

    if (actor.userType === UserType.STUDENT) {
      const student = await this.prisma.student.findFirst({
        where: { userId: actor.sub, schoolId: actor.schoolId, deletedAt: null },
        select: this.childSelect(),
      });
      if (student) {
        base.studentId = student.id;
        base.children = [this.toChild(student)];
      }
      return base;
    }

    if (actor.userType === UserType.PARENT) {
      const guardian = await this.prisma.guardian.findFirst({
        where: { userId: actor.sub, schoolId: actor.schoolId, deletedAt: null },
        select: { id: true },
      });
      if (guardian) {
        base.guardianId = guardian.id;
        const links = await this.prisma.studentGuardian.findMany({
          where: { guardianId: guardian.id },
          select: { student: { select: this.childSelect() } },
        });
        base.children = links
          .map((l) => l.student)
          .filter(
            (s): s is NonNullable<typeof s> =>
              s !== null && s.deletedAt === null,
          )
          .map((s) => this.toChild(s));
      }
      return base;
    }

    if (actor.userType === UserType.TEACHER) {
      const teacher = await this.prisma.teacher.findFirst({
        where: { userId: actor.sub, schoolId: actor.schoolId, deletedAt: null },
        select: { id: true },
      });
      if (teacher) base.teacherId = teacher.id;
      return base;
    }

    return base;
  }

  /** Throws 403 unless the actor may read `studentId`. */
  async assertOwnsStudent(
    actor: AccessTokenPayload,
    studentId: string,
  ): Promise<PortalPrincipal> {
    const principal = await this.principal(actor);
    const owns = principal.children.some((c) => c.studentId === studentId);
    if (!owns) {
      throw new ForbiddenException('You may not view this student');
    }
    return principal;
  }

  private childSelect() {
    return {
      id: true,
      firstName: true,
      lastName: true,
      studentUid: true,
      status: true,
      photoUrl: true,
      deletedAt: true,
    } as const;
  }

  private toChild(s: {
    id: string;
    firstName: string;
    lastName: string;
    studentUid: string;
    status: string;
    photoUrl: string | null;
  }): PortalChild {
    return {
      studentId: s.id,
      name: `${s.firstName} ${s.lastName}`.trim(),
      studentUid: s.studentUid,
      status: s.status,
      photoUrl: s.photoUrl,
    };
  }
}
