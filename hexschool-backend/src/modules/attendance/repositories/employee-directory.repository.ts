import { Injectable } from '@nestjs/common';
import { AttendancePersonType, StaffStatus } from '../../../common/constants';
import { PrismaService } from '../../../database/prisma/prisma.service';

export interface DirectoryPerson {
  personType: AttendancePersonType;
  /** teachers.id or staff_profiles.id, per `personType`. */
  personId: string;
  employeeId: string;
  name: string;
  designation: string;
  departmentId: string | null;
}

/**
 * Read-only union view over the two employee tables, backing the staff
 * attendance sheet. It is a repository (not service-level Prisma use —
 * PROJECT_CONTEXT §4) but deliberately does not extend BaseRepository:
 * that base binds to exactly one model delegate, and this query spans
 * `teachers` and `staff_profiles`. Narrow selects only, no business
 * logic — the two owning modules keep their own repositories unchanged.
 */
@Injectable()
export class EmployeeDirectoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** ACTIVE + ON_LEAVE employees; RESIGNED/TERMINATED never get marked. */
  async findMarkable(
    schoolId: string,
    personType?: AttendancePersonType,
    departmentId?: string,
  ): Promise<DirectoryPerson[]> {
    const where = {
      schoolId,
      deletedAt: null,
      status: { in: [StaffStatus.ACTIVE, StaffStatus.ON_LEAVE] },
      ...(departmentId ? { departmentId } : {}),
    };
    const select = {
      id: true,
      employeeId: true,
      firstName: true,
      lastName: true,
      designation: true,
      departmentId: true,
    };
    const orderBy = [
      { firstName: 'asc' as const },
      { lastName: 'asc' as const },
    ];

    const [teachers, staff] = await Promise.all([
      personType === AttendancePersonType.STAFF
        ? Promise.resolve([])
        : this.prisma.teacher.findMany({ where, select, orderBy }),
      personType === AttendancePersonType.TEACHER
        ? Promise.resolve([])
        : this.prisma.staffProfile.findMany({ where, select, orderBy }),
    ]);

    return [
      ...teachers.map((t) => this.toPerson(AttendancePersonType.TEACHER, t)),
      ...staff.map((s) => this.toPerson(AttendancePersonType.STAFF, s)),
    ];
  }

  private toPerson(
    personType: AttendancePersonType,
    row: {
      id: string;
      employeeId: string;
      firstName: string;
      lastName: string;
      designation: string;
      departmentId: string | null;
    },
  ): DirectoryPerson {
    return {
      personType,
      personId: row.id,
      employeeId: row.employeeId,
      name: `${row.firstName} ${row.lastName}`,
      designation: String(row.designation),
      departmentId: row.departmentId,
    };
  }
}
