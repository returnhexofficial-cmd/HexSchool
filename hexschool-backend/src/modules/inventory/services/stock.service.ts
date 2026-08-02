import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, StockTxnType } from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';
import {
  applyMovement,
  REF_TYPES,
  type MovementInput,
} from '../calc/stock-ledger.engine';
import { qty } from '../calc/unit.util';
import { StockLedgerRepository } from '../repositories/stock.repository';

export interface MovementRequest {
  itemId: string;
  txn: StockTxnType;
  /** Base units, positive. Direction comes from `txn` (or `direction`). */
  quantity: number;
  direction?: 'IN' | 'OUT';
  refType?: string;
  refId?: string;
  unitCost?: number | null;
  remarks?: string | null;
}

/**
 * **The one write path into stock.**
 *
 * Every movement in this module — receiving a delivery, issuing a gate
 * pass, taking a return, correcting a count, writing an asset off — goes
 * through `record` or `recordMany`. Nothing else writes to `stock_ledger`,
 * and nothing anywhere stores a balance, so the ledger and the balance
 * cannot drift apart: the M20 `VoucherService` shape, applied to things
 * instead of money.
 *
 * **Concurrency is the reason this is a service rather than a helper.**
 * `balance_after` is a stored running total, so between reading the
 * current balance and writing the next row, no other transaction may move
 * the same item. `lockItemAndReadBalance` takes `FOR UPDATE` on the
 * *item* row to hold that window open — and it is why every method here
 * demands a transaction rather than opening its own: the caller's work
 * (the purchase status flip, the issue lines, the asset rows) has to
 * commit or roll back with the ledger, or a crash leaves stock that moved
 * for a document that does not exist.
 *
 * The arithmetic itself is `stock-ledger.engine.ts` and is not repeated
 * here; this service is the lock, the persistence and the error message.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly ledger: StockLedgerRepository,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Record one movement inside the caller's transaction.
   *
   * Returns the new balance so a caller building a slip can report it
   * without re-reading. Throws `ConflictException` with the engine's
   * message when the movement would drive stock negative — the service
   * says *why* ("only 3 reams on hand"), and
   * `chk_stock_ledger_one_sided` is what holds if a future write path
   * forgets to come through here at all.
   */
  async record(
    tx: PrismaClientLike,
    schoolId: string,
    actorId: string | null,
    request: MovementRequest,
  ): Promise<number> {
    const balance = await this.ledger.lockItemAndReadBalance(
      tx,
      request.itemId,
      schoolId,
    );

    const input: MovementInput = {
      txn: request.txn,
      quantity: request.quantity,
      direction: request.direction,
    };
    const verdict = applyMovement(balance, input);
    if (!verdict.ok) {
      throw new ConflictException(verdict.reason);
    }

    const client = tx as PrismaService;
    await client.stockLedgerEntry.create({
      data: {
        schoolId,
        itemId: request.itemId,
        txn: request.txn,
        qtyIn: new Prisma.Decimal(verdict.movement.qtyIn),
        qtyOut: new Prisma.Decimal(verdict.movement.qtyOut),
        balanceAfter: new Prisma.Decimal(verdict.balanceAfter),
        refType: request.refType ?? null,
        refId: request.refId ?? null,
        unitCost:
          request.unitCost === null || request.unitCost === undefined
            ? null
            : new Prisma.Decimal(request.unitCost),
        remarks: request.remarks ?? null,
        createdBy: actorId,
      },
    });

    return verdict.balanceAfter;
  }

  /**
   * Several movements, in the order given.
   *
   * **Sorted by item id before it starts.** Two clerks issuing the same
   * two items in opposite orders would each hold one item's lock and wait
   * for the other's — a textbook deadlock, and one that only appears
   * under load, on a slip with more than one line. Taking the locks in a
   * consistent order across every caller makes it impossible rather than
   * unlikely.
   */
  async recordMany(
    tx: PrismaClientLike,
    schoolId: string,
    actorId: string | null,
    requests: MovementRequest[],
  ): Promise<Map<string, number>> {
    const balances = new Map<string, number>();
    const ordered = [...requests].sort((a, b) =>
      a.itemId.localeCompare(b.itemId),
    );

    for (const request of ordered) {
      balances.set(
        request.itemId,
        await this.record(tx, schoolId, actorId, request),
      );
    }
    return balances;
  }

  /** Current balances for a set of items — a read, no lock. */
  async balances(
    schoolId: string,
    itemIds?: string[],
  ): Promise<Map<string, number>> {
    return this.ledger.balances(schoolId, itemIds);
  }

  async balanceFor(schoolId: string, itemId: string): Promise<number> {
    return this.ledger.balanceFor(schoolId, itemId);
  }

  /**
   * The item ledger (roadmap §4), oldest first with the stored running
   * balance beside each row. The balance is read, never recomputed — that
   * is the whole point of storing it — but see `verify` below for the
   * second opinion.
   */
  async history(
    schoolId: string,
    itemId: string,
    range?: { from?: Date; to?: Date },
  ) {
    const rows = await this.ledger.history(schoolId, itemId, range);
    return rows.map((row) => ({
      id: row.id,
      txn: row.txn,
      qtyIn: Number(row.qtyIn),
      qtyOut: Number(row.qtyOut),
      balanceAfter: Number(row.balanceAfter),
      refType: row.refType,
      refId: row.refId,
      unitCost: row.unitCost === null ? null : Number(row.unitCost),
      remarks: row.remarks,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    }));
  }

  /** Open a transaction for callers that have no other work to do. */
  async withTransaction<R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
  ): Promise<R> {
    // An explicit budget, not the library's 5-second default — the M20
    // lesson, where a bulk loop inside `$transaction` failed with a Prisma
    // internal message that read like a data problem. A 200-line receipt
    // takes 200 locked round trips.
    return this.prisma.$transaction(fn, { timeout: 120_000, maxWait: 15_000 });
  }

  /** Ref types, re-exported so services do not spell them by hand. */
  static readonly REF = REF_TYPES;

  /** Round to the ledger's precision — callers building movement rows. */
  static qty(value: number): number {
    return qty(value);
  }
}
