import { Injectable } from '@nestjs/common';
import { Prisma, Student } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../common/dto/paginated.dto';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { StudentQueryDto } from '../dto';

const LIST_INCLUDE = {
  admissionClass: { select: { id: true, name: true, numericLevel: true } },
  user: {
    select: {
      id: true,
      email: true,
      phone: true,
      status: true,
      lastLoginAt: true,
      mustChangePassword: true,
    },
  },
  guardians: {
    include: {
      guardian: {
        select: {
          id: true,
          name: true,
          phone: true,
          relation: true,
          userId: true,
        },
      },
    },
  },
} satisfies Prisma.StudentInclude;

export type StudentWithRelations = Prisma.StudentGetPayload<{
  include: typeof LIST_INCLUDE;
}>;

const FULL_INCLUDE = {
  ...LIST_INCLUDE,
  documents: true,
  statusHistory: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.StudentInclude;

export type StudentFullPayload = Prisma.StudentGetPayload<{
  include: typeof FULL_INCLUDE;
}>;

const SORTABLE = new Set([
  'studentUid',
  'firstName',
  'lastName',
  'dob',
  'admissionDate',
  'status',
  'createdAt',
]);

@Injectable()
export class StudentsRepository extends BaseRepository<
  Student,
  Prisma.StudentWhereInput,
  Prisma.StudentUncheckedCreateInput,
  Prisma.StudentUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.student, 'Student');
  }

  /** List page: filters (class/status/gender/religion) + quick search by
   *  name / UID / guardian phone (roadmap M09 §5). */
  async paginateList(
    query: StudentQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<StudentWithRelations>> {
    const { page, limit } = query;

    const where: Prisma.StudentWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.classId ? { admissionClassId: query.classId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.gender ? { gender: query.gender } : {}),
      ...(query.religion ? { religion: query.religion } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { nameBn: { contains: query.search, mode: 'insensitive' } },
              { studentUid: { contains: query.search, mode: 'insensitive' } },
              {
                birthCertificateNo: { contains: query.search },
              },
              {
                guardians: {
                  some: {
                    guardian: { is: { phone: { contains: query.search } } },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [field, dir] = (query.sort ?? '').split(':');
    const orderBy: Prisma.StudentOrderByWithRelationInput =
      field && SORTABLE.has(field)
        ? { [field]: dir?.toLowerCase() === 'desc' ? 'desc' : 'asc' }
        : { createdAt: 'desc' };

    const [items, total] = await Promise.all([
      this.prisma.student.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.student.count({ where }),
    ]);
    return { data: items, meta: buildPaginationMeta(page, limit, total) };
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<StudentWithRelations | null> {
    return this.prisma.student.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: LIST_INCLUDE,
    });
  }

  /** The /students/:id/full aggregate (profile + guardians + docs + trail). */
  async findFull(
    id: string,
    schoolId: string,
  ): Promise<StudentFullPayload | null> {
    return this.prisma.student.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: FULL_INCLUDE,
    });
  }

  async findManyDetailed(
    ids: string[],
    schoolId: string,
  ): Promise<StudentWithRelations[]> {
    return this.prisma.student.findMany({
      where: { id: { in: ids }, schoolId, deletedAt: null },
      include: LIST_INCLUDE,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  /**
   * Warn-only duplicate probe (roadmap M09 §8): same name+dob, or same
   * dob + a shared guardian phone (twins/siblings pattern).
   */
  async findPossibleDuplicates(
    params: {
      firstName: string;
      lastName: string;
      dob: Date;
      guardianPhones: string[];
      excludeId?: string;
    },
    schoolId: string,
  ): Promise<StudentWithRelations[]> {
    return this.prisma.student.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(params.excludeId ? { id: { not: params.excludeId } } : {}),
        OR: [
          {
            firstName: { equals: params.firstName, mode: 'insensitive' },
            lastName: { equals: params.lastName, mode: 'insensitive' },
            dob: params.dob,
          },
          ...(params.guardianPhones.length > 0
            ? [
                {
                  dob: params.dob,
                  guardians: {
                    some: {
                      guardian: {
                        is: { phone: { in: params.guardianPhones } },
                      },
                    },
                  },
                },
              ]
            : []),
        ],
      },
      include: LIST_INCLUDE,
      take: 10,
    });
  }

  async findByBirthCertificate(
    birthCertificateNo: string,
    schoolId: string,
  ): Promise<Student | null> {
    return this.findOne({ birthCertificateNo }, schoolId);
  }

  async findByQrToken(qrToken: string): Promise<Student | null> {
    return this.prisma.student.findFirst({
      where: { qrToken, deletedAt: null },
    });
  }
}
