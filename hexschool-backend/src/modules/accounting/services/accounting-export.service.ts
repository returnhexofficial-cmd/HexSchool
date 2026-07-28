import { Injectable } from '@nestjs/common';
import { Workbook } from 'exceljs';
import PDFDocument from 'pdfkit';
import { formatMoney } from '../../fee/calc/money.util';
import type { VoucherWithEntries } from '../repositories/vouchers.repository';
import type {
  BalanceSheet,
  BudgetVariance,
  IncomeStatement,
  ReceiptsPayments,
  TrialBalance,
} from '../calc/reports.engine';
import type {
  BookReport,
  LedgerReport,
  ReportWindow,
} from './accounting-reports.service';

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface ReportContext {
  schoolName: string;
  schoolAddress?: string | null;
  footer: string;
}

/**
 * XLSX and PDF over the report shapes (roadmap M20 §4 "Reports (all:
 * date-range, PDF/XLSX)").
 *
 * Pure presentation — it never queries and never computes a total the
 * report did not already carry, which is the M12 reports/export split.
 * That matters more here than usual: a printed statement whose footer
 * total disagreed with the on-screen one would be indistinguishable from
 * a bookkeeping error.
 *
 * Deliberately plain output, like every PDF in this project so far —
 * pdfkit's default font cannot set Bangla (the limitation flagged for
 * M09 ID cards and M13–M16 output), and the branded report engine is an
 * M29 concern.
 */
@Injectable()
export class AccountingExportService {
  // ── vouchers ────────────────────────────────────────────────────────

  async voucherPdf(
    voucher: VoucherWithEntries,
    context: ReportContext,
  ): Promise<ExportFile> {
    const doc = new PDFDocument({
      size: 'A5',
      layout: 'landscape',
      margin: 28,
      info: { Title: `Voucher ${voucher.voucherNo}` },
    });
    const chunks: Buffer[] = [];
    const done = this.collect(doc, chunks);

    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text(context.schoolName, { align: 'center' });
    doc
      .fontSize(10)
      .text(`${voucher.type} VOUCHER`, { align: 'center' })
      .moveDown(0.6);

    doc.fontSize(9).font('Helvetica');
    doc.text(`Voucher No: ${voucher.voucherNo}`, { continued: true });
    doc.text(`        Date: ${voucher.date.toISOString().slice(0, 10)}`, {
      align: 'right',
    });
    doc.text(`Status: ${voucher.status}`);
    if (voucher.reference) doc.text(`Reference: ${voucher.reference}`);
    doc.moveDown(0.4);
    doc.font('Helvetica-Oblique').text(voucher.narration).moveDown(0.6);

    const columns = [28, 240, 380, 470];
    doc.font('Helvetica-Bold').fontSize(9);
    let y = doc.y;
    doc.text('Account', columns[0], y);
    doc.text('Particulars', columns[1], y);
    doc.text('Debit', columns[2], y, { width: 70, align: 'right' });
    doc.text('Credit', columns[3], y, { width: 70, align: 'right' });
    doc.moveDown(0.3);
    doc
      .moveTo(columns[0], doc.y)
      .lineTo(545, doc.y)
      .strokeColor('#999')
      .stroke();
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(8.5);
    let debitTotal = 0;
    let creditTotal = 0;
    for (const entry of voucher.entries) {
      y = doc.y;
      doc.text(`${entry.account.code} ${entry.account.name}`, columns[0], y, {
        width: 200,
      });
      doc.text(entry.narration ?? '', columns[1], y, { width: 130 });
      doc.text(formatMoney(Number(entry.debit)), columns[2], y, {
        width: 70,
        align: 'right',
      });
      doc.text(formatMoney(Number(entry.credit)), columns[3], y, {
        width: 70,
        align: 'right',
      });
      debitTotal += Number(entry.debit);
      creditTotal += Number(entry.credit);
      doc.moveDown(0.35);
    }

    doc.moveTo(columns[0], doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.3);
    y = doc.y;
    doc.font('Helvetica-Bold');
    doc.text('Total', columns[0], y);
    doc.text(formatMoney(debitTotal), columns[2], y, {
      width: 70,
      align: 'right',
    });
    doc.text(formatMoney(creditTotal), columns[3], y, {
      width: 70,
      align: 'right',
    });

    doc.moveDown(2.5);
    doc.font('Helvetica').fontSize(8).fillColor('#555');
    y = doc.y;
    doc.text('Prepared by', columns[0], y, { width: 120, align: 'center' });
    doc.text('Checked by', 220, y, { width: 120, align: 'center' });
    doc.text('Approved by', 400, y, { width: 120, align: 'center' });
    if (context.footer) {
      doc.moveDown(1).fontSize(7).text(context.footer, { align: 'center' });
    }

    doc.end();
    await done;
    return {
      buffer: Buffer.concat(chunks),
      filename: `voucher-${voucher.voucherNo}.pdf`,
      contentType: 'application/pdf',
    };
  }

