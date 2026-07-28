import {
  AccountTotals,
  balanceSheet,
  budgetVariance,
  incomeStatement,
  receiptsPayments,
  trialBalance,
} from './reports.engine';

/**
 * One hand-computed month for a small school (roadmap M20 §9: "report
 * math (fixtures with known trial balance)"). Every expected number below
 * was worked out on paper first, and the three statements are asserted to
 * agree with each other — which is the property that makes them worth
 * printing at all.
 *
 * Opening position (1 July): cash 50,000 + bank 200,000 = capital 250,000.
 *
 * July:
 *   1. Fees collected in cash        Dr Cash 120,000 / Cr Tuition 120,000
 *   2. Cash banked                   Dr Bank 100,000 / Cr Cash   100,000
 *   3. Salary accrued                Dr Salary  80,000 / Cr Payable 80,000
 *   4. Salary paid from bank         Dr Payable 80,000 / Cr Bank   80,000
 *   5. Electricity paid in cash      Dr Utilities 15,000 / Cr Cash 15,000
 */
const account = (
  overrides: Partial<AccountTotals> & { accountId: string; code: string },
): AccountTotals => ({
  name: overrides.accountId,
  group: 'ASSET',
  type: 'OTHER',
  openingBalance: 0,
  broughtForward: 0,
  debit: 0,
  credit: 0,
  ...overrides,
});

const JULY: AccountTotals[] = [
  account({
    accountId: 'cash',
    code: '1110',
    name: 'Cash in Hand',
    group: 'ASSET',
    type: 'CASH',
    openingBalance: 50_000,
    debit: 120_000,
    credit: 115_000,
  }),
  account({
    accountId: 'bank',
    code: '1210',
    name: 'Bank',
    group: 'ASSET',
    type: 'BANK',
    openingBalance: 200_000,
    debit: 100_000,
    credit: 80_000,
  }),
  account({
    accountId: 'payable',
    code: '2110',
    name: 'Salary Payable',
    group: 'LIABILITY',
    type: 'PAYABLE',
    debit: 80_000,
    credit: 80_000,
  }),
  account({
    accountId: 'capital',
    code: '3110',
    name: 'Capital Fund',
    group: 'EQUITY',
    type: 'EQUITY',
    openingBalance: 250_000,
  }),
  account({
    accountId: 'tuition',
    code: '4110',
    name: 'Tuition Income',
    group: 'INCOME',
    type: 'INCOME',
    credit: 120_000,
  }),
  account({
    accountId: 'salary',
    code: '5110',
    name: 'Salary Expense',
    group: 'EXPENSE',
    type: 'EXPENSE',
    debit: 80_000,
  }),
  account({
    accountId: 'utilities',
    code: '5210',
    name: 'Utilities',
    group: 'EXPENSE',
    type: 'EXPENSE',
    debit: 15_000,
  }),
];

describe('reports.engine — trial balance', () => {
  const tb = trialBalance(JULY);

  it('reports each closing balance on the side it actually sits on', () => {
    expect(tb.rows).toEqual([
      {
        accountId: 'cash',
        code: '1110',
        name: 'Cash in Hand',
        group: 'ASSET',
        debit: 55_000,
        credit: 0,
      },
      {
        accountId: 'bank',
        code: '1210',
        name: 'Bank',
        group: 'ASSET',
        debit: 220_000,
        credit: 0,
      },
      {
        accountId: 'capital',
        code: '3110',
        name: 'Capital Fund',
        group: 'EQUITY',
        debit: 0,
        credit: 250_000,
      },
      {
        accountId: 'tuition',
        code: '4110',
        name: 'Tuition Income',
        group: 'INCOME',
        debit: 0,
        credit: 120_000,
      },
      {
        accountId: 'salary',
        code: '5110',
        name: 'Salary Expense',
        group: 'EXPENSE',
        debit: 80_000,
        credit: 0,
      },
      {
        accountId: 'utilities',
        code: '5210',
        name: 'Utilities',
        group: 'EXPENSE',
        debit: 0 + 15_000,
        credit: 0,
      },
    ]);
  });

  it('balances at the hand-computed 370,000 on both sides', () => {
    expect(tb.debitTotal).toBe(370_000);
    expect(tb.creditTotal).toBe(370_000);
    expect(tb.difference).toBe(0);
    expect(tb.balanced).toBe(true);
  });

  it('drops an account that nets to zero (salary payable was fully paid)', () => {
    expect(tb.rows.map((r) => r.accountId)).not.toContain('payable');
  });

  it('reports an imbalance rather than hiding it', () => {
    const broken = trialBalance([
      ...JULY,
      account({ accountId: 'stray', code: '1900', group: 'ASSET', debit: 5 }),
    ]);
    expect(broken.balanced).toBe(false);
    expect(broken.difference).toBe(5);
  });

  it('carries brought-forward movements into the closing balance', () => {
    const [row] = trialBalance([
      account({
        accountId: 'cash',
        code: '1110',
        group: 'ASSET',
        openingBalance: 1_000,
        broughtForward: 500,
        debit: 200,
      }),
    ]).rows;
    expect(row.debit).toBe(1_700);
  });
});

