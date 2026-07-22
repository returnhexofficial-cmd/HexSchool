import { Injectable } from '@nestjs/common';
import { Prisma, ResultRun, ResultRunStatus } from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * Processing runs. Progress is persisted here rather than left in BullMQ
 * so `GET /process/status` keeps answering across a Redis restart, and so
 * a run that died halfway leaves an explainable record instead of a
 * silently missing job.
 */
@Injectable()
export class ResultRunsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, schoolId: string): Promise<ResultRun | null> {
    return this.prisma.resultRun.findFirst({ where: { id, schoolId } });
  }

  /** The run the status endpoint reports on — always the newest. */
  async findLatest(examId: string): Promise<ResultRun | null> {
    return this.prisma.resultRun.findFirst({
      where: { examId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findLatestCompleted(examId: string): Promise<ResultRun | null> {
    return this.prisma.resultRun.findFirst({
      where: { examId, status: ResultRunStatus.COMPLETED },
      orderBy: { finishedAt: 'desc' },
    });
  }

  async findRecent(examId: string, take = 10): Promise<ResultRun[]> {
    return this.prisma.resultRun.findMany({
      where: { examId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** Is a run already in flight? Two concurrent runs would race merit. */
  async findActive(examId: string): Promise<ResultRun | null> {
    return this.prisma.resultRun.findFirst({
      where: {
        examId,
        status: { in: [ResultRunStatus.QUEUED, ResultRunStatus.RUNNING] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    data: Prisma.ResultRunUncheckedCreateInput,
    tx?: PrismaClientLike,
  ): Promise<ResultRun> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.resultRun.create({ data });
  }

  async update(
    id: string,
    data: Prisma.ResultRunUncheckedUpdateInput,
    tx?: PrismaClientLike,
  ): Promise<ResultRun> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.resultRun.update({ where: { id }, data });
  }
}
