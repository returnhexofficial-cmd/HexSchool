import { Injectable } from '@nestjs/common';
import { Holiday, HolidayAppliesTo, Prisma } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/** Hard-deleted (no soft delete per spec) — hence softDeletable: false. */
@Injectable()
export class HolidaysRepository extends BaseRepository<
  Holiday,
  Prisma.HolidayWhereInput,
  Prisma.HolidayUncheckedCreateInput,
  Prisma.HolidayUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.holiday, 'Holiday', {
      softDeletable: false,
    });
  }

  async hardDelete(id: string): Promise<void> {
    await this.prisma.holiday.delete({ where: { id } });
  }

  /** Holidays intersecting [from, to] (month grid + iCal). */
  async findInRange(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<Holiday[]> {
    return this.prisma.holiday.findMany({
      where: {
        schoolId,
        startDate: { lte: to },
        endDate: { gte: from },
      },
      orderBy: { startDate: 'asc' },
    });
  }

  /** Any holiday covering `date` (isHoliday core). */
  async findCovering(
    schoolId: string,
    date: Date,
    appliesTo?: HolidayAppliesTo,
  ): Promise<Holiday | null> {
    return this.prisma.holiday.findFirst({
      where: {
        schoolId,
        startDate: { lte: date },
        endDate: { gte: date },
        ...(appliesTo
          ? { appliesTo: { in: [appliesTo, HolidayAppliesTo.ALL] } }
          : {}),
      },
    });
  }
}
