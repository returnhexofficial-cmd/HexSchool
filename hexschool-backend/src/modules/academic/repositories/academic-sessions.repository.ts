import { Injectable } from '@nestjs/common';
import { AcademicSession, Prisma, SessionStatus } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

@Injectable()
export class AcademicSessionsRepository extends BaseRepository<
  AcademicSession,
  Prisma.AcademicSessionWhereInput,
  Prisma.AcademicSessionUncheckedCreateInput,
  Prisma.AcademicSessionUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.academicSession, 'AcademicSession');
  }

  /** Sessions whose date range intersects [start, end], excluding one id. */
  async findOverlapping(
    schoolId: string,
    startDate: Date,
    endDate: Date,
    excludeId?: string,
  ): Promise<AcademicSession[]> {
    return this.prisma.academicSession.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
  }

  async findCurrent(schoolId: string): Promise<AcademicSession | null> {
    return this.findOne({ isCurrent: true }, schoolId);
  }

  /**
   * Transactional switch (roadmap M05 §4): demote the current session
   * (year rollover: an ACTIVE one becomes COMPLETED), promote the target
   * to ACTIVE + current. The partial unique index backs the invariant.
   */
  async activate(id: string, schoolId: string): Promise<AcademicSession> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.academicSession.findFirst({
        where: { schoolId, isCurrent: true, deletedAt: null },
      });
      if (current && current.id !== id) {
        await tx.academicSession.update({
          where: { id: current.id },
          data: {
            isCurrent: false,
            ...(current.status === SessionStatus.ACTIVE
              ? { status: SessionStatus.COMPLETED }
              : {}),
          },
        });
      }
      return tx.academicSession.update({
        where: { id },
        data: { isCurrent: true, status: SessionStatus.ACTIVE },
      });
    });
  }

  /** Attached holiday/event counts (delete guard + list badges). */
  async countAttachments(
    sessionId: string,
  ): Promise<{ holidays: number; events: number }> {
    const [holidays, events] = await Promise.all([
      this.prisma.holiday.count({ where: { sessionId } }),
      this.prisma.calendarEvent.count({
        where: { sessionId, deletedAt: null },
      }),
    ]);
    return { holidays, events };
  }

  /** Attached rows falling outside [start, end] (date-shrink guard). */
  async countAttachmentsOutsideRange(
    sessionId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const outside = {
      OR: [{ startDate: { lt: startDate } }, { endDate: { gt: endDate } }],
    };
    const [holidays, events] = await Promise.all([
      this.prisma.holiday.count({ where: { sessionId, ...outside } }),
      this.prisma.calendarEvent.count({
        where: { sessionId, deletedAt: null, ...outside },
      }),
    ]);
    return holidays + events;
  }
}
