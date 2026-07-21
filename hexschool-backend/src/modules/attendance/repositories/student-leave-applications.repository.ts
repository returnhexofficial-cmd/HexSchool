import { Injectable } from '@nestjs/common';
import { LeaveStatus, Prisma, StudentLeaveApplication } from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../common/dto/paginated.dto';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { parseDate } from '../../academic/calendar/date.util';
import { StudentLeaveQueryDto } from '../dto';

const LEAVE_INCLUDE = {
  student: {
    select: {
      id: true,
      studentUid: true,
      firstName: true,
      lastName: true,
      nameBn: true,
      photoUrl: true,
    },
  },
  session: { select: { id: true, name: true } },
} satisfies Prisma.StudentLeaveApplicationInclude;

export type StudentLeaveWithRelations =
  Prisma.StudentLeaveApplicationGetPayload<{ include: typeof LEAVE_INCLUDE }>;

@Injectable()
export class StudentLeaveApplicationsRepository extends BaseRepository<
  StudentLeaveApplication,
  Prisma.StudentLeaveApplicationWhereInput,
  Prisma.StudentLeaveApplicationUncheckedCreateInput,
  Prisma.StudentLeaveApplicationUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(
      prisma,
      (client) => client.studentLeaveApplication,
      'StudentLeaveApplication',
    );
  }

  async paginateList(
    query: StudentLeaveQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<StudentLeaveWithRelations>> {
    const { page, limit } = query;
    const where: Prisma.StudentLeaveApplicationWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      ...(query.status ? { status: query.status } : {}),
      // Overlap semantics: any leave intersecting the requested window.
      ...(query.to ? { fromDate: { lte: parseDate(query.to) } } : {}),
      ...(query.from ? { toDate: { gte: parseDate(query.from) } } : {}),
      ...(query.search
        ? {
            student: {
              is: {
                OR: [
                  {
                    firstName: { contains: query.search, mode: 'insensitive' },
                  },
                  { lastName: { contains: query.search, mode: 'insensitive' } },
                  {
                    studentUid: { contains: query.search, mode: 'insensitive' },
                  },
                ],
              },
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.studentLeaveApplication.findMany({
        where,
        include: LEAVE_INCLUDE,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.studentLeaveApplication.count({ where }),
    ]);
    return { data: items, meta: buildPaginationMeta(page, limit, total) };
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<StudentLeaveWithRelations | null> {
    return this.prisma.studentLeaveApplication.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: LEAVE_INCLUDE,
    });
  }

  /** Approved leaves covering a date — the marking-time LEAVE override. */
  async findApprovedCovering(
    studentIds: string[],
    date: Date,
    tx?: PrismaClientLike,
  ): Promise<StudentLeaveApplication[]> {
    if (studentIds.length === 0) return [];
    const client = (tx ?? this.prisma) as PrismaService;
    return client.studentLeaveApplication.findMany({
      where: {
        studentId: { in: studentIds },
        deletedAt: null,
        status: LeaveStatus.APPROVED,
        fromDate: { lte: date },
        toDate: { gte: date },
      },
    });
  }

  /** Approved leaves overlapping a range for one student (overlap guard). */
  async findOverlapping(
    studentId: string,
    from: Date,
    to: Date,
    excludeId?: string,
  ): Promise<StudentLeaveApplication[]> {
    return this.prisma.studentLeaveApplication.findMany({
      where: {
        studentId,
        deletedAt: null,
        status: { in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
        fromDate: { lte: to },
        toDate: { gte: from },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }
}
