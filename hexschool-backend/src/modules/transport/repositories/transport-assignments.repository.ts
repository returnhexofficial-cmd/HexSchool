import { Injectable } from '@nestjs/common';
import {
  Prisma,
  TransportAssignment,
  TransportAssignmentStatus,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { OCCUPYING_STATUSES } from './routes.repository';

const ASSIGNMENT_INCLUDE = {
  route: {
    select: {
      id: true,
      name: true,
      status: true,
      vehicle: { select: { id: true, regNo: true, capacity: true } },
      driver: { select: { id: true, name: true, phone: true } },
      substituteDriver: { select: { id: true, name: true, phone: true } },
      helperName: true,
      helperPhone: true,
    },
  },
  stop: {
    select: {
      id: true,
      name: true,
      pickupTime: true,
      dropTime: true,
      monthlyFee: true,
      displayOrder: true,
    },
  },
  enrollment: {
    select: {
      id: true,
      rollNo: true,
      sessionId: true,
      student: {
        select: {
          id: true,
          studentUid: true,
          firstName: true,
          lastName: true,
          photoUrl: true,
        },
      },
      class: { select: { id: true, name: true } },
      section: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.TransportAssignmentInclude;

export type AssignmentWithRelations = Prisma.TransportAssignmentGetPayload<{
  include: typeof ASSIGNMENT_INCLUDE;
}>;

export interface AssignmentFilter {
  routeId?: string;
  stopId?: string;
  sessionId?: string;
  classId?: string;
  sectionId?: string;
  studentId?: string;
  status?: TransportAssignmentStatus;
  search?: string;
}

@Injectable()
export class TransportAssignmentsRepository extends BaseRepository<
  TransportAssignment,
  Prisma.TransportAssignmentWhereInput,
  Prisma.TransportAssignmentUncheckedCreateInput,
  Prisma.TransportAssignmentUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(
      prisma,
      (client) => client.transportAssignment,
      'TransportAssignment',
    );
  }

  private where(
    schoolId: string,
    filter: AssignmentFilter,
  ): Prisma.TransportAssignmentWhereInput {
    return {
      schoolId,
      deletedAt: null,
      ...(filter.routeId ? { routeId: filter.routeId } : {}),
      ...(filter.stopId ? { stopId: filter.stopId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
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
    filter: AssignmentFilter,
    page: number,
    limit: number,
  ): Promise<{ rows: AssignmentWithRelations[]; total: number }> {
    const where = this.where(schoolId, filter);
    const [rows, total] = await Promise.all([
      this.prisma.transportAssignment.findMany({
        where,
        include: ASSIGNMENT_INCLUDE,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transportAssignment.count({ where }),
    ]);
    return { rows, total };
  }

  async findAllFor(
    schoolId: string,
    filter: AssignmentFilter,
  ): Promise<AssignmentWithRelations[]> {
    return this.prisma.transportAssignment.findMany({
      where: this.where(schoolId, filter),
      include: ASSIGNMENT_INCLUDE,
      orderBy: [
        { stop: { displayOrder: 'asc' } },
        { enrollment: { rollNo: 'asc' } },
      ],
    });
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<AssignmentWithRelations | null> {
    return this.prisma.transportAssignment.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: ASSIGNMENT_INCLUDE,
    });
  }

  /**
   * The live assignment for an enrollment — what
   * `uq_transport_assignments_live` allows exactly one of.
   */
  async findLive(
    enrollmentId: string,
    tx?: PrismaClientLike,
  ): Promise<AssignmentWithRelations | null> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.transportAssignment.findFirst({
      where: {
        enrollmentId,
        deletedAt: null,
        status: { in: OCCUPYING_STATUSES },
      },
      include: ASSIGNMENT_INCLUDE,
    });
  }

  /** Live assignments for many enrollments — the M16 billing read. */
  async findLiveForEnrollments(
    schoolId: string,
    enrollmentIds: string[],
  ): Promise<AssignmentWithRelations[]> {
    if (enrollmentIds.length === 0) return [];
    return this.prisma.transportAssignment.findMany({
      where: {
        schoolId,
        deletedAt: null,
        enrollmentId: { in: enrollmentIds },
        // ENDED rows are included deliberately: a rider who left on the
        // 12th still owes for the first eleven days of that month, and
        // the window arithmetic is what decides — not the status.
      },
      include: ASSIGNMENT_INCLUDE,
    });
  }

  /** The current-session assignment for a student, for the portal. */
  async findForStudent(
    schoolId: string,
    studentId: string,
    sessionId?: string,
  ): Promise<AssignmentWithRelations | null> {
    return this.prisma.transportAssignment.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        status: { in: OCCUPYING_STATUSES },
        enrollment: {
          is: {
            studentId,
            ...(sessionId ? { sessionId } : {}),
          },
        },
      },
      include: ASSIGNMENT_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async countByStatus(
    schoolId: string,
  ): Promise<Array<{ status: TransportAssignmentStatus; count: number }>> {
    const rows = await this.prisma.transportAssignment.groupBy({
      by: ['status'],
      where: { schoolId, deletedAt: null },
      _count: { _all: true },
    });
    return rows.map((row) => ({ status: row.status, count: row._count._all }));
  }

  /** Guardian phones for a roster, in one query (the driver's sheet). */
  async guardianPhones(
    studentIds: string[],
  ): Promise<Map<string, { name: string; phone: string }>> {
    if (studentIds.length === 0) return new Map();
    const rows = await this.prisma.studentGuardian.findMany({
      where: { studentId: { in: studentIds }, isPrimary: true },
      select: {
        studentId: true,
        guardian: { select: { name: true, phone: true } },
      },
    });
    return new Map(
      rows.map((row) => [
        row.studentId,
        { name: row.guardian.name, phone: row.guardian.phone },
      ]),
    );
  }
}
