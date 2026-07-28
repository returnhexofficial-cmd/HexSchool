import { balanceError } from './voucher.engine';
import {
  BilledPortion,
  allocateAcrossHeads,
  buildOpeningEntries,
  buildPaymentEntries,
  buildSettlementEntries,
} from './posting.engine';

const portion = (
  feeHeadId: string | null,
  label: string,
  amount: number,
): BilledPortion => ({ feeHeadId, label, amount });

describe('posting.engine — allocation across fee heads', () => {
  it('splits in proportion to the billed amounts', () => {
    const shares = allocateAcrossHeads(3000, [
      portion('tuition', 'Tuition', 2000),
      portion('transport', 'Transport', 1000),
    ]);
    expect(shares.map((s) => s.share)).toEqual([2000, 1000]);
  });

  it('sums to the payment EXACTLY where a rounded pro-rata would not', () => {
    // Three equal thirds of 100 are 33.333…; rounding each gives 33.33 and
    // a total of 99.99, which cannot post. Largest-remainder hands the
    // stray paisa out instead.
    const shares = allocateAcrossHeads(100, [
      portion('a', 'A', 10),
      portion('b', 'B', 10),
      portion('c', 'C', 10),
    ]);
    expect(shares.map((s) => s.share)).toEqual([33.34, 33.33, 33.33]);
    expect(shares.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(100, 10);
  });

  it('gives the leftover paisa to the largest remainder, not the first line', () => {
    // 1000.00 split 1 : 1 : 7 → 111.111…, 111.111…, 777.777…
    // Floors: 111.11, 111.11, 777.77 = 999.99; the odd paisa belongs to
    // the .777 line.
    const shares = allocateAcrossHeads(1000, [
      portion('a', 'A', 1),
      portion('b', 'B', 1),
      portion('c', 'C', 7),
    ]);
    expect(shares.map((s) => s.share)).toEqual([111.11, 111.11, 777.78]);
  });

  it('breaks ties on the earlier line so a re-run reproduces the voucher', () => {
    const first = allocateAcrossHeads(10, [
      portion('a', 'A', 1),
      portion('b', 'B', 1),
      portion('c', 'C', 1),
    ]);
    const second = allocateAcrossHeads(10, [
      portion('a', 'A', 1),
      portion('b', 'B', 1),
      portion('c', 'C', 1),
    ]);
    expect(first).toEqual(second);
    expect(first.map((s) => s.share)).toEqual([3.34, 3.33, 3.33]);
  });

  it('handles a partial payment against a multi-head invoice', () => {
    const shares = allocateAcrossHeads(500, [
      portion('tuition', 'Tuition', 2000),
      portion('transport', 'Transport', 1000),
      portion(null, 'Late fine', 100),
    ]);
    expect(shares.map((s) => s.share)).toEqual([322.58, 161.29, 16.13]);
    expect(shares.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(500, 10);
  });

  it('puts everything on the first portion when the invoice nets to zero', () => {
    // A fully-waived invoice taking an adjustment: refusing to allocate
    // would strand real money outside the ledger.
    const shares = allocateAcrossHeads(250, [
      portion('tuition', 'Tuition', 0),
      portion('transport', 'Transport', 0),
    ]);
    expect(shares.map((s) => s.share)).toEqual([250, 0]);
  });

  it('allocates nothing when there is nothing to allocate', () => {
    expect(allocateAcrossHeads(0, [portion('a', 'A', 10)])).toEqual([]);
    expect(allocateAcrossHeads(100, [])).toEqual([]);
  });
});

describe('posting.engine — payment voucher', () => {
  const HEADS = new Map([
    ['tuition', 'acc-tuition-income'],
    ['transport', 'acc-transport-income'],
  ]);

  const build = (amount: number, portions: BilledPortion[]) =>
    buildPaymentEntries({
      amount,
      fundsAccountId: 'acc-cash',
      portions,
      headAccounts: HEADS,
      defaultIncomeAccountId: 'acc-other-income',
      fineIncomeAccountId: 'acc-fine-income',
    });

  it('debits the funds account and credits income per head', () => {
    const entries = build(3000, [
      portion('tuition', 'Tuition', 2000),
      portion('transport', 'Transport', 1000),
    ]);
    expect(entries).toEqual([
      { accountId: 'acc-cash', debit: 3000, credit: 0 },
      {
        accountId: 'acc-tuition-income',
        debit: 0,
        credit: 2000,
        narration: 'Tuition',
      },
      {
        accountId: 'acc-transport-income',
        debit: 0,
        credit: 1000,
        narration: 'Transport',
      },
    ]);
    expect(balanceError(entries)).toBeNull();
  });

  it('always balances, whatever the split', () => {
    const entries = build(1000, [
      portion('tuition', 'Tuition', 1),
      portion('transport', 'Transport', 1),
      portion(null, 'Late fine', 7),
    ]);
    expect(balanceError(entries)).toBeNull();
  });

  it('sends the fine portion to the fine income account', () => {
    const entries = build(1100, [
      portion('tuition', 'Tuition', 1000),
      portion(null, 'Late fine', 100),
    ]);
    expect(entries.find((e) => e.accountId === 'acc-fine-income')).toEqual({
      accountId: 'acc-fine-income',
      debit: 0,
      credit: 100,
      narration: 'Late fine',
    });
  });

  it('falls back to the default income account for an unmapped head', () => {
    const entries = build(500, [portion('library', 'Library', 500)]);
    expect(entries[1].accountId).toBe('acc-other-income');
  });

  it('merges heads that share one income account into a single line', () => {
    const shared = new Map([
      ['tuition', 'acc-tuition-income'],
      ['exam', 'acc-tuition-income'],
    ]);
    const entries = buildPaymentEntries({
      amount: 1500,
      fundsAccountId: 'acc-cash',
      portions: [
        portion('tuition', 'Tuition', 1000),
        portion('exam', 'Exam fee', 500),
      ],
      headAccounts: shared,
      defaultIncomeAccountId: 'acc-other-income',
      fineIncomeAccountId: 'acc-fine-income',
    });
    expect(entries).toHaveLength(2);
    expect(entries[1]).toEqual({
      accountId: 'acc-tuition-income',
      debit: 0,
      credit: 1500,
      narration: 'Tuition, Exam fee',
    });
  });

  it('still balances when the invoice has no billable portions at all', () => {
    const entries = build(250, []);
    expect(entries).toEqual([
      { accountId: 'acc-cash', debit: 250, credit: 0 },
      {
        accountId: 'acc-other-income',
        debit: 0,
        credit: 250,
        narration: 'Fee receipt',
      },
    ]);
    expect(balanceError(entries)).toBeNull();
  });
});

describe('posting.engine — gateway settlement (§8)', () => {
  it('recognises the commission as an expense and clears the gross', () => {
    const entries = buildSettlementEntries({
      clearingAccountId: 'acc-bkash-clearing',
      bankAccountId: 'acc-bank',
      chargeAccountId: 'acc-gateway-charges',
      gross: 10_000,
      charges: 185,
    });
    expect(entries).toEqual([
      {
        accountId: 'acc-bank',
        debit: 9_815,
        credit: 0,
        narration: 'Gateway settlement (net)',
      },
      {
        accountId: 'acc-gateway-charges',
        debit: 185,
        credit: 0,
        narration: 'Gateway commission',
      },
      {
        accountId: 'acc-bkash-clearing',
        debit: 0,
        credit: 10_000,
        narration: 'Clearing account settled',
      },
    ]);
    expect(balanceError(entries)).toBeNull();
  });

  it('omits the charge line when the gateway took nothing', () => {
    const entries = buildSettlementEntries({
      clearingAccountId: 'acc-clearing',
      bankAccountId: 'acc-bank',
      chargeAccountId: 'acc-charges',
      gross: 5_000,
      charges: 0,
    });
    expect(entries).toHaveLength(2);
    expect(balanceError(entries)).toBeNull();
  });
});

describe('posting.engine — opening-balance journal (§8)', () => {
  it('balances an incomplete opening set through the equity account', () => {
    const entries = buildOpeningEntries({
      lines: [
        { accountId: 'acc-cash', debit: 50_000, credit: 0 },
        { accountId: 'acc-bank', debit: 200_000, credit: 0 },
      ],
      equityAccountId: 'acc-capital',
    });
    expect(entries.at(-1)).toEqual({
      accountId: 'acc-capital',
      debit: 0,
      credit: 250_000,
      narration: 'Accumulated fund brought forward',
    });
    expect(balanceError(entries)).toBeNull();
  });

  it('balances the other way when liabilities dominate', () => {
    const entries = buildOpeningEntries({
      lines: [
        { accountId: 'acc-cash', debit: 10_000, credit: 0 },
        { accountId: 'acc-loan', debit: 0, credit: 40_000 },
      ],
      equityAccountId: 'acc-capital',
    });
    expect(entries.at(-1)).toMatchObject({
      accountId: 'acc-capital',
      debit: 30_000,
      credit: 0,
    });
    expect(balanceError(entries)).toBeNull();
  });

  it('adds no equity line when the set already balances', () => {
    const entries = buildOpeningEntries({
      lines: [
        { accountId: 'acc-cash', debit: 10_000, credit: 0 },
        { accountId: 'acc-capital', debit: 0, credit: 10_000 },
      ],
      equityAccountId: 'acc-capital',
    });
    expect(entries).toHaveLength(2);
  });

  it('drops zero lines the wizard left blank', () => {
    const entries = buildOpeningEntries({
      lines: [
        { accountId: 'acc-cash', debit: 5_000, credit: 0 },
        { accountId: 'acc-bank', debit: 0, credit: 0 },
      ],
      equityAccountId: 'acc-capital',
    });
    expect(entries.map((e) => e.accountId)).toEqual([
      'acc-cash',
      'acc-capital',
    ]);
  });
});
