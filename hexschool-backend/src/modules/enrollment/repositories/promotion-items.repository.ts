import { Injectable } from '@nestjs/common';
import { Prisma, PromotionItem } from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const ITEM_INCLUDE = {
  student: {
    select: {
      id: true,
      studentUid: true,
      firstName: true,
      lastName: true,
      nameBn: true,
    },
  },
  toClass: { select: { id: true, name: true, numericLevel: true } },
  toSection: { select: { id: true, name: true } },
  fromEnrollment: {
    select: {
      id: true,
      rollNo: true,
      classId: true,
      sectionId: true,
      class: { select: { id: true, name: true, numericLevel: true } },
      section: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.PromotionItemInclude;

export type PromotionItemWithRelations = Prisma.PromotionItemGetPayload<{
  include: typeof ITEM_INCLUDE;
}>;

@Injectable()
export class PromotionItemsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMany(
    rows: Prisma.PromotionItemUncheckedCreateInput[],
    tx?: PrismaClientLike,
  ): Promise<number> {
    const client = (tx ?? this.prisma) as PrismaService;
    const { count } = await client.promotionItem.createMany({ data: rows });
    return count;
  }

  async findForBatch(batchId: string): Promise<PromotionItemWithRelations[]> {
    return this.prisma.promotionItem.findMany({
      where: { batchId },
      include: ITEM_INCLUDE,
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  async findById(id: string): Promise<PromotionItem | null> {
    return this.prisma.promotionItem.findUnique({ where: { id } });
  }

  async update(
    id: string,
    data: Prisma.PromotionItemUncheckedUpdateInput,
    tx?: PrismaClientLike,
  ): Promise<PromotionItem> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.promotionItem.update({ where: { id }, data });
  }

  async deleteForBatch(batchId: string, tx?: PrismaClientLike): Promise<void> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.promotionItem.deleteMany({ where: { batchId } });
  }
}
