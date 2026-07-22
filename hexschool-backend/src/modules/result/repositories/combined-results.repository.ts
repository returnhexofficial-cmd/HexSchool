import { Injectable } from '@nestjs/common';
import { CombinedResult, Prisma } from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const RELATIONS = {
  enrollment: {
    select: {
      id: true,
      rollNo: true,
      classId: true,
      sectionId: true,
      student: {
        select: { id: true, studentUid: true, firstName: true, lastName: true },
      },
      class: { select: { id: true, name: true, numericLevel: true } },
      section: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.CombinedResultInclude;

export type CombinedResultWithRelations = Prisma.CombinedResultGetPayload<{
  include: typeof RELATIONS;
}>;

/** Weighted final results, keyed by (session, batch name, candidate). */
@Injectable()
export class CombinedResultsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findBatch(
    sessionId: string,
    name: string,
    filter: { classId?: string; sectionId?: string } = {},
  ): Promise<CombinedResultWithRelations[]> {
    return this.prisma.combinedResult.findMany({
      where: {
        sessionId,
        name,
        enrollment: {
          ...(filter.classId ? { classId: filter.classId } : {}),
          ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
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

  /** Distinct batch names of a session — the picker on the results page. */
  async findBatchNames(
    sessionId: string,
    schoolId: string,
  ): Promise<Array<{ name: string; generatedAt: Date; candidates: number }>> {
    const rows = await this.prisma.combinedResult.groupBy({
      by: ['name'],
      where: { sessionId, schoolId },
      _count: { _all: true },
      _max: { generatedAt: true },
    });
    return rows
      .map((row) => ({
        name: row.name,
        generatedAt: row._max.generatedAt ?? new Date(0),
        candidates: row._count._all,
      }))
      .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
  }

  async findForStudent(
    studentId: string,
    schoolId: string,
  ): Promise<CombinedResultWithRelations[]> {
    return this.prisma.combinedResult.findMany({
      where: { schoolId, enrollment: { studentId, deletedAt: null } },
      include: RELATIONS,
      orderBy: { generatedAt: 'desc' },
    });
  }

  async upsert(
    data: Prisma.CombinedResultUncheckedCreateInput,
    tx?: PrismaClientLike,
  ): Promise<string> {
    const client = (tx ?? this.prisma) as PrismaService;
    const { schoolId, sessionId, name, enrollmentId, createdBy, ...rest } =
      data;
    const row = await client.combinedResult.upsert({
      where: {
        sessionId_name_enrollmentId: { sessionId, name, enrollmentId },
      },
      create: { schoolId, sessionId, name, enrollmentId, createdBy, ...rest },
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
    await client.combinedResult.update({
      where: { id },
      data: {
        meritPositionSection: positions.section,
        meritPositionClass: positions.class,
      },
    });
  }

  async deleteBatch(
    sessionId: string,
    name: string,
    tx?: PrismaClientLike,
  ): Promise<number> {
    const client = (tx ?? this.prisma) as PrismaService;
    const { count } = await client.combinedResult.deleteMany({
      where: { sessionId, name },
    });
    return count;
  }

  async findOne(id: string, schoolId: string): Promise<CombinedResult | null> {
    return this.prisma.combinedResult.findFirst({ where: { id, schoolId } });
  }

  /** Unit-of-work helper (BaseRepository's, re-exposed for this repo). */
  async withTransaction<R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
  ): Promise<R> {
    return this.prisma.$transaction(fn);
  }
}
