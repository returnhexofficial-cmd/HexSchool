import { Injectable } from '@nestjs/common';
import { Enrollment, EnrollmentStatus, Prisma } from '@prisma/client';
import {
  PrismaClientLike,
  BaseRepository,
} from '../../../common/database/base.repository';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../common/dto/paginated.dto';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { EnrollmentQueryDto } from '../dto';

const ENROLLMENT_INCLUDE = {
  student: {
    select: {
      id: true,
      studentUid: true,
      firstName: true,
      lastName: true,
      nameBn: true,
      photoUrl: true,
      gender: true,
      status: true,
    },
  },
  section: { select: { id: true, name: true } },
  class: { select: { id: true, name: true, numericLevel: true } },
  group: { select: { id: true, name: true } },
  shift: { select: { id: true, name: true } },
  optionalSubject: { select: { id: true, name: true, code: true } },
  session: { select: { id: true, name: true } },
} satisfies Prisma.EnrollmentInclude;

export type EnrollmentWithRelations = Prisma.EnrollmentGetPayload<{
  include: typeof ENROLLMENT_INCLUDE;
}>;

/** Enrollment statuses that occupy a section seat / a session slot. */
const LIVE_STATUS: Prisma.EnumEnrollmentStatusFilter = {
  not: EnrollmentStatus.CANCELLED,
};

@Injectable()
export class EnrollmentsRepository extends BaseRepository<
  Enrollment,
  Prisma.EnrollmentWhereInput,
  Prisma.EnrollmentUncheckedCreateInput,
  Prisma.EnrollmentUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.enrollment, 'Enrollment');
  }

  async paginateList(
    query: EnrollmentQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<EnrollmentWithRelations>> {
    const { page, limit } = query;
    const where: Prisma.EnrollmentWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.status ? { status: query.status } : {}),
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
      this.prisma.enrollment.findMany({
        where,
        include: ENROLLMENT_INCLUDE,
        orderBy: [{ rollNo: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.enrollment.count({ where }),
    ]);
    return { data: items, meta: buildPaginationMeta(page, limit, total) };
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<EnrollmentWithRelations | null> {
    return this.prisma.enrollment.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: ENROLLMENT_INCLUDE,
    });
  }

  /** The canonical roster: ACTIVE enrollments of a section, roll order. */
  async findSectionRoster(
    sectionId: string,
    schoolId: string,
  ): Promise<EnrollmentWithRelations[]> {
    return this.prisma.enrollment.findMany({
      where: {
        sectionId,
        schoolId,
        deletedAt: null,
        status: EnrollmentStatus.ACTIVE,
      },
      include: ENROLLMENT_INCLUDE,
      orderBy: [{ rollNo: 'asc' }],
    });
  }

  /** A student's live (non-cancelled) enrollment for a session, if any. */
  async findLiveByStudentSession(
    studentId: string,
    sessionId: string,
    schoolId: string,
    tx?: PrismaClientLike,
  ): Promise<EnrollmentWithRelations | null> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.enrollment.findFirst({
      where: {
        studentId,
        sessionId,
        schoolId,
        deletedAt: null,
        status: LIVE_STATUS,
      },
      include: ENROLLMENT_INCLUDE,
    });
  }

  /** Highest live roll in a section (null when empty) — for auto-assign. */
  async maxRoll(
    sessionId: string,
    sectionId: string,
    tx?: PrismaClientLike,
  ): Promise<number> {
    const client = (tx ?? this.prisma) as PrismaService;
    const agg = await client.enrollment.aggregate({
      where: {
        sessionId,
        sectionId,
        deletedAt: null,
        status: LIVE_STATUS,
      },
      _max: { rollNo: true },
    });
    return agg._max.rollNo ?? 0;
  }

  async isRollTaken(
    sessionId: string,
    sectionId: string,
    rollNo: number,
    excludeId?: string,
    tx?: PrismaClientLike,
  ): Promise<boolean> {
    const client = (tx ?? this.prisma) as PrismaService;
    const found = await client.enrollment.findFirst({
      where: {
        sessionId,
        sectionId,
        rollNo,
        deletedAt: null,
        status: LIVE_STATUS,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    return found !== null;
  }

  async countActiveInSection(
    sessionId: string,
    sectionId: string,
    tx?: PrismaClientLike,
  ): Promise<number> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.enrollment.count({
      where: {
        sessionId,
        sectionId,
        deletedAt: null,
        status: EnrollmentStatus.ACTIVE,
      },
    });
  }

  /** Live enrollments for a session (promotion candidate source). */
  async findLiveForSession(
    sessionId: string,
    schoolId: string,
  ): Promise<EnrollmentWithRelations[]> {
    return this.prisma.enrollment.findMany({
      where: {
        sessionId,
        schoolId,
        deletedAt: null,
        status: EnrollmentStatus.ACTIVE,
      },
      include: ENROLLMENT_INCLUDE,
      orderBy: [{ classId: 'asc' }, { rollNo: 'asc' }],
    });
  }

  /** Students of the school with no live enrollment in the given session. */
  async findEnrollableStudents(
    sessionId: string,
    schoolId: string,
    opts: { search?: string; limit: number },
  ) {
    return this.prisma.student.findMany({
      where: {
        schoolId,
        deletedAt: null,
        status: 'ACTIVE',
        enrollments: {
          none: {
            sessionId,
            deletedAt: null,
            status: LIVE_STATUS,
          },
        },
        ...(opts.search
          ? {
              OR: [
                { firstName: { contains: opts.search, mode: 'insensitive' } },
                { lastName: { contains: opts.search, mode: 'insensitive' } },
                { nameBn: { contains: opts.search, mode: 'insensitive' } },
                { studentUid: { contains: opts.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        studentUid: true,
        firstName: true,
        lastName: true,
        nameBn: true,
        gender: true,
        photoUrl: true,
        admissionClassId: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: opts.limit,
    });
  }

  /** Hard-delete an enrollment (promotion rollback removes new-session
   *  rows created at execution). */
  async hardDelete(id: string, tx?: PrismaClientLike): Promise<void> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.enrollment.delete({ where: { id } });
  }

  /** Whether a section has any live enrollment (M06 delete guard). */
  async sectionHasEnrollments(
    sectionId: string,
    tx?: PrismaClientLike,
  ): Promise<boolean> {
    const client = (tx ?? this.prisma) as PrismaService;
    const found = await client.enrollment.findFirst({
      where: { sectionId, deletedAt: null, status: LIVE_STATUS },
      select: { id: true },
    });
    return found !== null;
  }
}
