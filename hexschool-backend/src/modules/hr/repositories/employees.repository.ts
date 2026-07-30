import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AttendancePersonType, StaffStatus } from '../../../common/constants';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * The "unified employee view" the roadmap opens Module 21 with (§1).
 *
 * M08 deliberately kept `teachers` and `staff_profiles` as separate
 * tables so the two lifecycles stay independent. HR is the module that
 * finally has to treat both as one workforce — for leave, for salary
 * assignment and for the monthly payroll — so it reads them through one
 * narrow union repository rather than importing TeacherModule and
 * StaffModule and stitching two shapes together at every call site.
 *
 * Like M12's `EmployeeDirectoryRepository` (the same idea, a thinner
 * projection) this does NOT extend `BaseRepository`: that base binds to
 * exactly one model delegate. It stays a repository — services never
 * touch Prisma (PROJECT_CONTEXT §4) — with narrow selects and no
 * business logic.
 */

export interface Employee {
  personType: AttendancePersonType;
  /** `teachers.id` or `staff_profiles.id`, per `personType`. */
  personId: string;
  userId: string;
  employeeId: string;
  name: string;
  designation: string;
  departmentId: string | null;
  joiningDate: Date;
  /** Last working day, once they have left (M21). */
  exitDate: Date | null;
  status: StaffStatus;
  /** Only `staff_profiles` carries this; NULL for a teacher. */
  employmentType: string | null;
  photoUrl: string | null;
  phone: string | null;
  email: string | null;
}

export interface EmployeeFilter {
  personType?: AttendancePersonType;
  departmentId?: string;
  /** Defaults to the two statuses that still draw a salary. */
  statuses?: StaffStatus[];
  search?: string;
}

/** Statuses an employee still on the payroll can hold. */
export const PAYABLE_STATUSES: StaffStatus[] = [
  StaffStatus.ACTIVE,
  StaffStatus.ON_LEAVE,
];

const COMMON_SELECT = {
  id: true,
  userId: true,
  employeeId: true,
  firstName: true,
  lastName: true,
  designation: true,
  departmentId: true,
  joiningDate: true,
  exitDate: true,
  status: true,
  photoUrl: true,
  user: { select: { phone: true, email: true } },
} as const;

const TEACHER_SELECT = COMMON_SELECT satisfies Prisma.TeacherSelect;
const STAFF_SELECT = {
  ...COMMON_SELECT,
  employmentType: true,
} satisfies Prisma.StaffProfileSelect;

@Injectable()
export class EmployeesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    schoolId: string,
    filter: EmployeeFilter = {},
  ): Promise<Employee[]> {
    const statuses = filter.statuses ?? PAYABLE_STATUSES;
    const where = {
      schoolId,
      deletedAt: null,
      status: { in: statuses },
      ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
      ...(filter.search
        ? {
            OR: [
              {
                firstName: {
                  contains: filter.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                lastName: {
                  contains: filter.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                employeeId: {
                  contains: filter.search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };
    const orderBy = [
      { firstName: 'asc' as const },
      { lastName: 'asc' as const },
    ];

    const [teachers, staff] = await Promise.all([
      filter.personType === AttendancePersonType.STAFF
        ? Promise.resolve([])
        : this.prisma.teacher.findMany({
            where,
            select: TEACHER_SELECT,
            orderBy,
          }),
      filter.personType === AttendancePersonType.TEACHER
        ? Promise.resolve([])
        : this.prisma.staffProfile.findMany({
            where,
            select: STAFF_SELECT,
            orderBy,
          }),
    ]);

    return sortByName([
      ...teachers.map((row) => toEmployee(AttendancePersonType.TEACHER, row)),
      ...staff.map((row) => toEmployee(AttendancePersonType.STAFF, row)),
    ]);
  }

  /** One employee, or null when the pair does not name a live person. */
  async findOne(
    schoolId: string,
    personType: AttendancePersonType,
    personId: string,
  ): Promise<Employee | null> {
    const rows = await this.findManyByKeys(schoolId, [
      { personType, personId },
    ]);
    return rows[0] ?? null;
  }

  /**
   * Resolve a batch of (type, id) pairs in two queries.
   *
   * Payroll generation needs the whole workforce's details at once, and a
   * per-person lookup would be N round trips for a school of eighty.
   */
  async findManyByKeys(
    schoolId: string,
    keys: ReadonlyArray<{ personType: AttendancePersonType; personId: string }>,
  ): Promise<Employee[]> {
    const teacherIds = keys
      .filter((key) => key.personType === AttendancePersonType.TEACHER)
      .map((key) => key.personId);
    const staffIds = keys
      .filter((key) => key.personType === AttendancePersonType.STAFF)
      .map((key) => key.personId);

    const [teachers, staff] = await Promise.all([
      teacherIds.length > 0
        ? this.prisma.teacher.findMany({
            where: { schoolId, deletedAt: null, id: { in: teacherIds } },
            select: TEACHER_SELECT,
          })
        : Promise.resolve([]),
      staffIds.length > 0
        ? this.prisma.staffProfile.findMany({
            where: { schoolId, deletedAt: null, id: { in: staffIds } },
            select: STAFF_SELECT,
          })
        : Promise.resolve([]),
    ]);

    return sortByName([
      ...teachers.map((row) => toEmployee(AttendancePersonType.TEACHER, row)),
      ...staff.map((row) => toEmployee(AttendancePersonType.STAFF, row)),
    ]);
  }

  /**
   * The employee a portal user IS, if any.
   *
   * A guardian who also teaches holds two accounts (the M09 per-type
   * uniqueness rule), so one `user_id` resolves to at most one teacher
   * and at most one staff profile — never both, because those would be
   * two different user rows.
   */
  async findByUserId(
    schoolId: string,
    userId: string,
  ): Promise<Employee | null> {
    const [teacher, staff] = await Promise.all([
      this.prisma.teacher.findFirst({
        where: { schoolId, userId, deletedAt: null },
        select: TEACHER_SELECT,
      }),
      this.prisma.staffProfile.findFirst({
        where: { schoolId, userId, deletedAt: null },
        select: STAFF_SELECT,
      }),
    ]);

    if (teacher) return toEmployee(AttendancePersonType.TEACHER, teacher);
    if (staff) return toEmployee(AttendancePersonType.STAFF, staff);
    return null;
  }
}

interface RawEmployee {
  id: string;
  userId: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  designation: string;
  departmentId: string | null;
  joiningDate: Date;
  exitDate: Date | null;
  status: StaffStatus;
  employmentType?: string | null;
  photoUrl: string | null;
  user: { phone: string | null; email: string | null } | null;
}

function toEmployee(
  personType: AttendancePersonType,
  row: RawEmployee,
): Employee {
  return {
    personType,
    personId: row.id,
    userId: row.userId,
    employeeId: row.employeeId,
    name: `${row.firstName} ${row.lastName}`.trim(),
    designation: String(row.designation),
    departmentId: row.departmentId,
    joiningDate: row.joiningDate,
    exitDate: row.exitDate,
    status: row.status,
    employmentType: row.employmentType ?? null,
    photoUrl: row.photoUrl,
    phone: row.user?.phone ?? null,
    email: row.user?.email ?? null,
  };
}

function sortByName(rows: Employee[]): Employee[] {
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
