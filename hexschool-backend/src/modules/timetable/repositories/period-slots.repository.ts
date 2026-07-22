import { Injectable } from '@nestjs/common';
import { PeriodSlot, Prisma } from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

export type PeriodSlotWithShift = Prisma.PeriodSlotGetPayload<{
  include: { shift: { select: { id: true; name: true } } };
}>;

const RELATIONS = {
  shift: { select: { id: true, name: true } },
} as const;

@Injectable()
export class PeriodSlotsRepository extends BaseRepository<
  PeriodSlot,
  Prisma.PeriodSlotWhereInput,
  Prisma.PeriodSlotUncheckedCreateInput,
  Prisma.PeriodSlotUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.periodSlot, 'PeriodSlot');
  }

  /** A shift's bell schedule, in display order (the grid's row axis). */
  async findForShift(
    shiftId: string,
    schoolId: string,
    tx?: PrismaClientLike,
  ): Promise<PeriodSlot[]> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.periodSlot.findMany({
      where: { shiftId, schoolId, deletedAt: null },
      orderBy: { displayOrder: 'asc' },
    });
  }

  /** Every live slot of the school (master grid, cross-shift conflicts). */
  async findAllWithShift(schoolId: string): Promise<PeriodSlotWithShift[]> {
    return this.prisma.periodSlot.findMany({
      where: { schoolId, deletedAt: null },
      include: RELATIONS,
      orderBy: [{ shift: { startTime: 'asc' } }, { displayOrder: 'asc' }],
    });
  }

  async findByIds(ids: string[], schoolId: string): Promise<PeriodSlot[]> {
    if (ids.length === 0) return [];
    return this.prisma.periodSlot.findMany({
      where: { id: { in: ids }, schoolId, deletedAt: null },
    });
  }

  /** Identity duplicate check (mirrors uq_period_slots_name/_order). */
  async findByIdentity(params: {
    shiftId: string;
    name?: string;
    displayOrder?: number;
    excludeId?: string;
  }): Promise<PeriodSlot | null> {
    return this.prisma.periodSlot.findFirst({
      where: {
        shiftId: params.shiftId,
        deletedAt: null,
        ...(params.name
          ? { name: { equals: params.name, mode: 'insensitive' } }
          : {}),
        ...(params.displayOrder !== undefined
          ? { displayOrder: params.displayOrder }
          : {}),
        ...(params.excludeId ? { id: { not: params.excludeId } } : {}),
      },
    });
  }

  /** Routine cells still referencing a slot — the delete guard. */
  async countEntries(slotId: string): Promise<number> {
    return this.prisma.timetableEntry.count({
      where: { periodSlotId: slotId },
    });
  }

  /** Attendance marked against a slot — a harder delete guard (M12). */
  async countAttendance(slotId: string): Promise<number> {
    return this.prisma.studentAttendance.count({
      where: { periodId: slotId, deletedAt: null },
    });
  }
}
