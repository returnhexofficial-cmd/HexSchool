import {
  LedgerMovement,
  asSidedBalance,
  buildBook,
  buildLedger,
} from './ledger.engine';

const move = (
  date: string,
  voucherNo: string,
  debit: number,
  credit: number,
  narration = 'Entry',
): LedgerMovement => ({
  date,
  voucherId: `v-${voucherNo}`,
  voucherNo,
  voucherType: 'JOURNAL',
  narration,
  debit,
  credit,
});

describe('ledger.engine — sided balances', () => {
  it('reports a positive natural balance on its natural side', () => {
    expect(asSidedBalance('ASSET', 5000)).toEqual({
      amount: 5000,
      side: 'DEBIT',
    });
    expect(asSidedBalance('INCOME', 5000)).toEqual({
      amount: 5000,
      side: 'CREDIT',
    });
  });

  it('flips the side rather than reporting a negative', () => {
    // An overdrawn bank account is a CREDIT balance of 200, not a debit
    // balance of −200 — the sign is a side, and printing it as a negative
    // is how a ledger ends up showing a negative liability.
    expect(asSidedBalance('ASSET', -200)).toEqual({
      amount: 200,
      side: 'CREDIT',
    });
    expect(asSidedBalance('INCOME', -200)).toEqual({
      amount: 200,
      side: 'DEBIT',
    });
  });

  it('treats zero as sitting on the natural side', () => {
    expect(asSidedBalance('ASSET', 0)).toEqual({ amount: 0, side: 'DEBIT' });
  });
});

describe('ledger.engine — general ledger', () => {
  it('runs a debit-normal balance forward through the window', () => {
    const result = buildLedger({
      group: 'ASSET',
      opening: 1000,
      movements: [
        move('2026-07-01', 'CV-1', 500, 0),
        move('2026-07-05', 'DV-1', 0, 200),
        move('2026-07-09', 'CV-2', 250, 0),
      ],
    });

    expect(result.openingBalance).toBe(1000);
    expect(result.openingSide).toBe('DEBIT');
    expect(result.rows.map((r) => r.balance)).toEqual([1500, 1300, 1550]);
    expect(result.rows.every((r) => r.balanceSide === 'DEBIT')).toBe(true);
    expect(result.debitTotal).toBe(750);
    expect(result.creditTotal).toBe(200);
    expect(result.closingBalance).toBe(1550);
    expect(result.closingSide).toBe('DEBIT');
  });

  it('runs a credit-normal balance the other way', () => {
    const result = buildLedger({
      group: 'INCOME',
      opening: 0,
      movements: [
        move('2026-07-01', 'CV-1', 0, 3000),
        move('2026-07-02', 'JV-1', 500, 0, 'Refund'),
      ],
    });
    expect(result.rows.map((r) => r.balance)).toEqual([3000, 2500]);
    expect(result.closingSide).toBe('CREDIT');
  });

  it('flips the running side mid-ledger when an account is overdrawn', () => {
    const result = buildLedger({
      group: 'ASSET',
      opening: 100,
      movements: [move('2026-07-01', 'DV-1', 0, 400)],
    });
    expect(result.rows[0]).toMatchObject({
      balance: 300,
      balanceSide: 'CREDIT',
    });
    expect(result.closingSide).toBe('CREDIT');
  });

  it('rounds to paisa at every step, not only at the end', () => {
    const result = buildLedger({
      group: 'ASSET',
      opening: 0,
      movements: [
        move('2026-07-01', 'CV-1', 0.005, 0),
        move('2026-07-02', 'CV-2', 0.005, 0),
      ],
    });
    // Each 0.005 rounds to 0.01 as it lands, so the ledger reads 0.02 —
    // the figure a cashier writes, and the one the DECIMAL(12,2) column
    // can actually store.
    expect(result.rows.map((r) => r.balance)).toEqual([0.01, 0.02]);
  });

  it('reports the opening balance alone when nothing moved', () => {
    const result = buildLedger({ group: 'ASSET', opening: 750, movements: [] });
    expect(result.rows).toEqual([]);
    expect(result.closingBalance).toBe(750);
    expect(result.debitTotal).toBe(0);
  });
});

describe('ledger.engine — cash / bank book', () => {
  it('reads debits as receipts and credits as payments', () => {
    const result = buildBook({
      opening: 2000,
      movements: [
        {
          ...move('2026-07-01', 'CV-1', 1500, 0, 'Tuition'),
          contra: ['Tuition Income'],
        },
        {
          ...move('2026-07-02', 'DV-1', 0, 900, 'Electricity'),
          contra: ['Utilities'],
        },
      ],
    });

    expect(result.openingBalance).toBe(2000);
    expect(result.rows[0]).toMatchObject({
      receipt: 1500,
      payment: 0,
      balance: 3500,
      particulars: 'Tuition Income',
    });
    expect(result.rows[1]).toMatchObject({
      receipt: 0,
      payment: 900,
      balance: 2600,
    });
    expect(result.receiptTotal).toBe(1500);
    expect(result.paymentTotal).toBe(900);
    expect(result.closingBalance).toBe(2600);
  });

  it('closing = opening + receipts − payments, always', () => {
    const result = buildBook({
      opening: 100,
      movements: [
        move('2026-07-01', 'CV-1', 50, 0),
        move('2026-07-02', 'DV-1', 0, 30),
        move('2026-07-03', 'CV-2', 20, 0),
      ],
    });
    expect(result.closingBalance).toBe(
      result.openingBalance + result.receiptTotal - result.paymentTotal,
    );
  });

  it('joins several counter-accounts into one particulars column', () => {
    const result = buildBook({
      opening: 0,
      movements: [
        {
          ...move('2026-07-01', 'CV-1', 300, 0),
          contra: ['Tuition Income', 'Transport Income'],
        },
      ],
    });
    expect(result.rows[0].particulars).toBe('Tuition Income, Transport Income');
  });
});
