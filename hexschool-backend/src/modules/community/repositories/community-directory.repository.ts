import { Injectable } from '@nestjs/common';
import { StudentStatus, VisitorHostType } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';
import type { GraduateCandidate } from '../calc/alumni.engine';

/**
 * The narrow cross-module reads this module needs, over **PrismaService
 * alone** — the M12 `EmployeeDirectoryRepository` / M17 `AudienceRepository`
 * / M18 `DashboardRepository` / M19 `PublicSiteRepository` / M22
 * policy-query / M23 `LibraryDirectoryRepository` / M24
 * `InventoryDirectoryRepository` precedent, **eighth use**.
 *
 * It is what lets `CommunityModule` import neither StudentModule,
 * TeacherModule, StaffModule nor EnrollmentModule. What this module needs
 * from those four is a handful of columns:
 *
 *   - a **visitor's host** is a teacher or an office employee, polymorphic
 *     over two tables with no supertype;
 *   - a **ticket's requester** is a guardian, a student or a member of
 *     staff, resolved only to a name and a phone so the office knows who
 *     it is talking to;
 *   - an **alumni claim** is matched against past GRADUATED students.
 *
 * As in M19, **the SELECT list is the policy**: a complaint's requester
 * resolves to a name and a contact and nothing else, because the inbox
 * has no business showing a guardian's address or a student's marks.
 */
