import { Injectable } from '@nestjs/common';
import { Prisma, StockLedgerEntry } from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * The stock ledger. **Append-only**: this repository deliberately exposes
 * no update and no delete, and `BaseRepository` is constructed with
 * `softDeletable: false` because the table has no `deleted_at` — the
 * `audit_logs` / `sms_credits` (M17) / `pf_ledger` (M21) shape.
 *
 * The one interesting method is `currentBalanceForUpdate`, and everything
 * about how this module behaves under concurrency comes down to it.
 */
@Injectable()
export class StockLedgerRepository extends BaseRepository<
  StockLedgerEntry,
  Prisma.StockLedgerEntryWhereInput,
  Prisma.StockLedgerEntryUncheckedCreateInput,
  Prisma.StockLedgerEntryUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.stockLedgerEntry, 'StockLedgerEntry', {
      softDeletable: false,
    });
  }

  /**
   * **The row lock that makes the running balance correct.**
   *
   * `balance_after` is a stored running total, which means two issues of
   * the same item running concurrently must not both read the same
   * starting balance — they would each write a balance computed against
   * it, and the column would silently stop adding up. (`findBalanceBreak`
   * in the engine is what detects that after the fact; this is what
   * prevents it.)
   *
   * `SELECT … FOR UPDATE` on the ITEM row is the lock, not on the ledger:
   * the ledger row does not exist yet, and locking "the last entry" races
   * with an insert. Taking it on the item serializes every movement of
   * that item and nothing else, so two clerks issuing different items
   * never wait on each other.
   *
   * Must be called inside a transaction — the lock is released at commit,
   * and outside one it would be released immediately and buy nothing.
   */
  async lockItemAndReadBalance(
    tx: PrismaClientLike,
    itemId: string,
    schoolId: string,
  ): Promise<number> {
    const client = tx as PrismaService;

    // The lock. The result is discarded: what matters is that no other
    // transaction may touch this item's row until this one commits.
    await client.$queryRaw`SELECT id FROM items WHERE id = ${itemId}::uuid AND school_id = ${schoolId}::uuid FOR UPDATE`;

    const last = await client.stockLedgerEntry.findFirst({
      where: { itemId, schoolId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { balanceAfter: true },
    });
    return last ? Number(last.balanceAfter) : 0;
  }

  /**
   * Balances for a set of items, unlocked — for reads (the catalogue, the
   * stock report, the issue desk's preview). A read that is about to
   * become a write must go through `lockItemAndReadBalance` instead.
   *
   * `DISTINCT ON` is the one place this module needs raw SQL: "the latest
   * ledger row per item" has no Prisma expression, and the alternative —
   * one query per item — is the N+1 that makes a 400-item catalogue
   * unusable.
   */
  async balances(
    schoolId: string,
    itemIds?: string[],
  ): Promise<Map<string, number>> {
    const rows = itemIds
      ? await this.prisma.$queryRaw<
          Array<{ item_id: string; balance: string }>
        >`
          SELECT DISTINCT ON (item_id) item_id, balance_after AS balance
          FROM stock_ledger
          WHERE school_id = ${schoolId}::uuid AND item_id = ANY(${itemIds}::uuid[])
          ORDER BY item_id, created_at DESC, id DESC`
      : await this.prisma.$queryRaw<
          Array<{ item_id: string; balance: string }>
        >`
          SELECT DISTINCT ON (item_id) item_id, balance_after AS balance
          FROM stock_ledger
          WHERE school_id = ${schoolId}::uuid
          ORDER BY item_id, created_at DESC, id DESC`;

    return new Map(rows.map((row) => [row.item_id, Number(row.balance)]));
  }

  async balanceFor(schoolId: string, itemId: string): Promise<number> {
    const balances = await this.balances(schoolId, [itemId]);
    return balances.get(itemId) ?? 0;
  }

  /** One item's movements, oldest first — the item-ledger report. */
  async history(
    schoolId: string,
    itemId: string,
    range?: { from?: Date; to?: Date },
  ): Promise<StockLedgerEntry[]> {
    return this.prisma.stockLedgerEntry.findMany({
      where: {
        schoolId,
        itemId,
        ...(range?.from || range?.to
          ? {
              createdAt: {
                ...(range.from ? { gte: range.from } : {}),
                ...(range.to ? { lte: range.to } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Movements out, by reference — the consumption report's raw material.
   * ISSUE rows count against the holder and RETURN rows count back, which
   * is what makes that report net (see `consumptionByHolder`).
   */
  async movementsByRef(
    schoolId: string,
    refTypes: string[],
    range?: { from?: Date; to?: Date },
  ): Promise<StockLedgerEntry[]> {
    return this.prisma.stockLedgerEntry.findMany({
      where: {
        schoolId,
        refType: { in: refTypes },
        ...(range?.from || range?.to
          ? {
              createdAt: {
                ...(range.from ? { gte: range.from } : {}),
                ...(range.to ? { lte: range.to } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  async countForItem(schoolId: string, itemId: string): Promise<number> {
    return this.prisma.stockLedgerEntry.count({ where: { schoolId, itemId } });
  }
}
