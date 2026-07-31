import { Injectable } from '@nestjs/common';
import { LibraryMemberType } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * Who a library card belongs to.
 *
 * `library_members` is polymorphic over `students`, `teachers` and
 * `staff_profiles` with no FK, so resolving a member to a name is a
 * three-way lookup — and doing it by importing StudentModule,
 * TeacherModule and HrModule would pull three feature modules into a
 * module that needs one column from each.
 *
 * So this is a narrow read repository over PrismaService: the M12
 * `EmployeeDirectoryRepository` idea, and the same shape M17's
 * `AudienceRepository`, M18's `DashboardRepository`, M19's
 * `PublicSiteRepository` and M22's policy query take. It also keeps the
 * module graph honest — the library depends on *who people are*, not on
 * student or teacher management.
 */

export interface DirectoryPerson {
  personType: LibraryMemberType;
  personId: string;
  name: string;
  /** Student UID or employee ID — what the desk types when the card is lost. */
  reference: string;
  /** Their own portal account, for the in-app bell. */
  userId: string | null;
  phone: string | null;
  /** `Class 8 — B` for a student, the designation for a teacher/staff. */
  context: string | null;
  active: boolean;
}

@Injectable()
export class LibraryDirectoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async lookup(
    schoolId: string,
    personType: LibraryMemberType,
    personId: string,
  ): Promise<DirectoryPerson | null> {
    const many = await this.lookupMany(schoolId, personType, [personId]);
    return many.get(personId) ?? null;
  }

  async lookupMany(
    schoolId: string,
    personType: LibraryMemberType,
    personIds: string[],
  ): Promise<Map<string, DirectoryPerson>> {
    const out = new Map<string, DirectoryPerson>();
    if (personIds.length === 0) return out;

    if (personType === LibraryMemberType.STUDENT) {
      const rows = await this.prisma.student.findMany({
        where: { id: { in: personIds }, schoolId, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          studentUid: true,
          userId: true,
          status: true,
          enrollments: {
            where: { deletedAt: null, status: 'ACTIVE' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              section: {
                select: { name: true, class: { select: { name: true } } },
              },
            },
          },
          guardians: {
            where: { isPrimary: true },
            take: 1,
            select: { guardian: { select: { phone: true } } },
          },
        },
      });
      for (const row of rows) {
        const section = row.enrollments[0]?.section;
        out.set(row.id, {
          personType,
          personId: row.id,
          name: `${row.firstName} ${row.lastName}`.trim(),
          reference: row.studentUid,
          userId: row.userId,
          // A BD student's number on file is usually their guardian's,
          // which is who an overdue SMS should reach anyway.
          phone: row.guardians[0]?.guardian.phone ?? null,
          context: section ? `${section.class.name} — ${section.name}` : null,
          active: row.status === 'ACTIVE',
        });
      }
      return out;
    }

    if (personType === LibraryMemberType.TEACHER) {
      const rows = await this.prisma.teacher.findMany({
        where: { id: { in: personIds }, schoolId, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeId: true,
          userId: true,
          designation: true,
          status: true,
          // Contacts live on `users`, not on the profile tables (the M09
          // constraint change) — so a phone is one join away wherever it
          // is needed.
          user: { select: { phone: true } },
        },
      });
      for (const row of rows) {
        out.set(row.id, {
          personType,
          personId: row.id,
          name: `${row.firstName} ${row.lastName}`.trim(),
          reference: row.employeeId,
          userId: row.userId,
          phone: row.user?.phone ?? null,
          context: row.designation,
          active: row.status === 'ACTIVE',
        });
      }
      return out;
    }

    const rows = await this.prisma.staffProfile.findMany({
      where: { id: { in: personIds }, schoolId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeId: true,
        userId: true,
        designation: true,
        status: true,
        user: { select: { phone: true } },
      },
    });
    for (const row of rows) {
      out.set(row.id, {
        personType,
        personId: row.id,
        name: `${row.firstName} ${row.lastName}`.trim(),
        reference: row.employeeId,
        userId: row.userId,
        phone: row.user?.phone ?? null,
        context: row.designation,
        active: row.status === 'ACTIVE',
      });
    }
    return out;
  }

  /**
   * Card-holder search from a name or reference, for the desk's "member"
   * box when nobody has their card. Returns at most `limit` per type.
   */
  async search(
    schoolId: string,
    term: string,
    limit = 10,
  ): Promise<DirectoryPerson[]> {
    const q = term.trim();
    if (q.length < 2) return [];
    const like = { contains: q, mode: 'insensitive' as const };

    const [students, teachers, staff] = await Promise.all([
      this.prisma.student.findMany({
        where: {
          schoolId,
          deletedAt: null,
          OR: [{ firstName: like }, { lastName: like }, { studentUid: like }],
        },
        take: limit,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          studentUid: true,
          userId: true,
          status: true,
        },
      }),
      this.prisma.teacher.findMany({
        where: {
          schoolId,
          deletedAt: null,
          OR: [{ firstName: like }, { lastName: like }, { employeeId: like }],
        },
        take: limit,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeId: true,
          userId: true,
          designation: true,
          status: true,
          user: { select: { phone: true } },
        },
      }),
      this.prisma.staffProfile.findMany({
        where: {
          schoolId,
          deletedAt: null,
          OR: [{ firstName: like }, { lastName: like }, { employeeId: like }],
        },
        take: limit,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeId: true,
          userId: true,
          designation: true,
          status: true,
          user: { select: { phone: true } },
        },
      }),
    ]);

    return [
      ...students.map((row) => ({
        personType: LibraryMemberType.STUDENT,
        personId: row.id,
        name: `${row.firstName} ${row.lastName}`.trim(),
        reference: row.studentUid,
        userId: row.userId,
        phone: null,
        context: null,
        active: row.status === 'ACTIVE',
      })),
      ...teachers.map((row) => ({
        personType: LibraryMemberType.TEACHER,
        personId: row.id,
        name: `${row.firstName} ${row.lastName}`.trim(),
        reference: row.employeeId,
        userId: row.userId,
        phone: row.user?.phone ?? null,
        context: row.designation,
        active: row.status === 'ACTIVE',
      })),
      ...staff.map((row) => ({
        personType: LibraryMemberType.STAFF,
        personId: row.id,
        name: `${row.firstName} ${row.lastName}`.trim(),
        reference: row.employeeId,
        userId: row.userId,
        phone: row.user?.phone ?? null,
        context: row.designation,
        active: row.status === 'ACTIVE',
      })),
    ];
  }

  /**
   * The portal's "which card is mine?" — resolves a logged-in user to
   * the person row a library card would hang off. A guardian gets
   * nothing, deliberately: the library lends to the reader, and a
   * parent's OPAC view is their child's, which the portal resolves by
   * ownership (M18) rather than by a card of their own.
   */
  async personForUser(
    schoolId: string,
    userId: string,
  ): Promise<{ personType: LibraryMemberType; personId: string } | null> {
    const [student, teacher, staff] = await Promise.all([
      this.prisma.student.findFirst({
        where: { schoolId, userId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.teacher.findFirst({
        where: { schoolId, userId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.staffProfile.findFirst({
        where: { schoolId, userId, deletedAt: null },
        select: { id: true },
      }),
    ]);

    if (student) {
      return { personType: LibraryMemberType.STUDENT, personId: student.id };
    }
    if (teacher) {
      return { personType: LibraryMemberType.TEACHER, personId: teacher.id };
    }
    if (staff) {
      return { personType: LibraryMemberType.STAFF, personId: staff.id };
    }
    return null;
  }
}