describe('reports.engine — income statement', () => {
  const is = incomeStatement(JULY);

  it('nets the window’s income against its expenses', () => {
    expect(is.incomeTotal).toBe(120_000);
    expect(is.expenseTotal).toBe(95_000);
    expect(is.surplus).toBe(25_000);
  });

  it('ignores opening balances — a P&L is about the window, not the position', () => {
    // Capital 250,000 and the cash/bank openings must not leak in; if they
    // did, July's statement would start reporting the school's whole history.
    expect(is.income.map((l) => l.accountId)).toEqual(['tuition']);
    expect(is.expense.map((l) => l.accountId)).toEqual(['salary', 'utilities']);
  });

  it('reports a deficit as a negative surplus', () => {
    const lean = incomeStatement([
      account({
        accountId: 'tuition',
        code: '4110',
        group: 'INCOME',
        credit: 10_000,
      }),
      account({
        accountId: 'salary',
        code: '5110',
        group: 'EXPENSE',
        debit: 18_000,
      }),
    ]);
    expect(lean.surplus).toBe(-8_000);
  });

  it('nets a refund against the income it reverses', () => {
    const withRefund = incomeStatement([
      account({
        accountId: 'tuition',
        code: '4110',
        group: 'INCOME',
        credit: 120_000,
        debit: 2_000,
      }),
    ]);
    expect(withRefund.incomeTotal).toBe(118_000);
  });
});

describe('reports.engine — balance sheet', () => {
  const is = incomeStatement(JULY);
  const bs = balanceSheet(JULY, is.surplus);

  it('balances once the period’s surplus is carried into equity', () => {
    expect(bs.assetTotal).toBe(275_000);
    expect(bs.liabilityTotal).toBe(0);
    expect(bs.equityTotal).toBe(250_000);
    expect(bs.surplus).toBe(25_000);
    expect(bs.fundedTotal).toBe(275_000);
    expect(bs.balanced).toBe(true);
  });

  it('does NOT balance when the surplus is forgotten — the classic bug', () => {
    const forgotten = balanceSheet(JULY, 0);
    expect(forgotten.balanced).toBe(false);
    expect(forgotten.difference).toBe(25_000);
  });

  it('lists a liability that still has a balance', () => {
    const owing = balanceSheet(
      [
        account({
          accountId: 'cash',
          code: '1110',
          group: 'ASSET',
          openingBalance: 90_000,
        }),
        account({
          accountId: 'payable',
          code: '2110',
          group: 'LIABILITY',
          credit: 40_000,
        }),
        account({
          accountId: 'capital',
          code: '3110',
          group: 'EQUITY',
          openingBalance: 50_000,
        }),
      ],
      0,
    );
    expect(owing.liabilities).toEqual([
      { accountId: 'payable', code: '2110', name: 'payable', amount: 40_000 },
    ]);
    expect(owing.balanced).toBe(true);
  });
});

describe('reports.engine — the three statements agree', () => {
  it('trial balance debit total = assets + expenses; credit total = the rest', () => {
    const tb = trialBalance(JULY);
    const is = incomeStatement(JULY);
    const bs = balanceSheet(JULY, is.surplus);

    expect(tb.debitTotal).toBe(bs.assetTotal + is.expenseTotal);
    expect(tb.creditTotal).toBe(
      bs.liabilityTotal + bs.equityTotal + is.incomeTotal,
    );
    // Which is the same identity the balance sheet asserts, arrived at
    // from the other direction.
    expect(tb.balanced && bs.balanced).toBe(true);
  });
});

describe('reports.engine — receipts & payments', () => {
  it('derives the closing cash from the flows it prints', () => {
    const rp = receiptsPayments({
      openingCash: 50_000,
      receipts: [
        {
          accountId: 'tuition',
          code: '4110',
          name: 'Tuition Income',
          amount: 120_000,
        },
      ],
      payments: [
        {
          accountId: 'utilities',
          code: '5210',
          name: 'Utilities',
          amount: 15_000,
        },
        {
          accountId: 'bank',
          code: '1210',
          name: 'Transfer to Bank',
          amount: 100_000,
        },
      ],
    });
    expect(rp.receiptTotal).toBe(120_000);
    expect(rp.paymentTotal).toBe(115_000);
    // Which is exactly the cash book's closing balance in the fixture.
    expect(rp.closingCash).toBe(55_000);
  });

  it('reports an empty period as the opening balance unchanged', () => {
    const rp = receiptsPayments({
      openingCash: 1_234.56,
      receipts: [],
      payments: [],
    });
    expect(rp.closingCash).toBe(1_234.56);
  });
});

describe('reports.engine — budget vs actual', () => {
  const variance = budgetVariance([
    {
      accountId: 'tuition',
      code: '4110',
      name: 'Tuition Income',
      group: 'INCOME',
      budget: 100_000,
      actual: 120_000,
    },
    {
      accountId: 'salary',
      code: '5110',
      name: 'Salary Expense',
      group: 'EXPENSE',
      budget: 90_000,
      actual: 80_000,
    },
    {
      accountId: 'utilities',
      code: '5210',
      name: 'Utilities',
      group: 'EXPENSE',
      budget: 10_000,
      actual: 15_000,
    },
    {
      accountId: 'misc',
      code: '5310',
      name: 'Misc',
      group: 'EXPENSE',
      budget: 0,
      actual: 400,
    },
  ]);

  it('computes the variance and the share of budget consumed', () => {
    expect(
      variance.rows.map((r) => [r.code, r.variance, r.usedPercent]),
    ).toEqual([
      ['4110', 20_000, 120],
      ['5110', -10_000, 88.89],
      ['5210', 5_000, 150],
      ['5310', 400, null],
    ]);
  });

  it('reads the same sign as good news or bad, depending on the group', () => {
    // Over-earning income is favourable; over-spending is not. The signed
    // number alone cannot say which, which is why the report decides.
    const byCode = new Map(variance.rows.map((r) => [r.code, r.favourable]));
    expect(byCode.get('4110')).toBe(true); // income over budget
    expect(byCode.get('5110')).toBe(true); // expense under budget
    expect(byCode.get('5210')).toBe(false); // expense over budget
  });

  it('totals both columns', () => {
    expect(variance.budgetTotal).toBe(200_000);
    expect(variance.actualTotal).toBe(215_400);
    expect(variance.variance).toBe(15_400);
  });
});
