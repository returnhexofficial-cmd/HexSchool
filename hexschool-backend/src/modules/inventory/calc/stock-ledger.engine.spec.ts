import {
  applyMovement,
  findBalanceBreak,
  isAdjustment,
  REF_TYPES,
  replayBalance,
  reversalMovements,
} from './stock-ledger.engine';

const ok = (verdict: ReturnType<typeof applyMovement>) => {
  if (!verdict.ok) throw new Error(`expected ok, got: ${verdict.reason}`);
  return verdict;
};

describe('stock-ledger.engine', () => {
  describe('applyMovement — direction comes from the transaction type', () => {
    it('a purchase adds', () => {
      const result = ok(applyMovement(10, { txn: 'PURCHASE', quantity: 5 }));
      expect(result.movement).toEqual({
        txn: 'PURCHASE',
        qtyIn: 5,
        qtyOut: 0,
      });
      expect(result.balanceAfter).toBe(15);
    });

    it('a return adds — stock coming back is stock', () => {
      const result = ok(applyMovement(3, { txn: 'RETURN', quantity: 2 }));
      expect(result.movement.qtyIn).toBe(2);
      expect(result.balanceAfter).toBe(5);
    });

    it('an issue subtracts', () => {
      const result = ok(applyMovement(10, { txn: 'ISSUE', quantity: 4 }));
      expect(result.movement).toEqual({
        txn: 'ISSUE',
        qtyIn: 0,
        qtyOut: 4,
      });
      expect(result.balanceAfter).toBe(6);
    });

    it('a disposal subtracts', () => {
      const result = ok(applyMovement(10, { txn: 'DISPOSE', quantity: 10 }));
      expect(result.movement.qtyOut).toBe(10);
      expect(result.balanceAfter).toBe(0);
    });

    it('is always one-sided — never both columns, never a signed quantity', () => {
      const inbound = ok(
        applyMovement(0, { txn: 'PURCHASE', quantity: 7 }),
      ).movement;
      const outbound = ok(
        applyMovement(7, { txn: 'ISSUE', quantity: 7 }),
      ).movement;
      expect(inbound.qtyIn > 0 && inbound.qtyOut === 0).toBe(true);
      expect(outbound.qtyOut > 0 && outbound.qtyIn === 0).toBe(true);
    });
  });

  describe('applyMovement — the non-negative invariant', () => {
    it('refuses an issue larger than the balance, and says how much there is', () => {
      const verdict = applyMovement(3, {
        txn: 'ISSUE',
        quantity: 5,
      });
      expect(verdict.ok).toBe(false);
      expect(verdict.ok === false && verdict.reason).toBe(
        'Only 3 in stock — 5 cannot go out.',
      );
    });

    it('allows an issue that empties the shelf exactly', () => {
      expect(
        ok(applyMovement(5, { txn: 'ISSUE', quantity: 5 })).balanceAfter,
      ).toBe(0);
    });

    it('refuses a downward adjustment past zero', () => {
      // The stock-take wizard's most dangerous input: a count sheet that
      // says 0 for an item the ledger already reads 0 on.
      const verdict = applyMovement(2, {
        txn: 'ADJUST',
        quantity: 5,
        direction: 'OUT',
      });
      expect(verdict.ok).toBe(false);
    });

    it('refuses zero and negative quantities', () => {
      expect(applyMovement(10, { txn: 'ISSUE', quantity: 0 }).ok).toBe(false);
      expect(applyMovement(10, { txn: 'ISSUE', quantity: -3 }).ok).toBe(false);
    });
  });

  describe('applyMovement — adjustments carry their own direction', () => {
    it('is the only type that can go either way', () => {
      expect(isAdjustment('ADJUST')).toBe(true);
      expect(isAdjustment('PURCHASE')).toBe(false);
    });

    it('adds when the count found more than the ledger expected', () => {
      const result = ok(
        applyMovement(8, {
          txn: 'ADJUST',
          quantity: 4,
          direction: 'IN',
        }),
      );
      expect(result.balanceAfter).toBe(12);
    });

    it('subtracts when the shelf is short', () => {
      const result = ok(
        applyMovement(12, {
          txn: 'ADJUST',
          quantity: 4,
          direction: 'OUT',
        }),
      );
      expect(result.balanceAfter).toBe(8);
    });

    it('refuses an adjustment with no direction rather than guessing one', () => {
      const verdict = applyMovement(12, {
        txn: 'ADJUST',
        quantity: 4,
      });
      expect(verdict.ok).toBe(false);
      expect(verdict.ok === false && verdict.reason).toMatch(/up or down/);
    });

    it('ignores a direction on a type that already has one', () => {
      // A caller passing direction: 'IN' with an ISSUE must not be able to
      // turn a hand-out into a receipt.
      const result = ok(
        applyMovement(10, {
          txn: 'ISSUE',
          quantity: 2,
          direction: 'IN',
        }),
      );
      expect(result.movement.qtyOut).toBe(2);
      expect(result.balanceAfter).toBe(8);
    });
  });

  describe('applyMovement — precision', () => {
    it('keeps three decimals through a chain of litres', () => {
      let balance = 0;
      balance = ok(
        applyMovement(balance, { txn: 'PURCHASE', quantity: 2.5 }),
      ).balanceAfter;
      balance = ok(
        applyMovement(balance, { txn: 'ISSUE', quantity: 0.125 }),
      ).balanceAfter;
      balance = ok(
        applyMovement(balance, { txn: 'ISSUE', quantity: 0.375 }),
      ).balanceAfter;
      expect(balance).toBe(2);
    });
  });

  describe('replayBalance and findBalanceBreak', () => {
    it('replays a history to the same number the running column holds', () => {
      const rows = [
        { qtyIn: 10, qtyOut: 0 },
        { qtyIn: 0, qtyOut: 4 },
        { qtyIn: 2, qtyOut: 0 },
        { qtyIn: 0, qtyOut: 8 },
      ];
      expect(replayBalance(rows)).toBe(0);
    });

    it('replays an empty history to zero', () => {
      expect(replayBalance([])).toBe(0);
    });

    it('finds nothing wrong with a consistent ledger', () => {
      expect(
        findBalanceBreak([
          { qtyIn: 10, qtyOut: 0, balanceAfter: 10 },
          { qtyIn: 0, qtyOut: 4, balanceAfter: 6 },
          { qtyIn: 5, qtyOut: 0, balanceAfter: 11 },
        ]),
      ).toBeNull();
    });

    it('names the first row where the stored balance stopped agreeing', () => {
      // The signature of a writer that skipped the row lock: two issues
      // computed against the same starting balance.
      expect(
        findBalanceBreak([
          { qtyIn: 10, qtyOut: 0, balanceAfter: 10 },
          { qtyIn: 0, qtyOut: 4, balanceAfter: 6 },
          { qtyIn: 0, qtyOut: 3, balanceAfter: 6 },
        ]),
      ).toBe(2);
    });
  });

  describe('reversalMovements — roadmap §6, cancel = reversal entries', () => {
    it('turns received lines into outbound adjustments', () => {
      expect(
        reversalMovements([
          { itemId: 'i1', baseQty: 48 },
          { itemId: 'i2', baseQty: 3 },
        ]),
      ).toEqual([
        {
          itemId: 'i1',
          input: { txn: 'ADJUST', quantity: 48, direction: 'OUT' },
        },
        {
          itemId: 'i2',
          input: { txn: 'ADJUST', quantity: 3, direction: 'OUT' },
        },
      ]);
    });

    it('drops zero-quantity lines rather than writing empty ledger rows', () => {
      expect(reversalMovements([{ itemId: 'i1', baseQty: 0 }])).toEqual([]);
    });

    it('produces movements that still face the non-negative rule', () => {
      // A school that has already issued the paper it is now un-receiving
      // genuinely cannot un-receive it, and finding that out is the point.
      const [reversal] = reversalMovements([{ itemId: 'i1', baseQty: 48 }]);
      expect(applyMovement(10, reversal.input).ok).toBe(false);
    });
  });

  it('exposes the ref types the register drills through', () => {
    expect(REF_TYPES.PURCHASE).toBe('PURCHASE');
    expect(REF_TYPES.ISSUE).toBe('ISSUE');
    expect(REF_TYPES.RETURN).toBe('RETURN');
    expect(REF_TYPES.ADJUSTMENT).toBe('ADJUSTMENT');
    expect(REF_TYPES.ASSET).toBe('ASSET');
  });
});
