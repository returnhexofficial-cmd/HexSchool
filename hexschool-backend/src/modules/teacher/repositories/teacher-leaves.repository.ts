import { Injectable } from '@nestjs/common';
import { LeaveStatus, Prisma, TeacherLeave } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../common/dto/paginated.dto';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { LeaveQueryDto } from '../dto';

const LEAVE_INCLUDE = {
  teacher: {
    select: { id: true, firstName: true, lastName: true, employeeId: true },
  },
} satisfies Prisma.TeacherLeaveInclude;

export type LeaveWithTeacher = Prisma.TeacherLeaveGetPayload<{
  include: typeof LEAVE_INCLUDE;
}>;

/** No soft delete: PENDING rows hard-delete; decided rows are kept. */
@Injectable()
export class TeacherLeavesRepository extends BaseRepository<
  TeacherLeave,
  Prisma.TeacherLeaveWhereInput,
  Prisma.TeacherLeaveUncheckedCreateInput,
  Prisma.TeacherLeaveUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.teacherLeave, 'Leave', {
      softDeletable: false,
    });
  }

  async paginateList(
    query: LeaveQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<LeaveWithTeacher>> {
    const { page, limit } = query;
    const where: Prisma.TeacherLeaveWhereInput = {
      schoolId,
      ...(query.teacherId ? { teacherId: query.teacherId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.search
        ? {
            teacher: {
              is: {
                OR: [
                  {
                    firstName: { contains: query.search, mode: 'insensitive' },
                  },
                  { lastName: { contains: query.search, mode: 'insensitive' } },
                  {
                    employeeId: { contains: query.search, mode: 'insensitive' },
                  },
                ],
              },
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.teacherLeave.findMany({
        where,
        include: LEAVE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.teacherLeave.count({ where }),
    ]);
    return { data: items, meta: buildPaginationMeta(page, limit, total) };
  }

  /** APPROVED leaves of a teacher overlapping [from, to]. */
  async countApprovedOverlaps(
    teacherId: string,
    fromDate: Date,
    toDate: Date,
    excludeId?: string,
  ): Promise<number> {
    return this.prisma.teacherLeave.count({
      where: {
        teacherId,
        status: LeaveStatus.APPROVED,
        fromDate: { lte: toDate },
        toDate: { gte: fromDate },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  async hardDelete(id: string): Promise<void> {
    await this.prisma.teacherLeave.delete({ where: { id } });
  }
}
