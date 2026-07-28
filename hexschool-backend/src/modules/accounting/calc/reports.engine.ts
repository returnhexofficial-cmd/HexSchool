import { money } from '../../fee/calc/money.util';
import { asSidedBalance } from './ledger.engine';
import { naturalSide, signedMovement } from './voucher.engine';

/**
 * The statement arithmetic (roadmap M20 §4), dependency-free and
 * golden-tested against a hand-computed fixture.
 *
 * The three statements are three views of the same numbers, and the
 * property that makes them worth printing is that they agree:
 *
 *   - the **trial balance** proves Σdebit = Σcredit across every account;
 *   - the **income statement** nets income against expense to a surplus;
 *   - the **balance sheet** must then satisfy
 *     `assets = liabilities + equity + surplus`.
 *
 * That last identity is not a coincidence to be asserted hopefully — it
 * follows from the first, *provided* the surplus is carried into equity
 * rather than left out. Forgetting to carry it is the single most common
 * way a hand-rolled balance sheet fails to balance, so `balanceSheet()`
 * takes the surplus as an explicit argument and the caller cannot omit it.
 */

/** Per-account totals for a window, as the database groups them. */
export interface AccountTotals {
  accountId: string;
  code: string;
  name: string;
  group: string;
  type: string;
  /** The account's own `opening_balance`, in its natural direction. */
  openingBalance: number;
  /** Movements strictly BEFORE the window (natural-direction signed). */
  broughtForward: number;
  debit: number;
  credit: number;
}

// ── Trial balance ─────────────────────────────────────────────────────

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  group: string;
  debit: number;
  credit: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  debitTotal: number;
  creditTotal: number;
  /** Rounded difference; 0 on a healthy set of books. */
  difference: number;
  balanced: boolean;
}

/**
 * Closing balances per account, each shown on the side it actually sits
 * on. An account whose closing balance is zero is dropped: a trial
 * balance is a list of what the school holds, and a page of zeroes hides
 * the rows that matter.
 */
export function trialBalance(accounts: AccountTotals[]): TrialBalance {
  const rows: TrialBalanceRow[] = [];
  let debitTotal = 0;
  let creditTotal = 0;

  for (const account of accounts) {
    const closing = money(
      account.openingBalance +
        account.broughtForward +
        signedMovement(account.group, account.debit, account.credit),
    );
    if (closing === 0) continue;

    const sided = asSidedBalance(account.group, closing);
    const row: TrialBalanceRow = {
      accountId: account.accountId,
      code: account.code,
      name: account.name,
      group: account.group,
      debit: sided.side === 'DEBIT' ? sided.amount : 0,
      credit: sided.side === 'CREDIT' ? sided.amount : 0,
    };
    debitTotal = money(debitTotal + row.debit);
    creditTotal = money(creditTotal + row.credit);
    rows.push(row);
  }

  rows.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
  const difference = money(debitTotal - creditTotal);

  return {
    rows,
    debitTotal,
    creditTotal,
    difference,
    balanced: difference === 0,
  };
}

// ── Income statement ──────────────────────────────────────────────────

export interface StatementLine {
  accountId: string;
  code: string;
  name: string;
  amount: number;
}

export interface IncomeStatement {
  income: StatementLine[];
  expense: StatementLine[];
  incomeTotal: number;
  expenseTotal: number;
  /** Positive = surplus, negative = deficit. */
  surplus: number;
}

/**
 * Income and expense for the WINDOW only — brought-forward and opening
 * balances are deliberately excluded, because a P&L answers "what
 * happened between these dates", not "what does the school hold". Mixing
 * them in is how a July income statement starts reporting January's fees.
 */
export function incomeStatement(accounts: AccountTotals[]): IncomeStatement {
  const income: StatementLine[] = [];
  const expense: StatementLine[] = [];
  let incomeTotal = 0;
  let expenseTotal = 0;

  for (const account of accounts) {
    const movement = signedMovement(
      account.group,
      account.debit,
      account.credit,
    );
    if (movement === 0) continue;

    const line: StatementLine = {
      accountId: account.accountId,
      code: account.code,
      name: account.name,
      amount: movement,
    };
    if (account.group === 'INCOME') {
      income.push(line);
      incomeTotal = money(incomeTotal + movement);
    } else if (account.group === 'EXPENSE') {
      expense.push(line);
      expenseTotal = money(expenseTotal + movement);
    }
  }

  const byCode = (a: StatementLine, b: StatementLine): number =>
    a.code.localeCompare(b.code, 'en', { numeric: true });
  income.sort(byCode);
  expense.sort(byCode);

  return {
    income,
    expense,
    incomeTotal,
    expenseTotal,
    surplus: money(incomeTotal - expenseTotal),
  };
}

// ── Balance sheet ─────────────────────────────────────────────────────

export interface BalanceSheet {
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  assetTotal: number;
  liabilityTotal: number;
  equityTotal: number;
  /** The period's surplus, carried into equity. */
  surplus: number;
  /** liabilities + equity + surplus. */
  fundedTotal: number;
  difference: number;
  balanced: boolean;
}

