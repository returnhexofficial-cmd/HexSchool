import { Injectable } from '@nestjs/common';
import { AccountingReportsService } from '../../../accounting/services/accounting-reports.service';
import type { ReportRow, ReportTable } from '../../calc/types';
import {
  defaultWindow,
  str,
  type ReportContext,
  type ReportExecutor,
  type ReportExecutorProvider,
} from '../executor.types';

/**
 * M20's eight statutory reports.
 *
 * Two of them — the income statement and the balance sheet — are *not*
 * naturally one table. An income statement is two lists with two totals
 * and a surplus between them, and a balance sheet is three. Flattening
 * them into a single column of rows with a `section` column is the only
 * honest rectangular form: the alternative, one sheet per side, would
 * separate the two halves of a statement that only means anything read
 * together, and the surplus line would belong to neither.
 */
@Injectable()
export class AccountingReportExecutors implements ReportExecutorProvider {
  constructor(private readonly reports: AccountingReportsService) {}

  executors(): Record<string, ReportExecutor> {
    return {
      'accounting.cash-book': (ctx) => this.book(ctx, 'cash'),
      'accounting.bank-book': (ctx) => this.book(ctx, 'bank'),
      'accounting.ledger': (ctx) => this.ledger(ctx),
      'accounting.trial-balance': (ctx) => this.trialBalance(ctx),
      'accounting.income-statement': (ctx) => this.incomeStatement(ctx),
      'accounting.balance-sheet': (ctx) => this.balanceSheet(ctx),
      'accounting.receipts-payments': (ctx) => this.receiptsPayments(ctx),
      'accounting.budget-vs-actual': (ctx) => this.budget(ctx),
    };
  }

  private window(ctx: ReportContext) {
    const window = defaultWindow(ctx.params);
    return { from: window.from, to: window.to };
  }

