import { ConflictException } from '@nestjs/common';
import { StockTxnType } from '@prisma/client';
import { StockService } from './stock.service';

/**
 * The one write path into stock.
 *
 * The arithmetic is `stock-ledger.engine.ts` and is golden-tested there;
 * what this spec pins is the part that only exists in the service — that
 * the balance is read **under the lock**, that the row it writes is the
 * one the engine decided, and that the deadlock ordering rule holds for a
 * multi-line slip.
 */
describe('StockService', () => {
  const SCHOOL = 'school-1';
  const ACTOR = 'user-1';

  let ledger: {
    lockItemAndReadBalance: jest.Mock;
    balances: jest.Mock;
    balanceFor: jest.Mock;
    history: jest.Mock;
  };
  let created: Array<Record<string, unknown>>;
  let tx: { stockLedgerEntry: { create: jest.Mock } };
  let service: StockService;

  beforeEach(() => {
    created = [];
    tx = {
      stockLedgerEntry: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve(data);
        }),
      },
    };
    ledger = {
      lockItemAndReadBalance: jest.fn().mockResolvedValue(0),
      balances: jest.fn().mockResolvedValue(new Map()),
      balanceFor: jest.fn().mockResolvedValue(0),
      history: jest.fn().mockResolvedValue([]),
    };
    service = new StockService(ledger as never, {} as never);
  });

  const record = (request: Parameters<StockService['record']>[3]) =>
    service.record(tx as never, SCHOOL, ACTOR, request);

  describe('record', () => {
    it('reads the balance under the lock before writing', async () => {
      ledger.lockItemAndReadBalance.mockResolvedValue(10);

      await record({
        itemId: 'item-1',
        txn: StockTxnType.PURCHASE,
        quantity: 5,
      });

      expect(ledger.lockItemAndReadBalance).toHaveBeenCalledWith(
        tx,
        'item-1',
        SCHOOL,
      );
      // The lock has to be taken BEFORE the insert, or it buys nothing.
      expect(
        ledger.lockItemAndReadBalance.mock.invocationCallOrder[0],
      ).toBeLessThan(tx.stockLedgerEntry.create.mock.invocationCallOrder[0]);
    });

    it('writes the one-sided row the engine decided, with the new balance', async () => {
      ledger.lockItemAndReadBalance.mockResolvedValue(10);

      const balance = await record({
        itemId: 'item-1',
        txn: StockTxnType.ISSUE,
        quantity: 4,
        refType: 'ISSUE',
        refId: 'issue-1',
        remarks: 'ISS-26-00001',
      });

      expect(balance).toBe(6);
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        schoolId: SCHOOL,
        itemId: 'item-1',
        txn: StockTxnType.ISSUE,
        refType: 'ISSUE',
        refId: 'issue-1',
        remarks: 'ISS-26-00001',
        createdBy: ACTOR,
      });
      expect(Number(created[0].qtyIn)).toBe(0);
      expect(Number(created[0].qtyOut)).toBe(4);
      expect(Number(created[0].balanceAfter)).toBe(6);
    });

    it('starts a brand-new item from zero rather than from nothing', async () => {
      ledger.lockItemAndReadBalance.mockResolvedValue(0);
      const balance = await record({
        itemId: 'item-1',
        txn: StockTxnType.PURCHASE,
        quantity: 12,
      });
      expect(balance).toBe(12);
    });

    it('refuses an issue past the balance with the engine’s message, and writes nothing', async () => {
      ledger.lockItemAndReadBalance.mockResolvedValue(3);

      await expect(
        record({ itemId: 'item-1', txn: StockTxnType.ISSUE, quantity: 5 }),
      ).rejects.toBeInstanceOf(ConflictException);
      // Nothing is written when the verdict refuses — the transaction the
      // caller opened is what rolls the rest back, but this must not have
      // put a row in it first.
      expect(created).toHaveLength(0);
    });

    it('passes a null unit cost through rather than storing a zero', async () => {
      // An issue consumes stock at no NEW cost, and a zero would read as
      // "this was free" in the consumption report's value column.
      await record({
        itemId: 'item-1',
        txn: StockTxnType.PURCHASE,
        quantity: 1,
        unitCost: null,
      });
      expect(created[0].unitCost).toBeNull();
    });

    it('stores a unit cost when one is given', async () => {
      await record({
        itemId: 'item-1',
        txn: StockTxnType.PURCHASE,
        quantity: 1,
        unitCost: 20.5,
      });
      expect(Number(created[0].unitCost)).toBe(20.5);
    });

    it('carries an adjustment’s direction into the row', async () => {
      ledger.lockItemAndReadBalance.mockResolvedValue(12);
      const balance = await record({
        itemId: 'item-1',
        txn: StockTxnType.ADJUST,
        quantity: 4,
        direction: 'OUT',
        remarks: 'Counted 8',
      });
      expect(balance).toBe(8);
      expect(Number(created[0].qtyOut)).toBe(4);
    });
  });

  describe('recordMany', () => {
    it('**takes the item locks in a consistent order**, whatever order the slip lists them in', async () => {
      // Two clerks issuing the same two items in opposite orders would
      // otherwise each hold one lock and wait for the other — a deadlock
      // that only appears under load, on a slip with more than one line.
      ledger.lockItemAndReadBalance.mockResolvedValue(100);

      await service.recordMany(tx as never, SCHOOL, ACTOR, [
        { itemId: 'item-c', txn: StockTxnType.ISSUE, quantity: 1 },
        { itemId: 'item-a', txn: StockTxnType.ISSUE, quantity: 1 },
        { itemId: 'item-b', txn: StockTxnType.ISSUE, quantity: 1 },
      ]);

      const lockedItems = (
        ledger.lockItemAndReadBalance.mock.calls as Array<[unknown, string]>
      ).map((call) => call[1]);
      expect(lockedItems).toEqual(['item-a', 'item-b', 'item-c']);
    });

    it('returns the new balance per item', async () => {
      ledger.lockItemAndReadBalance
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(50);

      const balances = await service.recordMany(tx as never, SCHOOL, ACTOR, [
        { itemId: 'item-a', txn: StockTxnType.ISSUE, quantity: 4 },
        { itemId: 'item-b', txn: StockTxnType.ISSUE, quantity: 5 },
      ]);

      expect(balances.get('item-a')).toBe(6);
      expect(balances.get('item-b')).toBe(45);
    });

    it('stops at the first refusal, so a bad line cannot be half-applied', async () => {
      ledger.lockItemAndReadBalance
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(1);

      await expect(
        service.recordMany(tx as never, SCHOOL, ACTOR, [
          { itemId: 'item-a', txn: StockTxnType.ISSUE, quantity: 4 },
          { itemId: 'item-b', txn: StockTxnType.ISSUE, quantity: 5 },
        ]),
      ).rejects.toBeInstanceOf(ConflictException);

      // The first row IS written — the caller's transaction is what
      // discards it, which is why every write path here demands one.
      expect(created).toHaveLength(1);
    });

    it('does nothing for an empty list', async () => {
      const balances = await service.recordMany(tx as never, SCHOOL, ACTOR, []);
      expect(balances.size).toBe(0);
      expect(created).toHaveLength(0);
    });
  });

  describe('history', () => {
    it('converts the Decimal columns to numbers the engines can use', async () => {
      ledger.history.mockResolvedValue([
        {
          id: 'l1',
          txn: StockTxnType.PURCHASE,
          qtyIn: '10',
          qtyOut: '0',
          balanceAfter: '10',
          refType: 'PURCHASE',
          refId: 'p1',
          unitCost: '20.5000',
          remarks: null,
          createdAt: new Date('2026-03-01'),
          createdBy: ACTOR,
        },
      ]);

      const rows = await service.history(SCHOOL, 'item-1');
      expect(rows[0]).toMatchObject({
        qtyIn: 10,
        qtyOut: 0,
        balanceAfter: 10,
        unitCost: 20.5,
      });
    });

    it('keeps a null unit cost null rather than turning it into 0', async () => {
      ledger.history.mockResolvedValue([
        {
          id: 'l1',
          txn: StockTxnType.ISSUE,
          qtyIn: '0',
          qtyOut: '4',
          balanceAfter: '6',
          refType: 'ISSUE',
          refId: 'i1',
          unitCost: null,
          remarks: null,
          createdAt: new Date(),
          createdBy: null,
        },
      ]);
      expect((await service.history(SCHOOL, 'item-1'))[0].unitCost).toBeNull();
    });
  });
});