@Injectable()
export class CommunityDirectoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── visitor and appointment hosts ───────────────────────────────────

  /** Everybody a visitor could ask for, both rolls, in one list. */
  async hosts(schoolId: string): Promise<
    Array<{
      hostType: VisitorHostType;
      hostId: string;
      name: string;
      designation: string | null;
      department: string | null;
    }>
  > {
    const [teachers, staff] = await Promise.all([
      this.prisma.teacher.findMany({
        where: { schoolId, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          designation: true,
        },
        orderBy: [{ firstName: 'asc' }],
      }),
      this.prisma.staffProfile.findMany({
        where: { schoolId, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          designation: true,
          department: { select: { name: true } },
        },
        orderBy: [{ firstName: 'asc' }],
      }),
    ]);

    return [
      ...teachers.map((t) => ({
        hostType: VisitorHostType.TEACHER,
        hostId: t.id,
        name: `${t.firstName} ${t.lastName}`.trim(),
        designation: t.designation,
        department: null,
      })),
      ...staff.map((s) => ({
        hostType: VisitorHostType.STAFF,
        hostId: s.id,
        name: `${s.firstName} ${s.lastName}`.trim(),
        designation: s.designation,
        department: s.department?.name ?? null,
      })),
    ].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** One host, for the confirmation SMS and the gate pass. */
  async host(
    schoolId: string,
    hostType: VisitorHostType,
    hostId: string,
  ): Promise<{ name: string; designation: string | null } | null> {
    if (hostType === VisitorHostType.TEACHER) {
      const teacher = await this.prisma.teacher.findFirst({
        where: { id: hostId, schoolId, deletedAt: null },
        select: { firstName: true, lastName: true, designation: true },
      });
      return teacher
        ? {
            name: `${teacher.firstName} ${teacher.lastName}`.trim(),
            designation: teacher.designation,
          }
        : null;
    }
    const staff = await this.prisma.staffProfile.findFirst({
      where: { id: hostId, schoolId, deletedAt: null },
      select: { firstName: true, lastName: true, designation: true },
    });
    return staff
      ? {
          name: `${staff.firstName} ${staff.lastName}`.trim(),
          designation: staff.designation,
        }
      : null;
  }

  // ── ticket requesters ───────────────────────────────────────────────

  /**
   * Resolve a ticket's requester to a display name, a phone and — when
   * they have an account — the user id an IN_APP notification goes to.
   * Returns `null` for an id that no longer resolves, which the inbox
   * renders as the stored contact block or as "(no longer on file)".
   */
  async requester(
    schoolId: string,
    raiserType: 'GUARDIAN' | 'STUDENT' | 'STAFF',
    raiserId: string,
  ): Promise<{
    name: string;
    phone: string | null;
    email: string | null;
    userId: string | null;
  } | null> {
    if (raiserType === 'GUARDIAN') {
      const guardian = await this.prisma.guardian.findFirst({
        where: { id: raiserId, schoolId, deletedAt: null },
        select: { name: true, phone: true, email: true, userId: true },
      });
      return guardian
        ? {
            name: guardian.name,
            phone: guardian.phone,
            email: guardian.email,
            userId: guardian.userId,
          }
        : null;
    }

    if (raiserType === 'STUDENT') {
      // `students` and `staff_profiles` carry no phone or email of their
      // own — the contact lives on the linked `users` row (M09/M07), so
      // it is read through the relation rather than duplicated here.
      const student = await this.prisma.student.findFirst({
        where: { id: raiserId, schoolId, deletedAt: null },
        select: {
          firstName: true,
          lastName: true,
          userId: true,
          user: { select: { phone: true, email: true } },
        },
      });
      return student
        ? {
            name: `${student.firstName} ${student.lastName}`.trim(),
            phone: student.user?.phone ?? null,
            email: student.user?.email ?? null,
            userId: student.userId,
          }
        : null;
    }

    const staff = await this.prisma.staffProfile.findFirst({
      where: { id: raiserId, schoolId, deletedAt: null },
      select: {
        firstName: true,
        lastName: true,
        userId: true,
        user: { select: { phone: true, email: true } },
      },
    });
    return staff
      ? {
          name: `${staff.firstName} ${staff.lastName}`.trim(),
          phone: staff.user?.phone ?? null,
          email: staff.user?.email ?? null,
          userId: staff.userId,
        }
      : null;
  }

  /**
   * Who an assignee is, for the inbox's "taken by" column.
   *
   * `users` has **no name column** — a person's name lives on whichever
   * profile table they are (M07/M08), so this reads both employee rolls
   * and falls back to the login identifier for an account with neither.
   */
  async userNames(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();

    const [staff, teachers, users] = await Promise.all([
      this.prisma.staffProfile.findMany({
        where: { userId: { in: userIds }, deletedAt: null },
        select: { userId: true, firstName: true, lastName: true },
      }),
      this.prisma.teacher.findMany({
        where: { userId: { in: userIds }, deletedAt: null },
        select: { userId: true, firstName: true, lastName: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, phone: true },
      }),
    ]);

    const names = new Map<string, string>();
    for (const user of users) {
      names.set(user.id, user.email ?? user.phone ?? 'Unknown');
    }
    for (const person of [...staff, ...teachers]) {
      if (person.userId) {
        names.set(
          person.userId,
          `${person.firstName} ${person.lastName}`.trim(),
        );
      }
    }
    return names;
  }

  /**
   * The office's in-app audience for a new ticket and an SLA escalation.
   * Repeats a query `AudienceRepository` (M17) already has, for the M19
   * reason: that repository is CommunicationModule-private.
   */
  async adminUserIds(schoolId: string): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        schoolId,
        deletedAt: null,
        status: 'ACTIVE',
        userRoles: {
          some: {
            role: { slug: { in: ['admin', 'super-admin', 'principal'] } },
          },
        },
      },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }

  // ── alumni matching ─────────────────────────────────────────────────

  /**
   * Past students the school recorded as GRADUATED, for roadmap §4's
   * match hint. The **graduation year comes from the status-history row**
   * rather than from an enrollment: a student may have several
   * enrollments and only one of them ended in graduation, and the history
   * table is where M11's promotion flow recorded that fact.
   */
  async graduates(schoolId: string, limit = 500): Promise<GraduateCandidate[]> {
    const students = await this.prisma.student.findMany({
      where: { schoolId, deletedAt: null, status: StudentStatus.GRADUATED },
      select: {
        id: true,
        studentUid: true,
        firstName: true,
        lastName: true,
        user: { select: { phone: true } },
        statusHistory: {
          where: { toStatus: StudentStatus.GRADUATED },
          select: { createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        enrollments: {
          where: { deletedAt: null },
          select: { class: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        // A former student's number is usually their guardian's — it is
        // what the school actually held for five years, and it is the
        // single strongest signal `alumni.engine`'s match score has.
        guardians: {
          where: { isPrimary: true },
          select: { guardian: { select: { phone: true } } },
          take: 1,
        },
      },
      take: limit,
    });

    return students.map((student) => ({
      studentId: student.id,
      studentUid: student.studentUid,
      name: `${student.firstName} ${student.lastName}`.trim(),
      graduationYear:
        student.statusHistory[0]?.createdAt.getUTCFullYear() ?? null,
      lastClass: student.enrollments[0]?.class?.name ?? null,
      phone:
        student.user?.phone ?? student.guardians[0]?.guardian.phone ?? null,
    }));
  }

  /** One student, to confirm a claim resolves before it is approved. */
  async student(
    schoolId: string,
    studentId: string,
  ): Promise<{ id: string; name: string; studentUid: string } | null> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, schoolId, deletedAt: null },
      select: { id: true, studentUid: true, firstName: true, lastName: true },
    });
    return student
      ? {
          id: student.id,
          studentUid: student.studentUid,
          name: `${student.firstName} ${student.lastName}`.trim(),
        }
      : null;
  }
}
