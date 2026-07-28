import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Account, AccountType } from '@prisma/client';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { money } from '../../fee/calc/money.util';
import {
  BookRow,
  LedgerMovement,
  LedgerResult,
  buildBook,
  buildLedger,
} from '../calc/ledger.engine';
import {
  AccountTotals,
  BalanceSheet,
  BudgetVariance,
  IncomeStatement,
  ReceiptsPayments,
  StatementLine,
  TrialBalance,
  balanceSheet,
  budgetVariance,
  incomeStatement,
  receiptsPayments,
  trialBalance,
} from '../calc/reports.engine';
import { signedMovement } from '../calc/voucher.engine';
import { AccountingReportQueryDto } from '../dto';
import { AccountingConfigRepository } from '../repositories/accounting-config.repository';
import { AccountsRepository } from '../repositories/accounts.repository';
import {
  EntryRow,
  VouchersRepository,
} from '../repositories/vouchers.repository';

export interface ReportWindow {
  from: string;
  to: string;
}

export interface LedgerReport extends LedgerResult, ReportWindow {
  account: { id: string; code: string; name: string; group: string };
}

export interface BookReport extends ReportWindow {
  account: { id: string; code: string; name: string };
  openingBalance: number;
  rows: BookRow[];
  receiptTotal: number;
  paymentTotal: number;
  closingBalance: number;
}

/**
 * The eight reports (roadmap M20 §4). All of them are the same two
 * database reads — the account list and the POSTED entries in a window —
 * shaped by the engines. Only POSTED entries are ever read: a draft is
 * somebody's unfinished work, and putting one in front of the committee
 * would report a number nobody has approved.
 *
 * The JSON shapes here are the contract the UI reads;
 * `AccountingExportService` is pure presentation over them, so XLSX/PDF
 * can change without touching the API (the M12 report/export split).
 */
