import { Injectable } from '@nestjs/common';
import { CalendarEvent, Prisma } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

@Injectable()
export class CalendarEventsRepository extends BaseRepository<
  CalendarEvent,
  Prisma.CalendarEventWhereInput,
  Prisma.CalendarEventUncheckedCreateInput,
  Prisma.CalendarEventUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.calendarEvent, 'CalendarEvent');
  }

  /** Events intersecting [from, to] (month grid + iCal). */
  async findInRange(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<CalendarEvent[]> {
    return this.prisma.calendarEvent.findMany({
      where: {
        schoolId,
        deletedAt: null,
        startDate: { lte: to },
        endDate: { gte: from },
      },
      orderBy: { startDate: 'asc' },
    });
  }
}
