import { Injectable } from '@nestjs/common';
import { AdmissionCycle, Prisma } from '@prisma/client';
import { AdmissionCycleStatus } from '../../../common/constants';
import { BaseRepository } from '../../../common/database/base.repository';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../common/dto/paginated.dto';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { AdmissionCycleQueryDto } from '../dto';

const DETAIL_INCLUDE = {
  session: { select: { id: true, name: true, startDate: true, endDate: true } },
  classes: {
    include: {
      class: { select: { id: true, name: true, numericLevel: true } },
    },
    orderBy: { class: { numericLevel: 'asc' } },
  },
  tests: true,
} satisfies Prisma.AdmissionCycleInclude;

export type AdmissionCycleDetail = Prisma.AdmissionCycleGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

@Injectable()
export class AdmissionCyclesRepository extends BaseRepository<
  AdmissionCycle,
  Prisma.AdmissionCycleWhereInput,
  Prisma.AdmissionCycleUncheckedCreateInput,
  Prisma.AdmissionCycleUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.admissionCycle, 'AdmissionCycle');
  }

  async paginateList(
    query: AdmissionCycleQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<AdmissionCycleDetail>> {
    const { page, limit } = query;
    const where: Prisma.AdmissionCycleWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.admissionCycle.findMany({
        where,
        include: DETAIL_INCLUDE,
        orderBy: { startAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.admissionCycle.count({ where }),
    ]);
    return { data: items, meta: buildPaginationMeta(page, limit, total) };
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<AdmissionCycleDetail | null> {
    return this.prisma.admissionCycle.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: DETAIL_INCLUDE,
    });
  }

  async findByName(
    name: string,
    schoolId: string,
  ): Promise<AdmissionCycle | null> {
    return this.findOne({ name }, schoolId);
  }

  /** Public landing: OPEN cycles currently inside their window. */
  async findOpenCycles(schoolId: string): Promise<AdmissionCycleDetail[]> {
    const now = new Date();
    return this.prisma.admissionCycle.findMany({
      where: {
        schoolId,
        deletedAt: null,
        status: AdmissionCycleStatus.OPEN,
        startAt: { lte: now },
        endAt: { gte: now },
      },
      include: DETAIL_INCLUDE,
      orderBy: { endAt: 'asc' },
    });
  }

  /** Replaces the per-class offer set (keeps rows whose class stays). */
  async replaceClasses(
    cycleId: string,
    entries: Array<{ classId: string; seats: number; applicationFee: number }>,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const keep = entries.map((e) => e.classId);
    await client.admissionCycleClass.deleteMany({
      where: { cycleId, classId: { notIn: keep } },
    });
    for (const entry of entries) {
      await client.admissionCycleClass.upsert({
        where: { cycleId_classId: { cycleId, classId: entry.classId } },
        create: {
          cycleId,
          classId: entry.classId,
          seats: entry.seats,
          applicationFee: entry.applicationFee,
        },
        update: { seats: entry.seats, applicationFee: entry.applicationFee },
      });
    }
  }
}
