import { Injectable } from '@nestjs/common';
import {
  HostelAllocation,
  HostelAllocationStatus,
  Prisma,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { OCCUPYING_STATUSES } from './hostels.repository';

const ALLOCATION_INCLUDE = {
  hostel: {
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      phone: true,
      wardenStaff: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  bed: {
    select: {
      id: true,
      bedNo: true,
      status: true,
      room: {
        select: {
          id: true,
          roomNo: true,
          floor: true,
          type: true,
          status: true,
          monthlyFee: true,
        },
      },
    },
  },
  enrollment: {
    select: {
      id: true,
      rollNo: true,
      sessionId: true,
      status: true,
      student: {
        select: {
          id: true,
          studentUid: true,
          firstName: true,
          lastName: true,
          gender: true,
          photoUrl: true,
        },
      },
      class: { select: { id: true, name: true } },
      section: { select: { id: true, name: true } },
    },
  },
  messEnrollments: {
    where: { deletedAt: null },
    orderBy: { startDate: 'desc' },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      plan: { select: { id: true, name: true, monthlyCharge: true } },
    },
  },
} satisfies Prisma.HostelAllocationInclude;

export type AllocationWithRelations = Prisma.HostelAllocationGetPayload<{
  include: typeof ALLOCATION_INCLUDE;
}>;

export interface AllocationFilter {
  hostelId?: string;
  roomId?: string;
  bedId?: string;
  sessionId?: string;
  classId?: string;
  sectionId?: string;
  studentId?: string;
  status?: HostelAllocationStatus;
  search?: string;
}

@Injectable()
export class HostelAllocationsRepository extends BaseRepository<
  HostelAllocation,
  Prisma.HostelAllocationWhereInput,
  Prisma.HostelAllocationUncheckedCreateInput,
  Prisma.HostelAllocationUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.hostelAllocation, 'HostelAllocation');
  }

  private where(
    schoolId: string,
    filter: AllocationFilter,
  ): Prisma.HostelAllocationWhereInput {
    return {
      schoolId,
      deletedAt: null,
      ...(filter.hostelId ? { hostelId: filter.hostelId } : {}),
      ...(filter.bedId ? { bedId: filter.bedId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.roomId ? { bed: { is: { roomId: filter.roomId } } } : {}),
      ...(filter.sessionId ||
      filter.classId ||
      filter.sectionId ||
      filter.studentId ||
      filter.search
        ? {
            enrollment: {
              is: {
                ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
                ...(filter.classId ? { classId: filter.classId } : {}),
                ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
                ...(filter.studentId ? { studentId: filter.studentId } : {}),
                ...(filter.search
                  ? {
                      student: {
                        is: {
                          OR: [
                            {
                              firstName: {
                                contains: filter.search,
                                mode: 'insensitive',
                              },
                            },
                            {
                              lastName: {
                                contains: filter.search,
                                mode: 'insensitive',
                              },
                            },
                            {
                              studentUid: {
                                contains: filter.search,
                                mode: 'insensitive',
                              },
                            },
                          ],
                        },
                      },
                    }
                  : {}),
              },
            },
          }
        : {}),
    };
  }

  async findMany(
    schoolId: string,
    filter: AllocationFilter,
    page: number,
    limit: number,
  ): Promise<{ rows: AllocationWithRelations[]; total: number }> {
    const where = this.where(schoolId, filter);
    const [rows, total] = await Promise.all([
      this.prisma.hostelAllocation.findMany({
        where,
        include: ALLOCATION_INCLUDE,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.hostelAllocation.count({ where }),
    ]);
    return { rows, total };
  }

  async findAllFor(
    schoolId: string,
    filter: AllocationFilter,
  ): Promise<AllocationWithRelations[]> {
    return this.prisma.hostelAllocation.findMany({
      where: this.where(schoolId, filter),
      include: ALLOCATION_INCLUDE,
      orderBy: [
        { bed: { room: { floor: 'asc' } } },
        { bed: { room: { roomNo: 'asc' } } },
        { bed: { bedNo: 'asc' } },
      ],
    });
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<AllocationWithRelations | null> {
    return this.prisma.hostelAllocation.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: ALLOCATION_INCLUDE,
    });
  }

  /**
   * The live allocation for an enrollment — what
   * `uq_hostel_allocations_live_enrollment` allows exactly one of.
   */
  async findLive(
    enrollmentId: string,
    tx?: PrismaClientLike,
  ): Promise<AllocationWithRelations | null> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.hostelAllocation.findFirst({
      where: {
        enrollmentId,
        deletedAt: null,
        status: { in: OCCUPYING_STATUSES },
      },
      include: ALLOCATION_INCLUDE,
    });
  }

  /** Whoever holds this bed right now, if anybody. */
  async findLiveForBed(
    bedId: string,
    tx?: PrismaClientLike,
  ): Promise<AllocationWithRelations | null> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.hostelAllocation.findFirst({
      where: { bedId, deletedAt: null, status: { in: OCCUPYING_STATUSES } },
      include: ALLOCATION_INCLUDE,
    });
  }

  /**
   * Every allocation touching these enrollments — the M16 billing read.
   *
   * VACATED rows are included **deliberately**: a boarder who left on the
   * 12th still owes for the first eleven nights of that month, and the
   * window arithmetic is what decides that, not the status. Excluding
   * them here is precisely how a school stops billing a month early.
   */
  async findForEnrollments(
    schoolId: string,
    enrollmentIds: string[],
  ): Promise<AllocationWithRelations[]> {
    if (enrollmentIds.length === 0) return [];
    return this.prisma.hostelAllocation.findMany({
      where: {
        schoolId,
        deletedAt: null,
        enrollmentId: { in: enrollmentIds },
      },
      include: ALLOCATION_INCLUDE,
    });
  }

  /** The current-session allocation for a student, for the portal. */
  async findForStudent(
    schoolId: string,
    studentId: string,
    sessionId?: string,
  ): Promise<AllocationWithRelations | null> {
    return this.prisma.hostelAllocation.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        status: { in: OCCUPYING_STATUSES },
        enrollment: { is: { studentId, ...(sessionId ? { sessionId } : {}) } },
      },
      include: ALLOCATION_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async countByStatus(
    schoolId: string,
  ): Promise<Array<{ status: HostelAllocationStatus; count: number }>> {
    const rows = await this.prisma.hostelAllocation.groupBy({
      by: ['status'],
      where: { schoolId, deletedAt: null },
      _count: { _all: true },
    });
    return rows.map((row) => ({ status: row.status, count: row._count._all }));
  }

  /** Guardian contacts for the resident register, in one query. */
  async guardianContacts(
    studentIds: string[],
  ): Promise<Map<string, { name: string; phone: string; relation: string }>> {
    if (studentIds.length === 0) return new Map();
    const rows = await this.prisma.studentGuardian.findMany({
      where: { studentId: { in: studentIds }, isPrimary: true },
      select: {
        studentId: true,
        relation: true,
        guardian: { select: { name: true, phone: true } },
      },
    });
    return new Map(
      rows.map((row) => [
        row.studentId,
        {
          name: row.guardian.name,
          phone: row.guardian.phone,
          relation: String(row.relation),
        },
      ]),
    );
  }
}
