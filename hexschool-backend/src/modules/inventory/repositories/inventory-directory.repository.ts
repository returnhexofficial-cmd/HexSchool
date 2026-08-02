import { Injectable } from '@nestjs/common';
import { InventoryPersonType } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * Who is holding school property, and which departments exist to hold it.
 *
 * The custodian on an asset and the recipient on a gate pass are
 * polymorphic over `teachers` and `staff_profiles` with no FK (the M12
 * `staff_attendances` / M21 `leave_applications` / M23 `library_members`
 * precedent), so resolving one to a name is a two-way lookup — and doing
 * it by importing TeacherModule and HrModule would pull two feature
 * modules in for one column from each.
 *
 * So this is a narrow read repository over PrismaService: the M12
 * `EmployeeDirectoryRepository` / M17 `AudienceRepository` / M18
 * `DashboardRepository` / M19 `PublicSiteRepository` / M22 policy-query /
 * M23 `LibraryDirectoryRepository` shape, seventh use. It also keeps the
 * module graph honest — the store depends on *who people are*, not on
 * teacher or staff management.
 *
 * Departments are read the same way rather than through AcademicModule,
 * for the narrower reason that InventoryModule needs exactly two columns
 * of them and importing the module for that would be the same overstated
 * dependency one table over.
 */

export interface DirectoryHolder {
  personType: InventoryPersonType;
  personId: string;
  name: string;
  /** Employee ID — what the register prints beside the name. */
  reference: string;
  /** Their portal account, for the in-app bell. */
  userId: string | null;
  phone: string | null;
  designation: string | null;
  active: boolean;
}

export interface DirectoryDepartment {
  id: string;
  name: string;
  code: string;
}

/**
 * The same narrow projection for both employee tables. A contact number
 * lives on `users`, not on the profile — the M19 privacy note, and the
 * reason this joins one column rather than selecting a `phone` that does
 * not exist.
 */
const PERSON_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  employeeId: true,
  userId: true,
  designation: true,
  status: true,
  user: { select: { phone: true } },
} as const;

interface PersonRow {
  id: string;
  firstName: string;
  lastName: string;
  employeeId: string;
  userId: string;
  designation: string;
  status: string;
  user: { phone: string | null } | null;
}

/** `designation` is a different enum per table, so the shared shape
 *  widens it to a string — the register prints it, nothing branches on
 *  it. */
function toHolder(
  row: PersonRow,
  personType: InventoryPersonType,
): DirectoryHolder {
  return {
    personType,
    personId: row.id,
    name: `${row.firstName} ${row.lastName}`.trim(),
    reference: row.employeeId,
    userId: row.userId,
    phone: row.user?.phone ?? null,
    designation: row.designation,
    active: row.status === 'ACTIVE',
  };
}

@Injectable()
export class InventoryDirectoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async lookup(
    schoolId: string,
    personType: InventoryPersonType,
    personId: string,
  ): Promise<DirectoryHolder | null> {
    const many = await this.lookupMany(schoolId, personType, [personId]);
    return many.get(personId) ?? null;
  }

  async lookupMany(
    schoolId: string,
    personType: InventoryPersonType,
    personIds: string[],
  ): Promise<Map<string, DirectoryHolder>> {
    const out = new Map<string, DirectoryHolder>();
    const ids = personIds.filter(Boolean);
    if (ids.length === 0) return out;

    if (personType === InventoryPersonType.TEACHER) {
      const rows = await this.prisma.teacher.findMany({
        where: { id: { in: ids }, schoolId, deletedAt: null },
        select: PERSON_SELECT,
      });
      for (const row of rows) out.set(row.id, toHolder(row, personType));
      return out;
    }

    const rows = await this.prisma.staffProfile.findMany({
      where: { id: { in: ids }, schoolId, deletedAt: null },
      select: PERSON_SELECT,
    });
    for (const row of rows) out.set(row.id, toHolder(row, personType));
    return out;
  }

  /**
   * Both employee tables at once, for the custodian picker. A store keeper
   * assigning a projector does not think in "teacher" and "staff" — they
   * think of a person — so the picker is one list and the `personType`
   * comes back with the choice.
   */
  async searchHolders(
    schoolId: string,
    search?: string,
    limit = 25,
  ): Promise<DirectoryHolder[]> {
    const where = {
      schoolId,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
              {
                employeeId: { contains: search, mode: 'insensitive' as const },
              },
            ],
          }
        : {}),
    };

    const [teachers, staff] = await Promise.all([
      this.prisma.teacher.findMany({
        where,
        select: PERSON_SELECT,
        take: limit,
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.staffProfile.findMany({
        where,
        select: PERSON_SELECT,
        take: limit,
        orderBy: { firstName: 'asc' },
      }),
    ]);

    return [
      ...teachers.map((row) => toHolder(row, InventoryPersonType.TEACHER)),
      ...staff.map((row) => toHolder(row, InventoryPersonType.STAFF)),
    ]
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  async departments(schoolId: string): Promise<DirectoryDepartment[]> {
    return this.prisma.department.findMany({
      where: { schoolId, deletedAt: null },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  }

  async departmentExists(schoolId: string, id: string): Promise<boolean> {
    const count = await this.prisma.department.count({
      where: { id, schoolId, deletedAt: null },
    });
    return count > 0;
  }

  /** Admin/office user ids for the low-stock and warranty alerts. */
  async adminUserIds(schoolId: string): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        schoolId,
        deletedAt: null,
        status: 'ACTIVE',
        userRoles: {
          some: {
            role: {
              slug: {
                in: ['super-admin', 'admin', 'principal', 'office-staff'],
              },
            },
          },
        },
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
}