@Injectable()
export class AccountingReportsService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly vouchers: VouchersRepository,
    private readonly config: AccountingConfigRepository,
  ) {}

  // ── general ledger ──────────────────────────────────────────────────

  async ledger(
    query: AccountingReportQueryDto,
    schoolId: string,
  ): Promise<LedgerReport> {
    if (!query.accountId) {
      throw new BadRequestException('accountId is required for a ledger');
    }
    const account = await this.accounts.findById(query.accountId, schoolId);
    if (!account) throw new NotFoundException('Account not found');

    const window = this.window(query);
    const opening = await this.openingFor(account, schoolId, window.from);
    const movements = await this.movementsFor(schoolId, account.id, window);

    return {
      ...window,
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        group: account.group,
      },
      ...buildLedger({
        group: account.group,
        opening,
        movements,
      }),
    };
  }

  // ── cash & bank books ───────────────────────────────────────────────

  /**
   * Cash book. When no account is named, every CASH account is summed —
   * which is what a school with a main box and a petty box actually wants
   * to see on one page.
   */
  async cashBook(
    query: AccountingReportQueryDto,
    schoolId: string,
  ): Promise<BookReport> {
    return this.book(query, schoolId, AccountType.CASH, 'Cash');
  }

  /** Bank book — one bank account, or all of them combined. */
  async bankBook(
    query: AccountingReportQueryDto,
    schoolId: string,
  ): Promise<BookReport> {
    return this.book(query, schoolId, AccountType.BANK, 'Bank');
  }

  private async book(
    query: AccountingReportQueryDto,
    schoolId: string,
    type: AccountType,
    label: string,
  ): Promise<BookReport> {
    const window = this.window(query);
    const all = await this.accounts.findAllForSchool(schoolId);
    const chosen = query.accountId
      ? all.filter((account) => account.id === query.accountId)
      : all.filter((account) => account.type === type);

    if (chosen.length === 0) {
      throw new NotFoundException(
        `This school has no ${label.toLowerCase()} account yet`,
      );
    }

    const ids = chosen.map((account) => account.id);
    const opening = (
      await Promise.all(
        chosen.map((account) =>
          this.openingFor(account, schoolId, window.from),
        ),
      )
    ).reduce((sum, value) => money(sum + value), 0);

    const movements = await this.movementsFor(schoolId, ids, window);

    const identity =
      chosen.length === 1
        ? { id: chosen[0].id, code: chosen[0].code, name: chosen[0].name }
        : { id: '', code: '', name: `All ${label.toLowerCase()} accounts` };

    return {
      ...window,
      account: identity,
      ...buildBook({ opening, movements }),
    };
  }

  // ── the three statements ────────────────────────────────────────────

  async trialBalance(
    query: AccountingReportQueryDto,
    schoolId: string,
  ): Promise<TrialBalance & ReportWindow> {
    const window = this.window(query);
    return { ...window, ...trialBalance(await this.totals(schoolId, window)) };
  }

  async incomeStatement(
    query: AccountingReportQueryDto,
    schoolId: string,
  ): Promise<IncomeStatement & ReportWindow> {
    const window = this.window(query);
    return {
      ...window,
      ...incomeStatement(await this.totals(schoolId, window)),
    };
  }

  /**
   * The balance sheet needs the same window's surplus carried into
   * equity, so it computes the income statement first — the engine
   * refuses to guess (see `reports.engine.ts`).
   */
  async balanceSheet(
    query: AccountingReportQueryDto,
    schoolId: string,
  ): Promise<BalanceSheet & ReportWindow> {
    const window = this.window(query);
    const totals = await this.totals(schoolId, window);
    const surplus = incomeStatement(totals).surplus;
    return { ...window, ...balanceSheet(totals, surplus) };
  }

  // ── receipts & payments ─────────────────────────────────────────────

  /**
   * What came into and went out of cash and bank, grouped by the
   * counter-account.
   *
   * The grouping is the interesting part: a receipt voucher's cash debit
   * is matched against the income lines on the same voucher, so the
   * statement reads "Tuition income 120,000" rather than "Cash 120,000".
   * Where a voucher has several counter-lines, each is attributed its own
   * share, so nothing is double-counted and the totals still reconcile
   * with the cash book's closing figure.
   */
  async receiptsPayments(
    query: AccountingReportQueryDto,
    schoolId: string,
  ): Promise<ReceiptsPayments & ReportWindow> {
    const window = this.window(query);
    const all = await this.accounts.findAllForSchool(schoolId);
    const funds = all.filter(
      (account) =>
        account.type === AccountType.CASH || account.type === AccountType.BANK,
    );
    const fundIds = new Set(funds.map((account) => account.id));
    const byId = new Map(all.map((account) => [account.id, account]));

    const openingCash = (
      await Promise.all(
        funds.map((account) => this.openingFor(account, schoolId, window.from)),
      )
    ).reduce((sum, value) => money(sum + value), 0);

    const entries = await this.vouchers.findEntries({
      schoolId,
      from: parseDate(window.from),
      to: parseDate(window.to),
    });

    const byVoucher = new Map<string, EntryRow[]>();
    for (const entry of entries) {
      const rows = byVoucher.get(entry.voucherId) ?? [];
      rows.push(entry);
      byVoucher.set(entry.voucherId, rows);
    }

    const receipts = new Map<string, number>();
    const payments = new Map<string, number>();

    for (const rows of byVoucher.values()) {
      const fundRows = rows.filter((row) => fundIds.has(row.accountId));
      if (fundRows.length === 0) continue;

      const otherRows = rows.filter((row) => !fundIds.has(row.accountId));
      // A pure contra (cash → bank) has no counter-account outside funds;
      // it moves the school's own money and is not a receipt or a payment.
      if (otherRows.length === 0) continue;

      const inflow = fundRows.reduce(
        (sum, row) => money(sum + Number(row.debit) - Number(row.credit)),
        0,
      );
      if (inflow === 0) continue;

      const target = inflow > 0 ? receipts : payments;
      for (const row of otherRows) {
        const share = money(Number(row.debit) + Number(row.credit));
        if (share === 0) continue;
        target.set(
          row.accountId,
          money((target.get(row.accountId) ?? 0) + share),
        );
      }
    }

    const toLines = (source: Map<string, number>): StatementLine[] =>
      [...source.entries()]
        .map(([accountId, amount]) => {
          const account = byId.get(accountId);
          return {
            accountId,
            code: account?.code ?? '',
            name: account?.name ?? 'Unknown account',
            amount,
          };
        })
        .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));

    return {
      ...window,
      ...receiptsPayments({
        openingCash,
        receipts: toLines(receipts),
        payments: toLines(payments),
      }),
    };
  }

  // ── budget vs actual ────────────────────────────────────────────────

  async budgetVsActual(
    query: AccountingReportQueryDto,
    schoolId: string,
  ): Promise<BudgetVariance & ReportWindow & { sessionId: string }> {
    if (!query.sessionId) {
      throw new BadRequestException(
        'sessionId is required — a budget is set per academic session',
      );
    }
    const window = this.window(query);
    const budgets = await this.config.findBudgets(schoolId, query.sessionId);
    const relevant = query.month
      ? budgets.filter((budget) => budget.month === query.month)
      : budgets;

    const totals = await this.totals(schoolId, window);
    const actualByAccount = new Map(
      totals.map((row) => [
        row.accountId,
        signedMovement(row.group, row.debit, row.credit),
      ]),
    );

    // Several monthly lines for one account roll up into a single row —
    // a variance report answers "how are we doing on salaries", not "how
    // are we doing on the March instalment of salaries".
    const merged = new Map<
      string,
      { code: string; name: string; group: string; budget: number }
    >();
    for (const budget of relevant) {
      const existing = merged.get(budget.accountId);
      merged.set(budget.accountId, {
        code: budget.account.code,
        name: budget.account.name,
        group: budget.account.group,
        budget: money((existing?.budget ?? 0) + Number(budget.amount)),
      });
    }

    return {
      ...window,
      sessionId: query.sessionId,
      ...budgetVariance(
        [...merged.entries()].map(([accountId, row]) => ({
          accountId,
          code: row.code,
          name: row.name,
          group: row.group,
          budget: row.budget,
          actual: actualByAccount.get(accountId) ?? 0,
        })),
      ),
    };
  }

  // ── internals ───────────────────────────────────────────────────────

  /** Defaults to the current month — the window a school looks at daily. */
  private window(query: AccountingReportQueryDto): ReportWindow {
    const today = new Date();
    const firstOfMonth = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    );
    const from = query.from ?? isoDate(firstOfMonth);
    const to = query.to ?? isoDate(today);
    if (parseDate(to) < parseDate(from)) {
      throw new BadRequestException(
        'The report’s end date is before its start',
      );
    }
    return { from, to };
  }

  /**
   * The account's balance the moment the window opens: its own opening
   * balance plus every POSTED movement before `from`, signed in its
   * natural direction.
   */
  private async openingFor(
    account: Account,
    schoolId: string,
    from: string,
  ): Promise<number> {
    const before = new Date(parseDate(from));
    before.setUTCDate(before.getUTCDate() - 1);

    const totals = await this.vouchers.sumByAccount({ schoolId, to: before });
    const movement = totals.get(account.id) ?? { debit: 0, credit: 0 };
    return money(
      Number(account.openingBalance) +
        signedMovement(account.group, movement.debit, movement.credit),
    );
  }

  private async movementsFor(
    schoolId: string,
    accountIds: string | string[],
    window: ReportWindow,
  ): Promise<LedgerMovement[]> {
    const ids = Array.isArray(accountIds) ? accountIds : [accountIds];
    const idSet = new Set(ids);

    const entries = await this.vouchers.findEntries({
      schoolId,
      from: parseDate(window.from),
      to: parseDate(window.to),
    });

    // "Particulars" — the other accounts on the same voucher, which is
    // what makes a ledger row readable without opening the voucher.
    const contraByVoucher = new Map<string, string[]>();
    const accounts = await this.accounts.findAllForSchool(schoolId);
    const nameById = new Map(
      accounts.map((account) => [account.id, account.name]),
    );
    for (const entry of entries) {
      if (idSet.has(entry.accountId)) continue;
      const names = contraByVoucher.get(entry.voucherId) ?? [];
      const name = nameById.get(entry.accountId);
      if (name && !names.includes(name)) names.push(name);
      contraByVoucher.set(entry.voucherId, names);
    }

    return entries
      .filter((entry) => idSet.has(entry.accountId))
      .map((entry) => ({
        date: isoDate(entry.date),
        voucherId: entry.voucherId,
        voucherNo: entry.voucherNo,
        voucherType: entry.voucherType,
        narration: entry.entryNarration ?? entry.narration,
        reference: entry.reference,
        contra: contraByVoucher.get(entry.voucherId) ?? [],
        debit: Number(entry.debit),
        credit: Number(entry.credit),
      }));
  }

  /** Per-account opening + brought-forward + window totals, in two reads. */
  private async totals(
    schoolId: string,
    window: ReportWindow,
  ): Promise<AccountTotals[]> {
    const accounts = await this.accounts.findAllForSchool(schoolId);

    const before = new Date(parseDate(window.from));
    before.setUTCDate(before.getUTCDate() - 1);

    const [priorTotals, windowTotals] = await Promise.all([
      this.vouchers.sumByAccount({ schoolId, to: before }),
      this.vouchers.sumByAccount({
        schoolId,
        from: parseDate(window.from),
        to: parseDate(window.to),
      }),
    ]);

    return (
      accounts
        // Headings are subtotals of their children; including them would
        // count every posting twice and break the trial balance.
        .filter((account) => !account.isGroup)
        .map((account) => {
          const prior = priorTotals.get(account.id) ?? { debit: 0, credit: 0 };
          const current = windowTotals.get(account.id) ?? {
            debit: 0,
            credit: 0,
          };
          return {
            accountId: account.id,
            code: account.code,
            name: account.name,
            group: account.group,
            type: account.type,
            openingBalance: Number(account.openingBalance),
            broughtForward: signedMovement(
              account.group,
              prior.debit,
              prior.credit,
            ),
            debit: current.debit,
            credit: current.credit,
          };
        })
    );
  }
}
