import { Injectable } from '@nestjs/common';
import { Prisma, Purchase, PurchaseItem, PurchaseStatus } from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const PURCHASE_INCLUDE = {
  supplier: { select: { id: true, name: true, phone: true, status: true } },
  items: {
    include: {
      item: {
        select: {
          id: true,
          code: true,
          name: true,
          unit: true,
          type: true,
          packSize: true,
          packLabel: true,
          // The posting map keys on it — see `InventoryPostingService`.
          categoryId: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.PurchaseInclude;

export type PurchaseWithLines = Prisma.PurchaseGetPayload<{
  include: typeof PURCHASE_INCLUDE;
}>;

@Injectable()
export class PurchasesRepository extends BaseRepository<
  Purchase,
  Prisma.PurchaseWhereInput,
  Prisma.PurchaseUncheckedCreateInput,
  Prisma.PurchaseUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.purchase, 'Purchase');
  }

  async findDetail(
    id: string,
    schoolId: string,
    tx?: PrismaClientLike,
  ): Promise<PurchaseWithLines | null> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.purchase.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: PURCHASE_INCLUDE,
    });
  }

  async findManyLive(
    schoolId: string,
    filter: {
      status?: PurchaseStatus;
      supplierId?: string;
      from?: Date;
      to?: Date;
    } = {},
  ): Promise<PurchaseWithLines[]> {
    return this.prisma.purchase.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.supplierId ? { supplierId: filter.supplierId } : {}),
        ...(filter.from || filter.to
          ? {
              date: {
                ...(filter.from ? { gte: filter.from } : {}),
                ...(filter.to ? { lte: filter.to } : {}),
              },
            }
          : {}),
      },
      include: PURCHASE_INCLUDE,
      orderBy: [{ date: 'desc' }, { purchaseNo: 'desc' }],
    });
  }

  /**
   * Replace a draft's lines wholesale — hard delete then insert, the M13
   * `timetable_entries` / M20 `voucher_entries` pattern. Both halves take
   * the caller's transaction, so a failed insert cannot leave a purchase
   * with no lines and a stale total.
   */
  async replaceLines(
    purchaseId: string,
    lines: Prisma.PurchaseItemUncheckedCreateInput[],
    tx: PrismaClientLike,
  ): Promise<void> {
    const client = tx as PrismaService;
    await client.purchaseItem.deleteMany({ where: { purchaseId } });
    if (lines.length > 0) {
      await client.purchaseItem.createMany({ data: lines });
    }
  }

  async linesFor(
    purchaseId: string,
    tx?: PrismaClientLike,
  ): Promise<PurchaseItem[]> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.purchaseItem.findMany({
      where: { purchaseId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async setStatus(
    id: string,
    data: Prisma.PurchaseUncheckedUpdateInput,
    tx: PrismaClientLike,
  ): Promise<Purchase> {
    const client = tx as PrismaService;
    return client.purchase.update({ where: { id }, data });
  }
}
