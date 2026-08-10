import { Injectable } from '@nestjs/common';
import { Prisma, ReportSchedule, ReportScheduleStatus } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

export interface ScheduleFilter {
  reportCode?: string;
  status?: ReportScheduleStatus;
  ownerId?: string;
  search?: string;
}

@Injectable()
export class ReportSchedulesRepository extends BaseRepository<
  ReportSchedule,
  Prisma.ReportScheduleWhereInput,
  Prisma.ReportScheduleUncheckedCreateInput,
  Prisma.ReportScheduleUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.reportSchedule, 'ReportSchedule');
  }

  async findAllFor(
    schoolId: string,
    filter: ScheduleFilter = {},
  ): Promise<ReportSchedule[]> {
    return this.prisma.reportSchedule.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(filter.reportCode ? { reportCode: filter.reportCode } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
        ...(filter.search
          ? { name: { contains: filter.search, mode: 'insensitive' } }
          : {}),
      },
      orderBy: [{ nextRunAt: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * The sweep's query — every ACTIVE schedule whose time has come, across
   * **every school**.
   *
   * The cron job cannot be per-school (one expression cannot be), so it
   * runs coarsely and this index scan over `(status, next_run_at)` is what
   * decides. `nextRunAt: null` is deliberately excluded: a null there
   * means the expression can never fire, and re-examining those rows every
   * minute forever is the sort of query that is invisible until the table
   * is large.
   */
  async findDue(now: Date, limit = 100): Promise<ReportSchedule[]> {
    return this.prisma.reportSchedule.findMany({
      where: {
        deletedAt: null,
        status: ReportScheduleStatus.ACTIVE,
        nextRunAt: { not: null, lte: now },
      },
      orderBy: { nextRunAt: 'asc' },
      take: limit,
    });
  }

  /** Every schedule that is still meant to fire, across every school. */
  async findLive(): Promise<ReportSchedule[]> {
    return this.prisma.reportSchedule.findMany({
      where: {
        deletedAt: null,
        status: { not: ReportScheduleStatus.DISABLED },
      },
    });
  }

  async findByOwner(ownerId: string): Promise<ReportSchedule[]> {
    return this.prisma.reportSchedule.findMany({
      where: {
        ownerId,
        deletedAt: null,
        status: { not: ReportScheduleStatus.DISABLED },
      },
    });
  }

  async markStarted(id: string, nextRunAt: Date | null): Promise<void> {
    await this.prisma.reportSchedule.update({
      where: { id },
      data: { lastRunAt: new Date(), nextRunAt },
    });
  }

  async recordOutcome(
    id: string,
    outcome:
      | { ok: true }
      | { ok: false; error: string; disable: boolean; reason?: string },
  ): Promise<void> {
    if (outcome.ok) {
      await this.prisma.reportSchedule.update({
        where: { id },
        data: { lastStatus: 'DONE', lastError: null, failureCount: 0 },
      });
      return;
    }
    await this.prisma.reportSchedule.update({
      where: { id },
      data: {
        lastStatus: 'FAILED',
        lastError: outcome.error.slice(0, 2000),
        failureCount: { increment: 1 },
        ...(outcome.disable
          ? {
              status: ReportScheduleStatus.DISABLED,
              disabledReason:
                outcome.reason ??
                'Disabled after repeated failures — see the last error',
            }
          : {}),
      },
    });
  }

  async disableAll(ids: string[], reason: string): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.prisma.reportSchedule.updateMany({
      where: { id: { in: ids } },
      data: {
        status: ReportScheduleStatus.DISABLED,
        disabledReason: reason,
        nextRunAt: null,
      },
    });
    return result.count;
  }
}
