import { Injectable } from '@nestjs/common';
import { Prisma, Teacher } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../common/dto/paginated.dto';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { TeacherQueryDto } from '../dto';

const LIST_INCLUDE = {
  department: { select: { id: true, name: true, code: true } },
  user: {
    select: {
      id: true,
      email: true,
      phone: true,
      status: true,
      userType: true,
      lastLoginAt: true,
      mustChangePassword: true,
    },
  },
  subjects: {
    select: { subject: { select: { id: true, name: true, code: true } } },
  },
} satisfies Prisma.TeacherInclude;

export type TeacherWithRelations = Prisma.TeacherGetPayload<{
  include: typeof LIST_INCLUDE;
}>;

const SORTABLE = new Set([
  'employeeId',
  'firstName',
  'lastName',
  'designation',
  'joiningDate',
  'status',
  'createdAt',
]);

@Injectable()
export class TeachersRepository extends BaseRepository<
  Teacher,
  Prisma.TeacherWhereInput,
  Prisma.TeacherUncheckedCreateInput,
  Prisma.TeacherUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.teacher, 'Teacher');
  }

  /** List page with filters (incl. expertise subject) + relations. */
  async paginateList(
    query: TeacherQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<TeacherWithRelations>> {
    const { page, limit } = query;

    const where: Prisma.TeacherWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.designation ? { designation: query.designation } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.subjectId
        ? { subjects: { some: { subjectId: query.subjectId } } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { nameBn: { contains: query.search, mode: 'insensitive' } },
              { employeeId: { contains: query.search, mode: 'insensitive' } },
              {
                specialization: { contains: query.search, mode: 'insensitive' },
              },
              {
                user: {
                  is: {
                    OR: [
                      {
                        email: { contains: query.search, mode: 'insensitive' },
                      },
                      { phone: { contains: query.search } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [field, dir] = (query.sort ?? '').split(':');
    const orderBy: Prisma.TeacherOrderByWithRelationInput =
      field && SORTABLE.has(field)
        ? { [field]: dir?.toLowerCase() === 'desc' ? 'desc' : 'asc' }
        : { createdAt: 'desc' };

    const [items, total] = await Promise.all([
      this.prisma.teacher.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.teacher.count({ where }),
    ]);
    return { data: items, meta: buildPaginationMeta(page, limit, total) };
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<TeacherWithRelations | null> {
    return this.prisma.teacher.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: LIST_INCLUDE,
    });
  }

  /** Sections this teacher is class teacher of, in one session (cap rule). */
  async countClassTeacherSections(
    teacherId: string,
    sessionId: string,
    excludeSectionId?: string,
  ): Promise<number> {
    return this.prisma.section.count({
      where: {
        classTeacherId: teacherId,
        sessionId,
        deletedAt: null,
        ...(excludeSectionId ? { id: { not: excludeSectionId } } : {}),
      },
    });
  }
}