  // ── XLSX ────────────────────────────────────────────────────────────

  async ledgerXlsx(report: LedgerReport): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Ledger');

    sheet.addRow([`${report.account.code} ${report.account.name}`]);
    sheet.addRow([`${report.from} → ${report.to}`]);
    sheet.addRow([
      `Opening: ${formatMoney(report.openingBalance)} ${report.openingSide}`,
    ]);
    sheet.addRow([]);
    sheet.addRow([
      'Date',
      'Voucher',
      'Type',
      'Particulars',
      'Narration',
      'Debit',
      'Credit',
      'Balance',
      'Side',
    ]);
    for (const row of report.rows) {
      sheet.addRow([
        row.date,
        row.voucherNo,
        row.voucherType,
        (row.contra ?? []).join(', '),
        row.narration,
        row.debit,
        row.credit,
        row.balance,
        row.balanceSide,
      ]);
    }
    sheet.addRow([]);
    sheet.addRow([
      'Total',
      '',
      '',
      '',
      '',
      report.debitTotal,
      report.creditTotal,
      report.closingBalance,
      report.closingSide,
    ]);

    this.style(sheet, 5);
    return this.finish(workbook, `ledger-${report.account.code}-${report.to}`);
  }

  async bookXlsx(report: BookReport, label: string): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet(label);

    sheet.addRow([`${label} — ${report.account.name}`]);
    sheet.addRow([`${report.from} → ${report.to}`]);
    sheet.addRow([`Opening: ${formatMoney(report.openingBalance)}`]);
    sheet.addRow([]);
    sheet.addRow([
      'Date',
      'Voucher',
      'Particulars',
      'Narration',
      'Receipt',
      'Payment',
      'Balance',
    ]);
    for (const row of report.rows) {
      sheet.addRow([
        row.date,
        row.voucherNo,
        row.particulars,
        row.narration,
        row.receipt,
        row.payment,
        row.balance,
      ]);
    }
    sheet.addRow([]);
    sheet.addRow([
      'Total',
      '',
      '',
      '',
      report.receiptTotal,
      report.paymentTotal,
      report.closingBalance,
    ]);

    this.style(sheet, 5);
    return this.finish(
      workbook,
      `${label.toLowerCase().replace(/\s+/g, '-')}-${report.to}`,
    );
  }

  async trialBalanceXlsx(
    report: TrialBalance & ReportWindow,
  ): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Trial balance');

    sheet.addRow([`Trial balance ${report.from} → ${report.to}`]);
    sheet.addRow([
      report.balanced
        ? 'Balanced'
        : `OUT OF BALANCE by ${formatMoney(report.difference)}`,
    ]);
    sheet.addRow([]);
    sheet.addRow(['Code', 'Account', 'Group', 'Debit', 'Credit']);
    for (const row of report.rows) {
      sheet.addRow([row.code, row.name, row.group, row.debit, row.credit]);
    }
    sheet.addRow([]);
    sheet.addRow(['Total', '', '', report.debitTotal, report.creditTotal]);

    this.style(sheet, 4);
    return this.finish(workbook, `trial-balance-${report.to}`);
  }

  async incomeStatementXlsx(
    report: IncomeStatement & ReportWindow,
  ): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Income statement');

    sheet.addRow([`Income & expenditure ${report.from} → ${report.to}`]);
    sheet.addRow([]);
    sheet.addRow(['Income', '']);
    for (const line of report.income) {
      sheet.addRow([`${line.code} ${line.name}`, line.amount]);
    }
    sheet.addRow(['Total income', report.incomeTotal]);
    sheet.addRow([]);
    sheet.addRow(['Expenditure', '']);
    for (const line of report.expense) {
      sheet.addRow([`${line.code} ${line.name}`, line.amount]);
    }
    sheet.addRow(['Total expenditure', report.expenseTotal]);
    sheet.addRow([]);
    sheet.addRow([
      report.surplus >= 0 ? 'Surplus' : 'Deficit',
      Math.abs(report.surplus),
    ]);

    this.style(sheet, 3);
    return this.finish(workbook, `income-statement-${report.to}`);
  }

  async balanceSheetXlsx(
    report: BalanceSheet & ReportWindow,
  ): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Balance sheet');

    sheet.addRow([`Balance sheet as at ${report.to}`]);
    sheet.addRow([
      report.balanced
        ? 'Balanced'
        : `OUT OF BALANCE by ${formatMoney(report.difference)}`,
    ]);
    sheet.addRow([]);
    sheet.addRow(['Assets', '']);
    for (const line of report.assets) {
      sheet.addRow([`${line.code} ${line.name}`, line.amount]);
    }
    sheet.addRow(['Total assets', report.assetTotal]);
    sheet.addRow([]);
    sheet.addRow(['Liabilities', '']);
    for (const line of report.liabilities) {
      sheet.addRow([`${line.code} ${line.name}`, line.amount]);
    }
    sheet.addRow(['Total liabilities', report.liabilityTotal]);
    sheet.addRow([]);
    sheet.addRow(['Equity', '']);
    for (const line of report.equity) {
      sheet.addRow([`${line.code} ${line.name}`, line.amount]);
    }
    sheet.addRow(['Surplus for the period', report.surplus]);
    sheet.addRow(['Total equity & liabilities', report.fundedTotal]);

    this.style(sheet, 4);
    return this.finish(workbook, `balance-sheet-${report.to}`);
  }

  async receiptsPaymentsXlsx(
    report: ReceiptsPayments & ReportWindow,
  ): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Receipts & payments');

    sheet.addRow([`Receipts & payments ${report.from} → ${report.to}`]);
    sheet.addRow([`Opening cash & bank: ${formatMoney(report.openingCash)}`]);
    sheet.addRow([]);
    sheet.addRow(['Receipts', '']);
    for (const line of report.receipts) {
      sheet.addRow([`${line.code} ${line.name}`, line.amount]);
    }
    sheet.addRow(['Total receipts', report.receiptTotal]);
    sheet.addRow([]);
    sheet.addRow(['Payments', '']);
    for (const line of report.payments) {
      sheet.addRow([`${line.code} ${line.name}`, line.amount]);
    }
    sheet.addRow(['Total payments', report.paymentTotal]);
    sheet.addRow([]);
    sheet.addRow(['Closing cash & bank', report.closingCash]);

    this.style(sheet, 4);
    return this.finish(workbook, `receipts-payments-${report.to}`);
  }

  async budgetVarianceXlsx(
    report: BudgetVariance & ReportWindow,
  ): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Budget vs actual');

    sheet.addRow([`Budget vs actual ${report.from} → ${report.to}`]);
    sheet.addRow([]);
    sheet.addRow([
      'Code',
      'Account',
      'Group',
      'Budget',
      'Actual',
      'Variance',
      'Used %',
      'Favourable',
    ]);
    for (const row of report.rows) {
      sheet.addRow([
        row.code,
        row.name,
        row.group,
        row.budget,
        row.actual,
        row.variance,
        row.usedPercent ?? '—',
        row.favourable ? 'Yes' : 'No',
      ]);
    }
    sheet.addRow([]);
    sheet.addRow([
      'Total',
      '',
      '',
      report.budgetTotal,
      report.actualTotal,
      report.variance,
    ]);

    this.style(sheet, 3);
    return this.finish(workbook, `budget-vs-actual-${report.to}`);
  }

  // ── statement PDF ───────────────────────────────────────────────────

  /**
   * One generic statement printer over a list of `[label, amount]`
   * sections. All five statements share a layout — a title, dated
   * sections and a bold total — so five bespoke printers would be five
   * places for the same formatting bug to hide.
   */
  async statementPdf(params: {
    title: string;
    subtitle: string;
    context: ReportContext;
    sections: Array<{
      heading: string;
      rows: Array<[string, number | string]>;
      total?: [string, number];
    }>;
    note?: string;
  }): Promise<ExportFile> {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: { Title: params.title },
    });
    const chunks: Buffer[] = [];
    const done = this.collect(doc, chunks);

    doc
      .fontSize(15)
      .font('Helvetica-Bold')
      .text(params.context.schoolName, { align: 'center' });
    if (params.context.schoolAddress) {
      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor('#555')
        .text(params.context.schoolAddress, { align: 'center' });
    }
    doc
      .fillColor('#000')
      .fontSize(12)
      .font('Helvetica-Bold')
      .text(params.title, { align: 'center' });
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#555')
      .text(params.subtitle, { align: 'center' })
      .fillColor('#000')
      .moveDown(1);

    for (const section of params.sections) {
      doc.fontSize(10).font('Helvetica-Bold').text(section.heading);
      doc.moveDown(0.2);
      doc.fontSize(9).font('Helvetica');
      for (const [label, amount] of section.rows) {
        const y = doc.y;
        doc.text(String(label), 45, y, { width: 380 });
        doc.text(
          typeof amount === 'number' ? formatMoney(amount) : String(amount),
          430,
          y,
          { width: 120, align: 'right' },
        );
        doc.moveDown(0.25);
      }
      if (section.total) {
        doc.moveTo(45, doc.y).lineTo(550, doc.y).strokeColor('#999').stroke();
        doc.moveDown(0.25);
        const y = doc.y;
        doc.font('Helvetica-Bold');
        doc.text(section.total[0], 45, y, { width: 380 });
        doc.text(formatMoney(section.total[1]), 430, y, {
          width: 120,
          align: 'right',
        });
        doc.font('Helvetica');
      }
      doc.moveDown(0.8);
    }

    if (params.note) {
      doc.moveDown(0.5).fontSize(9).font('Helvetica-Bold').text(params.note);
    }
    if (params.context.footer) {
      doc
        .moveDown(1)
        .fontSize(7)
        .font('Helvetica')
        .fillColor('#666')
        .text(params.context.footer, { align: 'center' });
    }

    doc.end();
    await done;
    return {
      buffer: Buffer.concat(chunks),
      filename: `${slug(params.title)}.pdf`,
      contentType: 'application/pdf',
    };
  }

  // ── internals ───────────────────────────────────────────────────────

  private style(
    sheet: ReturnType<Workbook['addWorksheet']>,
    headerRow: number,
  ): void {
    sheet.getRow(1).font = { bold: true, size: 14 };
    sheet.getRow(headerRow).font = { bold: true };
    sheet.columns.forEach((column) => {
      column.width = 22;
    });
  }

  private async finish(workbook: Workbook, name: string): Promise<ExportFile> {
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename: `${name}.xlsx`,
      contentType: XLSX_TYPE,
    };
  }

  private collect(doc: PDFKit.PDFDocument, chunks: Buffer[]): Promise<void> {
    return new Promise((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve());
      doc.on('error', reject);
    });
  }
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
