import { Injectable } from '@nestjs/common';
import { Item, ItemCategory, Prisma, Supplier } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

@Injectable()
export class SuppliersRepository extends BaseRepository<
  Supplier,
  Prisma.SupplierWhereInput,
  Prisma.SupplierUncheckedCreateInput,
  Prisma.SupplierUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.supplier, 'Supplier');
  }

  /** Matched the way `uq_suppliers_name` sees it, so the service's 409 and
   *  the database's constraint agree about what "the same name" means. */
  async findByName(
    schoolId: string,
    name: string,
    excludeId?: string,
  ): Promise<Supplier | null> {
    return this.prisma.supplier.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  async countPurchases(supplierId: string): Promise<number> {
    return this.prisma.purchase.count({
      where: { supplierId, deletedAt: null },
    });
  }
}

const CATEGORY_SELECT = {
  id: true,
  parentId: true,
  name: true,
  nameBn: true,
  description: true,
} satisfies Prisma.ItemCategorySelect;

export type CategoryNode = Prisma.ItemCategoryGetPayload<{
  select: typeof CATEGORY_SELECT;
}> & { children: CategoryNode[]; itemCount: number };

@Injectable()
export class ItemCategoriesRepository extends BaseRepository<
  ItemCategory,
  Prisma.ItemCategoryWhereInput,
  Prisma.ItemCategoryUncheckedCreateInput,
  Prisma.ItemCategoryUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.itemCategory, 'ItemCategory');
  }

  async findAllLive(schoolId: string) {
    return this.prisma.itemCategory.findMany({
      where: { schoolId, deletedAt: null },
      select: CATEGORY_SELECT,
      orderBy: [{ name: 'asc' }],
    });
  }

  /**
   * Sibling-name collision, NULL-safe over the optional parent — the same
   * comparison `uq_item_categories_identity` makes with its COALESCE.
   * Prisma cannot express that index, so the check is written twice; this
   * one exists to say *why*, and the index is what holds.
   */
  async findSibling(
    schoolId: string,
    parentId: string | null,
    name: string,
    excludeId?: string,
  ): Promise<ItemCategory | null> {
    return this.prisma.itemCategory.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        parentId,
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  async countChildren(categoryId: string): Promise<number> {
    return this.prisma.itemCategory.count({
      where: { parentId: categoryId, deletedAt: null },
    });
  }

  async countItems(categoryId: string): Promise<number> {
    return this.prisma.item.count({
      where: { categoryId, deletedAt: null },
    });
  }

  async itemCounts(schoolId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.item.groupBy({
      by: ['categoryId'],
      where: { schoolId, deletedAt: null, categoryId: { not: null } },
      _count: { _all: true },
    });
    return new Map(
      rows.map((row) => [row.categoryId as string, row._count._all]),
    );
  }
}

const ITEM_INCLUDE = {
  category: { select: { id: true, name: true } },
} satisfies Prisma.ItemInclude;

export type ItemWithCategory = Prisma.ItemGetPayload<{
  include: typeof ITEM_INCLUDE;
}>;

@Injectable()
export class ItemsRepository extends BaseRepository<
  Item,
  Prisma.ItemWhereInput,
  Prisma.ItemUncheckedCreateInput,
  Prisma.ItemUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.item, 'Item');
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<ItemWithCategory | null> {
    return this.prisma.item.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: ITEM_INCLUDE,
    });
  }

  async findManyLive(
    schoolId: string,
    filter: {
      type?: Item['type'];
      categoryId?: string;
      search?: string;
      ids?: string[];
    } = {},
  ): Promise<ItemWithCategory[]> {
    return this.prisma.item.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
        ...(filter.ids ? { id: { in: filter.ids } } : {}),
        ...(filter.search
          ? {
              OR: [
                { name: { contains: filter.search, mode: 'insensitive' } },
                { code: { contains: filter.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: ITEM_INCLUDE,
      orderBy: [{ name: 'asc' }],
    });
  }

  async findByCode(
    schoolId: string,
    code: string,
    excludeId?: string,
  ): Promise<Item | null> {
    return this.prisma.item.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        code: { equals: code.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  /** Every place an item is referenced — the M06 delete-guard needs the
   *  counts, not a boolean, because the 409 names them. */
  async usage(itemId: string): Promise<{
    ledger: number;
    purchases: number;
    issues: number;
    assets: number;
  }> {
    const [ledger, purchases, issues, assets] = await Promise.all([
      this.prisma.stockLedgerEntry.count({ where: { itemId } }),
      this.prisma.purchaseItem.count({ where: { itemId } }),
      this.prisma.stockIssueItem.count({ where: { itemId } }),
      this.prisma.assetUnit.count({ where: { itemId, deletedAt: null } }),
    ]);
    return { ledger, purchases, issues, assets };
  }
}
