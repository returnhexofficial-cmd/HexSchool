import { Injectable } from '@nestjs/common';
import { Prisma, ResultStatus } from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const RELATIONS = {
  enrollment: {
    select: {
      id: true,
      rollNo: true,
      classId: true,
      sectionId: true,
      groupId: true,
      status: true,
      optionalSubjectId: true,
      student: {
        select: {
          id: true,
          studentUid: true,
          firstName: true,
          lastName: true,
          photoUrl: true,
        },
      },
      class: { select: { id: true, name: true, numericLevel: true } },
      section: { select: { id: true, name: true } },
    },
  },
  exam: {
    select: {
      id: true,
      name: true,
      status: true,
      sessionId: true,
      examTypeId: true,
      startDate: true,
      endDate: true,
    },
  },
} satisfies Prisma.ResultInclude;

export type ResultWithRelations = Prisma.ResultGetPayload<{
  include: typeof RELATIONS;
}>;

export interface ResultFilter {
  classId?: string;
  sectionId?: string;
  status?: ResultStatus;
  search?: string;
}

/**
 * Results. One row per (exam, candidate), replaced in place by every
 * processing run — the run is idempotent precisely because this is an
 * upsert on `uq_results_exam_candidate` rather than a delete-and-insert
 * that would churn ids the publication log points at.
 */
@Injectable()
export class ResultsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── reads ───────────────────────────────────────────────────────────

  async findForExam(
    examId: string,
    filter: ResultFilter = {},
  ): Promise<ResultWithRelations[]> {
    return this.prisma.result.findMany({
      where: {
        examId,
        ...(filter.status ? { status: filter.status } : {}),
        enrollment: {
          ...(filter.classId ? { classId: filter.classId } : {}),
          ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
          ...(filter.search
            ? {
                student: {
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
              }
            : {}),
        },
      },
      include: RELATIONS,
      orderBy: [
        { enrollment: { class: { numericLevel: 'asc' } } },
        { enrollment: { section: { name: 'asc' } } },
        { enrollment: { rollNo: 'asc' } },
      ],
    });
  }

  async findById(
    id: string,
    schoolId: string,
  ): Promise<ResultWithRelations | null> {
    return this.prisma.result.findFirst({
      where: { id, schoolId },
      include: RELATIONS,
    });
  }

  async findForCandidate(
    examId: string,
    enrollmentId: string,
  ): Promise<ResultWithRelations | null> {
    return this.prisma.result.findFirst({
      where: { examId, enrollmentId },
      include: RELATIONS,
    });
  }

  /** A student's results across a session — the transcript. */
  async findForStudentSession(
    studentId: string,
    sessionId: string,
    schoolId: string,
  ): Promise<ResultWithRelations[]> {
    return this.prisma.result.findMany({
      where: {
        schoolId,
        exam: { sessionId, deletedAt: null },
        enrollment: { studentId, deletedAt: null },
      },
      include: RELATIONS,
      orderBy: { exam: { startDate: 'asc' } },
    });
  }

  /** Every result a student ever earned — the M09 performance history. */
  async findForStudent(
    studentId: string,
    schoolId: string,
  ): Promise<ResultWithRelations[]> {
    return this.prisma.result.findMany({
      where: {
        schoolId,
        enrollment: { studentId, deletedAt: null },
      },
      include: RELATIONS,
      orderBy: { exam: { startDate: 'desc' } },
    });
  }

  async countForExam(examId: string): Promise<number> {
    return this.prisma.result.count({ where: { examId } });
  }

  async countByStatus(
    examId: string,
  ): Promise<Array<{ status: ResultStatus; count: number }>> {
    const rows = await this.prisma.result.groupBy({
      by: ['status'],
      where: { examId },
      _count: { _all: true },
    });
    return rows.map((row) => ({ status: row.status, count: row._count._all }));
  }

  /** The public result search: one candidate by roll or by student UID. */
  async findPublished(
    examId: string,
    classId: string,
    identifier: { rollNo?: number; studentUid?: string },
  ): Promise<ResultWithRelations | null> {
    return this.prisma.result.findFirst({
      where: {
        examId,
        publishedAt: { not: null },
        status: { not: ResultStatus.WITHHELD },
        enrollment: {
          classId,
          deletedAt: null,
          ...(identifier.rollNo !== undefined
            ? { rollNo: identifier.rollNo }
            : {}),
          ...(identifier.studentUid
            ? { student: { studentUid: identifier.studentUid } }
            : {}),
        },
      },
      include: RELATIONS,
    });
  }

  // ── writes ──────────────────────────────────────────────────────────

  async upsert(
    data: Prisma.ResultUncheckedCreateInput,
    tx?: PrismaClientLike,
  ): Promise<string> {
    const client = (tx ?? this.prisma) as PrismaService;
    const { schoolId, examId, enrollmentId, createdBy, ...rest } = data;
    const row = await client.result.upsert({
      where: { examId_enrollmentId: { examId, enrollmentId } },
      create: { schoolId, examId, enrollmentId, createdBy, ...rest },
      // Merit positions are written in a second pass, so an upsert must
      // not carry stale ones forward from the previous run.
      update: {
        ...rest,
        meritPositionSection: null,
        meritPositionClass: null,
      },
      select: { id: true },
    });
    return row.id;
  }

  async setMerit(
    id: string,
    positions: { section: number | null; class: number | null },
    tx?: PrismaClientLike,
  ): Promise<void> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.result.update({
      where: { id },
      data: {
        meritPositionSection: positions.section,
        meritPositionClass: positions.class,
      },
    });
  }

  async update(
    id: string,
    data: Prisma.ResultUncheckedUpdateInput,
    tx?: PrismaClientLike,
  ): Promise<ResultWithRelations> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.result.update({ where: { id }, data, include: RELATIONS });
  }

  /** Stamp/clear the publication timestamp for a whole exam. */
  async setPublishedAt(
    examId: string,
    publishedAt: Date | null,
    tx?: PrismaClientLike,
  ): Promise<number> {
    const client = (tx ?? this.prisma) as PrismaService;
    const { count } = await client.result.updateMany({
      where: { examId },
      data: { publishedAt },
    });
    return count;
  }

  /**
   * Results whose candidate is no longer ACTIVE — a mid-exam transfer or
   * withdrawal. Excluded from merit and reported INCOMPLETE (roadmap §8).
   */
  async deleteForExam(examId: string, tx?: PrismaClientLike): Promise<number> {
    const client = (tx ?? this.prisma) as PrismaService;
    const { count } = await client.result.deleteMany({ where: { examId } });
    return count;
  }

  /** Unit-of-work helper (BaseRepository's, re-exposed for this repo). */
  async withTransaction<R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
  ): Promise<R> {
    return this.prisma.$transaction(fn);
  }
}