  private async book(
    ctx: ReportContext,
    kind: 'cash' | 'bank',
  ): Promise<ReportTable> {
    const query = this.window(ctx);
    const report =
      kind === 'cash'
        ? await this.reports.cashBook(query, ctx.schoolId)
        : await this.reports.bankBook(query, ctx.schoolId);

    return {
      title: `${kind === 'cash' ? 'Cash' : 'Bank'} book — ${report.from} to ${report.to}`,
      subtitle: `${report.account.code} ${report.account.name}`,
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'voucherNo', label: 'Voucher' },
        { key: 'particulars', label: 'Particulars', width: 32 },
        { key: 'narration', label: 'Narration', width: 40 },
        { key: 'receipt', label: 'Receipt', type: 'money' },
        { key: 'payment', label: 'Payment', type: 'money' },
        { key: 'balance', label: 'Balance', type: 'money' },
      ],
      rows: report.rows.map((row) => ({ ...row })),
      summary: [
        { label: 'Opening', value: report.openingBalance },
        { label: 'Receipts', value: report.receiptTotal },
        { label: 'Payments', value: report.paymentTotal },
        { label: 'Closing', value: report.closingBalance },
      ],
      notes: ['Only POSTED vouchers are read — a draft is unfinished work.'],
    };
  }

  private async ledger(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.reports.ledger(
      { ...this.window(ctx), accountId: str(ctx.params, 'accountId') },
      ctx.schoolId,
    );

    return {
      title: `Ledger — ${report.account.code} ${report.account.name}`,
      subtitle: `${report.from} to ${report.to}`,
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'voucherNo', label: 'Voucher' },
        { key: 'narration', label: 'Narration', width: 40 },
        { key: 'contra', label: 'Contra', width: 28 },
        { key: 'debit', label: 'Debit', type: 'money' },
        { key: 'credit', label: 'Credit', type: 'money' },
        { key: 'balance', label: 'Balance', type: 'money' },
        { key: 'balanceSide', label: 'Dr/Cr' },
      ],
      rows: report.rows.map((row) => ({
        date: row.date,
        voucherNo: row.voucherNo,
        narration: row.narration,
        contra: (row.contra ?? []).join(', '),
        debit: row.debit,
        credit: row.credit,
        balance: row.balance,
        balanceSide: row.balanceSide,
      })),
      summary: [
        {
          label: 'Opening',
          value: `${report.openingBalance} ${report.openingSide}`,
        },
        { label: 'Debit', value: report.debitTotal },
        { label: 'Credit', value: report.creditTotal },
        {
          label: 'Closing',
          value: `${report.closingBalance} ${report.closingSide}`,
        },
      ],
      notes: [
        'A balance carries its side: an overdrawn asset reports as CREDIT rather than as a negative number.',
      ],
    };
  }

  private async trialBalance(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.reports.trialBalance(
      this.window(ctx),
      ctx.schoolId,
    );
    return {
      title: `Trial balance — ${report.from} to ${report.to}`,
      columns: [
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Account', width: 34 },
        { key: 'group', label: 'Group' },
        { key: 'debit', label: 'Debit', type: 'money' },
        { key: 'credit', label: 'Credit', type: 'money' },
      ],
      rows: report.rows.map((row) => ({ ...row })),
      summary: [
        { label: 'Debit total', value: report.debitTotal },
        { label: 'Credit total', value: report.creditTotal },
        { label: 'Difference', value: report.difference },
        { label: 'Balanced', value: report.balanced ? 'Yes' : 'No' },
      ],
      notes: [
        'Accounts closing at zero are omitted — a trial balance lists what the school holds.',
      ],
    };
  }

  private async incomeStatement(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.reports.incomeStatement(
      this.window(ctx),
      ctx.schoolId,
    );
    const rows: ReportRow[] = [
      ...report.income.map((line) => ({
        section: 'Income',
        code: line.code,
        name: line.name,
        amount: line.amount,
      })),
      {
        section: 'Income',
        code: '',
        name: 'Total income',
        amount: report.incomeTotal,
      },
      ...report.expense.map((line) => ({
        section: 'Expenditure',
        code: line.code,
        name: line.name,
        amount: line.amount,
      })),
      {
        section: 'Expenditure',
        code: '',
        name: 'Total expenditure',
        amount: report.expenseTotal,
      },
      {
        section: report.surplus >= 0 ? 'Surplus' : 'Deficit',
        code: '',
        name:
          report.surplus >= 0
            ? 'Surplus for the period'
            : 'Deficit for the period',
        amount: report.surplus,
      },
    ];

    return {
      title: `Income & expenditure — ${report.from} to ${report.to}`,
      columns: [
        { key: 'section', label: 'Section' },
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Account', width: 34 },
        { key: 'amount', label: 'Amount', type: 'money' },
      ],
      rows,
      notes: [
        'The window only: brought-forward and opening balances are excluded, because this answers "what happened between these dates".',
      ],
    };
  }

  private async balanceSheet(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.reports.balanceSheet(
      this.window(ctx),
      ctx.schoolId,
    );
    const block = (section: string, lines: typeof report.assets) =>
      lines.map((line) => ({
        section,
        code: line.code,
        name: line.name,
        amount: line.amount,
      }));

    const rows: ReportRow[] = [
      ...block('Assets', report.assets),
      {
        section: 'Assets',
        code: '',
        name: 'Total assets',
        amount: report.assetTotal,
      },
      ...block('Liabilities', report.liabilities),
      {
        section: 'Liabilities',
        code: '',
        name: 'Total liabilities',
        amount: report.liabilityTotal,
      },
      ...block('Fund', report.equity),
      {
        section: 'Fund',
        code: '',
        name: 'Surplus for the period',
        amount: report.surplus,
      },
      {
        section: 'Fund',
        code: '',
        name: 'Total fund',
        amount: report.equityTotal,
      },
      {
        section: '',
        code: '',
        name: 'Liabilities + fund',
        amount: report.fundedTotal,
      },
    ];

    return {
      title: `Balance sheet — as at ${report.to}`,
      columns: [
        { key: 'section', label: 'Section' },
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Account', width: 34 },
        { key: 'amount', label: 'Amount', type: 'money' },
      ],
      rows,
      summary: [
        { label: 'Difference', value: report.difference },
        { label: 'Balanced', value: report.balanced ? 'Yes' : 'No' },
      ],
    };
  }

  private async receiptsPayments(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.reports.receiptsPayments(
      this.window(ctx),
      ctx.schoolId,
    );
    const rows: ReportRow[] = [
      {
        section: 'Opening',
        code: '',
        name: 'Opening cash & bank',
        amount: report.openingCash,
      },
      ...report.receipts.map((line) => ({
        section: 'Receipts',
        code: line.code,
        name: line.name,
        amount: line.amount,
      })),
      {
        section: 'Receipts',
        code: '',
        name: 'Total receipts',
        amount: report.receiptTotal,
      },
      ...report.payments.map((line) => ({
        section: 'Payments',
        code: line.code,
        name: line.name,
        amount: line.amount,
      })),
      {
        section: 'Payments',
        code: '',
        name: 'Total payments',
        amount: report.paymentTotal,
      },
      {
        section: 'Closing',
        code: '',
        name: 'Closing cash & bank',
        amount: report.closingCash,
      },
    ];

    return {
      title: `Receipts & payments — ${report.from} to ${report.to}`,
      columns: [
        { key: 'section', label: 'Section' },
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Account', width: 34 },
        { key: 'amount', label: 'Amount', type: 'money' },
      ],
      rows,
      notes: [
        'Cash-based by construction — a bill raised but unpaid never appears.',
      ],
    };
  }

  private async budget(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.reports.budgetVsActual(
      { ...this.window(ctx), sessionId: str(ctx.params, 'sessionId') },
      ctx.schoolId,
    );
    return {
      title: `Budget vs actual — ${report.from} to ${report.to}`,
      columns: [
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Account', width: 34 },
        { key: 'group', label: 'Group' },
        { key: 'budget', label: 'Budget', type: 'money' },
        { key: 'actual', label: 'Actual', type: 'money' },
        { key: 'variance', label: 'Variance', type: 'money' },
        { key: 'usedPercent', label: 'Used', type: 'percent' },
        { key: 'favourable', label: 'Favourable' },
      ],
      rows: report.rows.map((row) => ({ ...row })),
      summary: [
        { label: 'Budget', value: report.budgetTotal },
        { label: 'Actual', value: report.actualTotal },
        { label: 'Variance', value: report.variance },
      ],
      notes: [
        'Over-earning income is favourable; over-spending an expense is not — the same signed number means opposite things by group, so the report makes that call rather than leaving it to the reader.',
      ],
    };
  }
}
