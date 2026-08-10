import { Injectable } from '@nestjs/common';
import { Prisma, ReportRun, ReportRunStatus } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';
import type { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import type { PaginatedResult } from '../../../common/dto/paginated.dto';

export interface RunFilter {
  reportCode?: string;
  status?: ReportRunStatus;
  requestedBy?: string;
  scheduleId?: string;
}

/**
 * `report_runs` — the export centre's table.
 *
 * **Not soft-deletable.** A run is a machine record with a thirty-day life
 * (roadmap §4's retention), and the retention job removes the row and the
 * S3 object together. A soft delete here would leave the file behind and
 * the row unreachable, which is the worst of both.
 */
@Injectable()
export class ReportRunsRepository extends BaseRepository<
  ReportRun,
  Prisma.ReportRunWhereInput,
  Prisma.ReportRunUncheckedCreateInput,
  Prisma.ReportRunUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.reportRun, 'ReportRun', {
      softDeletable: false,
    });
  }

  paginateFor(
    schoolId: string,
    query: PaginationQueryDto,
    filter: RunFilter = {},
  ): Promise<PaginatedResult<ReportRun>> {
    return this.paginate(query, {
      schoolId,
      sortableColumns: ['createdAt', 'finishedAt', 'rowCount', 'durationMs'],
      where: {
        ...(filter.reportCode ? { reportCode: filter.reportCode } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.requestedBy ? { requestedBy: filter.requestedBy } : {}),
        ...(filter.scheduleId ? { scheduleId: filter.scheduleId } : {}),
      },
    });
  }

  async markRunning(id: string): Promise<void> {
    await this.prisma.reportRun.update({
      where: { id },
      data: { status: ReportRunStatus.RUNNING, startedAt: new Date() },
    });
  }

  async markDone(
    id: string,
    result: {
      fileKey: string;
      fileBucket: string;
      fileUrl: string;
      fileSize: number;
      rowCount: number;
      durationMs: number;
      strippedColumns: string[];
      expiresAt: Date;
    },
  ): Promise<ReportRun> {
    return this.prisma.reportRun.update({
      where: { id },
      data: {
        status: ReportRunStatus.DONE,
        finishedAt: new Date(),
        ...result,
      },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.reportRun.update({
      where: { id },
      data: {
        status: ReportRunStatus.FAILED,
        finishedAt: new Date(),
        // The CHECK constraint refuses a FAILED run with a blank error, so
        // a thrown value that stringifies to nothing has to be given words
        // here rather than at the database's expense.
        error: (error.trim() || 'The report failed with no message').slice(
          0,
          4000,
        ),
      },
    });
  }

  /**
   * Runs whose file has passed its retention date. Returns the S3
   * coordinates too, because the object has to go with the row and a
   * signed URL cannot be used to find it again.
   */
  async findExpired(
    now: Date,
    limit = 500,
  ): Promise<
    Array<{ id: string; fileBucket: string | null; fileKey: string | null }>
  > {
    return this.prisma.reportRun.findMany({
      where: { expiresAt: { not: null, lte: now } },
      select: { id: true, fileBucket: true, fileKey: true },
      take: limit,
    });
  }

  async deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.prisma.reportRun.deleteMany({
      where: { id: { in: ids } },
    });
    return result.count;
  }

  /**
   * Runs stuck in RUNNING past a deadline — a worker that died mid-report.
   * Without this they sit in the export centre spinning forever, which is
   * the failure mode that makes a user re-queue the same 50k-row job five
   * times.
   */
  async findStale(before: Date, limit = 100): Promise<ReportRun[]> {
    return this.prisma.reportRun.findMany({
      where: {
        status: { in: [ReportRunStatus.QUEUED, ReportRunStatus.RUNNING] },
        createdAt: { lt: before },
      },
      take: limit,
    });
  }
}