/**
 * Closing position. `surplus` comes from `incomeStatement()` over the
 * same window and is added to equity — see the module doc for why it is
 * a required argument rather than something computed here.
 */
export function balanceSheet(
  accounts: AccountTotals[],
  surplus: number,
): BalanceSheet {
  const assets: StatementLine[] = [];
  const liabilities: StatementLine[] = [];
  const equity: StatementLine[] = [];
  let assetTotal = 0;
  let liabilityTotal = 0;
  let equityTotal = 0;

  for (const account of accounts) {
    const closing = money(
      account.openingBalance +
        account.broughtForward +
        signedMovement(account.group, account.debit, account.credit),
    );
    if (closing === 0) continue;

    const line: StatementLine = {
      accountId: account.accountId,
      code: account.code,
      name: account.name,
      amount: closing,
    };
    if (account.group === 'ASSET') {
      assets.push(line);
      assetTotal = money(assetTotal + closing);
    } else if (account.group === 'LIABILITY') {
      liabilities.push(line);
      liabilityTotal = money(liabilityTotal + closing);
    } else if (account.group === 'EQUITY') {
      equity.push(line);
      equityTotal = money(equityTotal + closing);
    }
  }

  const byCode = (a: StatementLine, b: StatementLine): number =>
    a.code.localeCompare(b.code, 'en', { numeric: true });
  assets.sort(byCode);
  liabilities.sort(byCode);
  equity.sort(byCode);

  const fundedTotal = money(liabilityTotal + equityTotal + money(surplus));
  const difference = money(assetTotal - fundedTotal);

  return {
    assets,
    liabilities,
    equity,
    assetTotal,
    liabilityTotal,
    equityTotal,
    surplus: money(surplus),
    fundedTotal,
    difference,
    balanced: difference === 0,
  };
}

// ── Receipts & payments ───────────────────────────────────────────────

export interface ReceiptsPayments {
  openingCash: number;
  receipts: StatementLine[];
  payments: StatementLine[];
  receiptTotal: number;
  paymentTotal: number;
  closingCash: number;
}

/**
 * The statement a BD school committee actually asks for: what came into
 * the cash and bank accounts, what went out, and what is left.
 *
 * It is cash-based by construction — the caller passes movements against
 * NON-funds accounts paired with funds accounts, so an accrual (a bill
 * raised but unpaid) never appears. `closingCash` is derived from the
 * opening plus the flows rather than read separately, so the statement
 * cannot report a closing figure its own lines do not explain.
 */
export function receiptsPayments(params: {
  openingCash: number;
  /** Amount received into funds, grouped by the counter-account. */
  receipts: StatementLine[];
  /** Amount paid out of funds, grouped by the counter-account. */
  payments: StatementLine[];
}): ReceiptsPayments {
  const receiptTotal = params.receipts.reduce(
    (sum, line) => money(sum + line.amount),
    0,
  );
  const paymentTotal = params.payments.reduce(
    (sum, line) => money(sum + line.amount),
    0,
  );
  return {
    openingCash: money(params.openingCash),
    receipts: params.receipts,
    payments: params.payments,
    receiptTotal,
    paymentTotal,
    closingCash: money(params.openingCash + receiptTotal - paymentTotal),
  };
}

// ── Budget vs actual ──────────────────────────────────────────────────

export interface BudgetVarianceRow {
  accountId: string;
  code: string;
  name: string;
  group: string;
  budget: number;
  actual: number;
  /** actual − budget, in the account's natural direction. */
  variance: number;
  /** Percentage of budget consumed; null when nothing was budgeted. */
  usedPercent: number | null;
  /**
   * Whether the variance is good news. Over-earning income is favourable;
   * over-spending an expense is not — the same signed number means
   * opposite things depending on the group, which is precisely the sort
   * of judgement a report must make rather than leave to the reader.
   */
  favourable: boolean;
}

export interface BudgetVariance {
  rows: BudgetVarianceRow[];
  budgetTotal: number;
  actualTotal: number;
  variance: number;
}

export function budgetVariance(
  rows: Array<{
    accountId: string;
    code: string;
    name: string;
    group: string;
    budget: number;
    actual: number;
  }>,
): BudgetVariance {
  let budgetTotal = 0;
  let actualTotal = 0;

  const out: BudgetVarianceRow[] = rows.map((row) => {
    const budget = money(row.budget);
    const actual = money(row.actual);
    const variance = money(actual - budget);
    budgetTotal = money(budgetTotal + budget);
    actualTotal = money(actualTotal + actual);
    return {
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      group: row.group,
      budget,
      actual,
      variance,
      usedPercent: budget === 0 ? null : money((actual / budget) * 100),
      favourable:
        naturalSide(row.group) === 'CREDIT' ? variance >= 0 : variance <= 0,
    };
  });

  out.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));

  return {
    rows: out,
    budgetTotal,
    actualTotal,
    variance: money(actualTotal - budgetTotal),
  };
}
