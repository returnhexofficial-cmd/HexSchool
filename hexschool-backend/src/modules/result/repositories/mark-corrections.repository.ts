import { Injectable } from '@nestjs/common';
import { MarkCorrection, Prisma } from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * The correction log. Insert and read only — no update, no delete, and
 * no soft-delete column to flip: the whole value of the table is that a
 * published number's history cannot be erased (roadmap M15 §6, and the
 * project's "published results are immutable; corrections leave an audit
 * trail" rule).
 */
@Injectable()
export class MarkCorrectionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: Prisma.MarkCorrectionUncheckedCreateInput,
    tx?: PrismaClientLike,
  ): Promise<MarkCorrection> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.markCorrection.create({ data });
  }

  async findForMark(markId: string): Promise<MarkCorrection[]> {
    return this.prisma.markCorrection.findMany({
      where: { markId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Every correction made to an exam — the republish changelog. */
  async findForExam(examId: string): Promise<MarkCorrection[]> {
    return this.prisma.markCorrection.findMany({
      where: { mark: { examId } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async countForExamSince(examId: string, since: Date): Promise<number> {
    return this.prisma.markCorrection.count({
      where: { mark: { examId }, createdAt: { gt: since } },
    });
  }
}
