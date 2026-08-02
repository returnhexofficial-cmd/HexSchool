import { Injectable } from '@nestjs/common';
import {
  AssetUnit,
  AssetUnitStatus,
  InventoryHolderType,
  Prisma,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const ASSET_INCLUDE = {
  item: {
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      categoryId: true,
      category: { select: { id: true, name: true } },
    },
  },
  custodianDept: { select: { id: true, name: true, code: true } },
} satisfies Prisma.AssetUnitInclude;

export type AssetWithRelations = Prisma.AssetUnitGetPayload<{
  include: typeof ASSET_INCLUDE;
}>;

/**
 * Roadmap §6: "DISPOSED/LOST assets excluded from register counts". The
 * predicate lives here rather than being spelled out at each call site,
 * so a new report cannot accidentally count the twelve chairs the school
 * wrote off in 2019 — the M19 `published*` helper idea applied to a
 * status filter.
 */
export const ON_BOOKS: AssetUnitStatus[] = [
  AssetUnitStatus.IN_STORE,
  AssetUnitStatus.ASSIGNED,
  AssetUnitStatus.UNDER_REPAIR,
];

@Injectable()
export class AssetUnitsRepository extends BaseRepository<
  AssetUnit,
  Prisma.AssetUnitWhereInput,
  Prisma.AssetUnitUncheckedCreateInput,
  Prisma.AssetUnitUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.assetUnit, 'AssetUnit');
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<AssetWithRelations | null> {
    return this.prisma.assetUnit.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: ASSET_INCLUDE,
    });
  }

  async findManyLive(
    schoolId: string,
    filter: {
      status?: AssetUnitStatus;
      /** Omit to see everything; `true` applies the §6 register filter. */
      onBooksOnly?: boolean;
      itemId?: string;
      categoryId?: string;
      custodianType?: InventoryHolderType;
      departmentId?: string;
      personId?: string;
      search?: string;
      warrantyBefore?: Date;
    } = {},
  ): Promise<AssetWithRelations[]> {
    return this.prisma.assetUnit.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.onBooksOnly ? { status: { in: ON_BOOKS } } : {}),
        ...(filter.itemId ? { itemId: filter.itemId } : {}),
        ...(filter.categoryId
          ? { item: { categoryId: filter.categoryId } }
          : {}),
        ...(filter.custodianType
          ? { custodianType: filter.custodianType }
          : {}),
        ...(filter.departmentId
          ? { custodianDeptId: filter.departmentId }
          : {}),
        ...(filter.personId ? { custodianPersonId: filter.personId } : {}),
        ...(filter.warrantyBefore
          ? { warrantyUntil: { lte: filter.warrantyBefore } }
          : {}),
        ...(filter.search
          ? {
              OR: [
                { assetTag: { contains: filter.search, mode: 'insensitive' } },
                { serialNo: { contains: filter.search, mode: 'insensitive' } },
                {
                  locationText: {
                    contains: filter.search,
                    mode: 'insensitive',
                  },
                },
                {
                  item: {
                    name: { contains: filter.search, mode: 'insensitive' },
                  },
                },
              ],
            }
          : {}),
      },
      include: ASSET_INCLUDE,
      orderBy: [{ assetTag: 'asc' }],
    });
  }

  /**
   * Tag collision, matched the way `uq_asset_units_tag` sees it — and
   * **without** a `deletedAt` filter, because that index ignores soft
   * deletes. Checking only live rows here would produce a 500 from the
   * constraint on a tag a school had deleted, instead of the 409 that
   * explains the never-reuse rule.
   */
  async findByTag(
    schoolId: string,
    assetTag: string,
    excludeId?: string,
  ): Promise<AssetUnit | null> {
    return this.prisma.assetUnit.findFirst({
      where: {
        schoolId,
        assetTag: { equals: assetTag.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  /** The serial IS scoped to live rows — see the migration's comment. */
  async findBySerial(
    schoolId: string,
    serialNo: string,
    excludeId?: string,
  ): Promise<AssetUnit | null> {
    return this.prisma.assetUnit.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        serialNo: { equals: serialNo.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  async createMany(
    rows: Prisma.AssetUnitUncheckedCreateInput[],
    tx: PrismaClientLike,
  ): Promise<void> {
    const client = tx as PrismaService;
    if (rows.length > 0) {
      await client.assetUnit.createMany({ data: rows });
    }
  }

  /** Register counts per status, for the dashboard tiles. */
  async countsByStatus(
    schoolId: string,
  ): Promise<Map<AssetUnitStatus, number>> {
    const rows = await this.prisma.assetUnit.groupBy({
      by: ['status'],
      where: { schoolId, deletedAt: null },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.status, row._count._all]));
  }

  async countForPurchase(purchaseId: string): Promise<number> {
    return this.prisma.assetUnit.count({
      where: { purchaseItem: { purchaseId }, deletedAt: null },
    });
  }

  /** Units generated by a purchase, for the cancel guard. */
  async findForPurchase(
    purchaseId: string,
    tx?: PrismaClientLike,
  ): Promise<AssetUnit[]> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.assetUnit.findMany({
      where: { purchaseItem: { purchaseId }, deletedAt: null },
    });
  }
}
