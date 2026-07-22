import { Injectable } from '@nestjs/common';
import { Exam, ExamStatus, Prisma } from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { ExamListQueryDto } from '../dto';

const RELATIONS = {
  examType: { select: { id: true, name: true, weight: true } },
  session: { select: { id: true, name: true, status: true } },
  gradingSystem: { select: { id: true, name: true, isDefault: true } },
  examClasses: {
    select: {
      classId: true,
      class: { select: { id: true, name: true, numericLevel: true } },
    },
    orderBy: { class: { numericLevel: 'asc' } },
  },
} satisfies Prisma.ExamInclude;

export type ExamWithRelations = Prisma.ExamGetPayload<{
  include: typeof RELATIONS;
}>;

@Injectable()
export class ExamsRepository extends BaseRepository<
  Exam,
  Prisma.ExamWhereInput,
  Prisma.ExamUncheckedCreateInput,
  Prisma.ExamUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.exam, 'Exam');
  }

  async findDetail(
    id: string,
    schoolId: string,
    tx?: PrismaClientLike,
  ): Promise<ExamWithRelations | null> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.exam.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: RELATIONS,
    });
  }

  async paginateList(
    query: ExamListQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<ExamWithRelations>> {
    const where: Prisma.ExamWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      ...(query.examTypeId ? { examTypeId: query.examTypeId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.classId
        ? { examClasses: { some: { classId: query.classId } } }
        : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.exam.findMany({
        where,
        include: RELATIONS,
        orderBy: [{ startDate: 'desc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.exam.count({ where }),
    ]);

    return {
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit) || 1,
      },
    };
  }

  /** Case-insensitive name lookup behind `uq_exams_name`. */
  async findByName(
    schoolId: string,
    sessionId: string,
    name: string,
    excludeId?: string,
  ): Promise<Exam | null> {
    return this.prisma.exam.findFirst({
      where: {
        schoolId,
        sessionId,
        deletedAt: null,
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  /** Live exams of a session — the clash engine's competition set. */
  async findLiveForSession(
    schoolId: string,
    sessionId: string,
    excludeExamId?: string,
  ): Promise<Exam[]> {
    return this.prisma.exam.findMany({
      where: {
        schoolId,
        sessionId,
        deletedAt: null,
        status: { notIn: [ExamStatus.DRAFT, ExamStatus.ARCHIVED] },
        ...(excludeExamId ? { id: { not: excludeExamId } } : {}),
      },
    });
  }

  /**
   * Earlier exams of the same TYPE, newest first — the year-over-year
   * comparison Module 15's analytics draws. Keyed on the type rather
   * than the name because "Annual" against "Half-Yearly" is not a
   * comparison, which is exactly what the type master is for.
   */
  async findByType(
    examTypeId: string,
    schoolId: string,
    excludeExamId: string,
  ): Promise<Exam[]> {
    return this.prisma.exam.findMany({
      where: {
        schoolId,
        examTypeId,
        deletedAt: null,
        id: { not: excludeExamId },
        status: { in: [ExamStatus.PUBLISHED, ExamStatus.ARCHIVED] },
      },
      orderBy: { startDate: 'desc' },
    });
  }

  async setStatus(
    id: string,
    data: Prisma.ExamUncheckedUpdateInput,
    tx?: PrismaClientLike,
  ): Promise<Exam> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.exam.update({ where: { id }, data });
  }

  // ── attached classes ────────────────────────────────────────────────

  async findClassIds(examId: string, tx?: PrismaClientLike): Promise<string[]> {
    const client = (tx ?? this.prisma) as PrismaService;
    const rows = await client.examClass.findMany({
      where: { examId },
      select: { classId: true },
    });
    return rows.map((r) => r.classId);
  }

  /** Replace the attached class set wholesale (join table, no soft delete). */
  async setClasses(
    examId: string,
    classIds: string[],
    tx?: PrismaClientLike,
  ): Promise<void> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.examClass.deleteMany({
      where: { examId, classId: { notIn: classIds } },
    });
    if (classIds.length === 0) return;
    await client.examClass.createMany({
      data: classIds.map((classId) => ({ examId, classId })),
      skipDuplicates: true,
    });
  }
}
