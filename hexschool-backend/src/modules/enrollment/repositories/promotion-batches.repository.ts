import { Injectable } from '@nestjs/common';
import { Prisma, PromotionBatch } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../common/dto/paginated.dto';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { PromotionQueryDto } from '../dto';

const BATCH_INCLUDE = {
  fromSession: { select: { id: true, name: true } },
  toSession: { select: { id: true, name: true } },
  _count: { select: { items: true } },
} satisfies Prisma.PromotionBatchInclude;

export type PromotionBatchWithRelations = Prisma.PromotionBatchGetPayload<{
  include: typeof BATCH_INCLUDE;
}>;

/** PromotionBatch has no soft delete — status (DRAFT/EXECUTED/ROLLED_BACK)
 *  captures its lifecycle; DRAFT batches are hard-deletable. */
@Injectable()
export class PromotionBatchesRepository extends BaseRepository<
  PromotionBatch,
  Prisma.PromotionBatchWhereInput,
  Prisma.PromotionBatchUncheckedCreateInput,
  Prisma.PromotionBatchUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.promotionBatch, 'PromotionBatch', {
      softDeletable: false,
    });
  }

  async paginateList(
    query: PromotionQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<PromotionBatchWithRelations>> {
    const { page, limit } = query;
    const where: Prisma.PromotionBatchWhereInput = {
      schoolId,
      ...(query.fromSessionId ? { fromSessionId: query.fromSessionId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.promotionBatch.findMany({
        where,
        include: BATCH_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.promotionBatch.count({ where }),
    ]);
    return { data: items, meta: buildPaginationMeta(page, limit, total) };
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<PromotionBatchWithRelations | null> {
    return this.prisma.promotionBatch.findFirst({
      where: { id, schoolId },
      include: BATCH_INCLUDE,
    });
  }

  async hardDelete(id: string): Promise<void> {
    await this.prisma.promotionBatch.delete({ where: { id } });
  }
}
