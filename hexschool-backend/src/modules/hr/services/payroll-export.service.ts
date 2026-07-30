import { Injectable } from '@nestjs/common';
import { PayrollRun, Payslip } from '@prisma/client';
import { Workbook } from 'exceljs';
import PDFDocument from 'pdfkit';
import { isoDate } from '../../academic/calendar/date.util';
import { formatMoney } from '../../fee/calc/money.util';
import { BreakdownLine } from '../calc/payroll.engine';
import type {
  GradeDistributionRow,
  PfReportRow,
  RegisterReport,
  TaxReportRow,
  YtdReport,
} from './payroll-reports.service';

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

export interface PayslipContext {
  schoolName: string;
  schoolAddress?: string | null;
  month: string;
  footer: string;
}

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * XLSX and PDF over the payroll shapes (roadmap M21 §4).
 *
 * Pure presentation — it never queries and never computes a figure the
 * report did not already carry (the M12 reports/export split, and the
 * same reason M20 gives: a printed total that disagreed with the screen
 * would be indistinguishable from an arithmetic error).
 *
 * Deliberately plain output. pdfkit's default font cannot set Bangla —
 * the limitation flagged since M09 ID cards — so a payslip prints the
 * English name; the branded, bilingual report engine is an M29 concern.
 */
@Injectable()
export class PayrollExportService {
  // ── payslip ─────────────────────────────────────────────────────────

  async payslipPdf(
    payslip: Payslip,
    context: PayslipContext,
  ): Promise<ExportFile> {
    const doc = new PDFDocument({
      size: 'A5',
      margin: 30,
      info: { Title: `Payslip ${payslip.employeeId} ${context.month}` },
    });
    const chunks: Buffer[] = [];
    const done = this.collect(doc, chunks);

    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text(context.schoolName, { align: 'center' });
    if (context.schoolAddress) {
      doc
        .fontSize(8)
        .font('Helvetica')
        .text(context.schoolAddress, { align: 'center' });
    }
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .text(`PAYSLIP — ${context.month}`, { align: 'center' })
      .moveDown(0.6);

    doc.fontSize(9).font('Helvetica');
    doc.text(`Name: ${payslip.personName}`);
    doc.text(`Employee ID: ${payslip.employeeId}`, { continued: true });
    doc.text(`        Designation: ${payslip.designation ?? '—'}`, {
      align: 'right',
    });
    doc.text(
      `Working days: ${payslip.workingDays}    Present: ${Number(payslip.daysPresent)}    Leave: ${Number(payslip.daysLeavePaid)}    Absent: ${Number(payslip.daysAbsent)}`,
    );
    doc.moveDown(0.5);

    const lines = readLines(payslip);
    const earnings = lines.filter((line) => line.kind === 'EARNING');
    const deductions = lines.filter((line) => line.kind === 'DEDUCTION');

    const left = 30;
    const right = 220;
    let y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Earnings', left, y);
    doc.text('Deductions', right, y);
    y += 14;

    doc.font('Helvetica').fontSize(8);
    const rows = Math.max(earnings.length, deductions.length);
    for (let index = 0; index < rows; index += 1) {
      if (earnings[index]) {
        doc.text(earnings[index].label, left, y, { width: 120 });
        doc.text(formatMoney(earnings[index].amount), left + 120, y, {
          width: 60,
          align: 'right',
        });
      }
      if (deductions[index]) {
        doc.text(deductions[index].label, right, y, { width: 120 });
        doc.text(formatMoney(deductions[index].amount), right + 120, y, {
          width: 60,
          align: 'right',
        });
      }
      y += 12;
    }

    y += 6;
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text(`Gross: ${formatMoney(Number(payslip.gross))}`, left, y);
    doc.text(
      `Deductions: ${formatMoney(Number(payslip.totalDeductions))}`,
      right,
      y,
    );
    y += 16;
    doc
      .fontSize(11)
      .text(
        `NET PAYABLE: ${formatMoney(Number(payslip.netPayable))} BDT`,
        left,
        y,
      );

    doc.moveDown(2);
    doc.font('Helvetica').fontSize(7);
    if (payslip.editReason) {
      doc.text(`Adjusted: ${payslip.editReason}`);
    }
    doc.text(
      context.footer ||
        'This is a computer-generated payslip and needs no signature.',
      { align: 'center' },
    );

    doc.end();
    await done;
    return {
      buffer: Buffer.concat(chunks),
      filename: `payslip-${payslip.employeeId}-${context.month}.pdf`,
      contentType: 'application/pdf',
    };
  }

  // ── register ────────────────────────────────────────────────────────

  async registerXlsx(report: RegisterReport): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Payroll register');

    sheet.addRow(['Monthly payroll register']);
    sheet.addRow([`${report.from} → ${report.to}`]);
    sheet.addRow([]);
    sheet.addRow([
      'Employee ID',
      'Name',
      'Designation',
      'Type',
      'Basic',
      'Allowances',
      'Gross',
      'Attendance ded.',
      'Other ded.',
      'PF (employee)',
      'Tax',
      'Bonus',
      'Net payable',
      'Working days',
      'Present',
      'Absent',
      'Status',
    ]);
    for (const row of report.rows) {
      sheet.addRow([
        row.employeeId,
        row.name,
        row.designation ?? '',
        row.personType,
        row.basic,
        row.allowances,
        row.gross,
        row.attendanceDeduction,
        row.otherDeductions,
        row.pfEmployee,
        row.tax,
        row.bonus,
        row.netPayable,
        row.workingDays,
        row.daysPresent,
        row.daysAbsent,
        row.status,
      ]);
    }
    sheet.addRow([]);
    sheet.addRow([
      'Total',
      '',
      '',
      '',
      report.totals.basic,
      report.totals.allowances,
      report.totals.gross,
      report.totals.attendanceDeduction,
      report.totals.otherDeductions,
      report.totals.pfEmployee,
      report.totals.tax,
      report.totals.bonus,
      report.totals.netPayable,
    ]);

    this.style(sheet, 4);
    return this.finish(
      workbook,
      `payroll-register-${report.from}-${report.to}`,
    );
  }

  async registerPdf(
    report: RegisterReport,
    context: Omit<PayslipContext, 'month'>,
  ): Promise<ExportFile> {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 24,
      info: { Title: 'Payroll register' },
    });
    const chunks: Buffer[] = [];
    const done = this.collect(doc, chunks);

    doc.fontSize(13).font('Helvetica-Bold').text(context.schoolName, {
      align: 'center',
    });
    doc
      .fontSize(10)
      .text(`Payroll register — ${report.from} → ${report.to}`, {
        align: 'center',
      })
      .moveDown(0.6);

    const columns = [24, 90, 250, 330, 400, 460, 520, 590, 660, 740];
    const header = [
      'Emp ID',
      'Name',
      'Basic',
      'Allow.',
      'Gross',
      'Att. ded.',
      'PF',
      'Tax',
      'Bonus',
      'Net',
    ];
    doc.font('Helvetica-Bold').fontSize(8);
    let y = doc.y;
    header.forEach((label, index) => {
      doc.text(label, columns[index], y, {
        width: 66,
        align: index >= 2 ? 'right' : 'left',
      });
    });
    y += 14;

    doc.font('Helvetica').fontSize(7.5);
    for (const row of report.rows) {
      if (y > 520) {
        doc.addPage();
        y = 40;
      }
      const cells = [
        row.employeeId,
        row.name,
        formatMoney(row.basic),
        formatMoney(row.allowances),
        formatMoney(row.gross),
        formatMoney(row.attendanceDeduction),
        formatMoney(row.pfEmployee),
        formatMoney(row.tax),
        formatMoney(row.bonus),
        formatMoney(row.netPayable),
      ];
      cells.forEach((value, index) => {
        doc.text(value, columns[index], y, {
          width: index === 1 ? 150 : 66,
          align: index >= 2 ? 'right' : 'left',
        });
      });
      y += 12;
    }

    y += 6;
    doc.font('Helvetica-Bold').fontSize(8);
    doc.text('Total', columns[0], y);
    doc.text(formatMoney(report.totals.gross), columns[4], y, {
      width: 66,
      align: 'right',
    });
    doc.text(formatMoney(report.totals.netPayable), columns[9], y, {
      width: 66,
      align: 'right',
    });

    if (context.footer) {
      doc.moveDown(2).font('Helvetica').fontSize(7).text(context.footer, {
        align: 'center',
      });
    }

    doc.end();
    await done;
    return {
      buffer: Buffer.concat(chunks),
      filename: `payroll-register-${report.from}-${report.to}.pdf`,
      contentType: 'application/pdf',
    };
  }

  // ── the other reports ───────────────────────────────────────────────

  async pfXlsx(rows: PfReportRow[]): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Provident fund');
    sheet.addRow(['Provident-fund statement']);
    sheet.addRow([]);
    sheet.addRow([
      'Employee ID',
      'Name',
      'Type',
      'Employee contribution',
      'Employer contribution',
      'Withdrawn',
      'Balance',
    ]);
    for (const row of rows) {
      sheet.addRow([
        row.employeeId,
        row.name,
        row.personType,
        row.employeeTotal,
        row.employerTotal,
        row.withdrawn,
        row.balance,
      ]);
    }
    this.style(sheet, 3);
    return this.finish(workbook, 'provident-fund');
  }

  async taxXlsx(
    rows: TaxReportRow[],
    window: { from: string; to: string },
  ): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Tax deducted');
    sheet.addRow(['Tax deducted at source']);
    sheet.addRow([`${window.from} → ${window.to}`]);
    sheet.addRow([]);
    sheet.addRow([
      'Employee ID',
      'Name',
      'Type',
      'Months',
      'Gross paid',
      'Tax deducted',
    ]);
    for (const row of rows) {
      sheet.addRow([
        row.employeeId,
        row.name,
        row.personType,
        row.months,
        row.taxableGross,
        row.taxDeducted,
      ]);
    }
    this.style(sheet, 4);
    return this.finish(workbook, `tax-deducted-${window.from}-${window.to}`);
  }

  async gradesXlsx(rows: GradeDistributionRow[]): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Salary grades');
    sheet.addRow(['Salary-grade distribution']);
    sheet.addRow([]);
    sheet.addRow([
      'Structure',
      'Grade',
      'Basic',
      'Gross',
      'Headcount',
      'Monthly cost',
    ]);
    for (const row of rows) {
      sheet.addRow([
        row.structureName,
        row.grade ?? '',
        row.basic,
        row.gross,
        row.headcount,
        row.gross * row.headcount,
      ]);
    }
    this.style(sheet, 3);
    return this.finish(workbook, 'salary-grades');
  }

  async ytdXlsx(report: YtdReport): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Year to date');
    sheet.addRow([`Year to date — ${report.employee.name}`]);
    sheet.addRow([`${report.from} → ${report.to}`]);
    sheet.addRow([]);
    sheet.addRow([
      'Month',
      'Gross',
      'Deductions',
      'PF',
      'Tax',
      'Bonus',
      'Net payable',
      'Run status',
    ]);
    for (const row of report.rows) {
      sheet.addRow([
        row.month,
        row.gross,
        row.deductions,
        row.pfEmployee,
        row.tax,
        row.bonus,
        row.netPayable,
        row.status,
      ]);
    }
    sheet.addRow([]);
    sheet.addRow([
      'Total',
      report.totals.gross,
      report.totals.deductions,
      report.totals.pfEmployee,
      report.totals.tax,
      report.totals.bonus,
      report.totals.netPayable,
    ]);
    this.style(sheet, 4);
    return this.finish(
      workbook,
      `ytd-${report.employee.employeeId}-${report.from}-${report.to}`,
    );
  }

  /**
   * The bank advice sheet a school hands its bank (roadmap §4).
   *
   * One row per payee with the account to credit — which is why
   * `payment_mode = BANK` demands the account fields at assignment time
   * rather than discovering the gap on the morning the sheet is due.
   */
  async bankAdviceXlsx(
    run: PayrollRun,
    rows: Array<{
      employeeId: string;
      name: string;
      bankName: string | null;
      branchName: string | null;
      accountNo: string | null;
      accountName: string | null;
      routingNo: string | null;
      paymentMode: string;
      amount: number;
    }>,
    total: number,
    schoolName: string,
  ): Promise<ExportFile> {
    const month = isoDate(run.month).slice(0, 7);
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Bank advice');

    sheet.addRow([`${schoolName} — salary disbursement advice`]);
    sheet.addRow([`Month: ${month}`]);
    sheet.addRow([]);
    sheet.addRow([
      'SL',
      'Employee ID',
      'Name',
      'Account name',
      'Account no',
      'Bank',
      'Branch',
      'Routing no',
      'Mode',
      'Amount (BDT)',
    ]);
    rows.forEach((row, index) => {
      sheet.addRow([
        index + 1,
        row.employeeId,
        row.name,
        row.accountName ?? row.name,
        row.accountNo ?? '',
        row.bankName ?? '',
        row.branchName ?? '',
        row.routingNo ?? '',
        row.paymentMode,
        row.amount,
      ]);
    });
    sheet.addRow([]);
    sheet.addRow(['', '', '', '', '', '', '', '', 'Total', total]);

    this.style(sheet, 4);
    return this.finish(workbook, `bank-advice-${month}`);
  }

  // ── internals ───────────────────────────────────────────────────────

  private style(
    sheet: ReturnType<Workbook['addWorksheet']>,
    headerRow: number,
  ): void {
    sheet.getRow(1).font = { bold: true, size: 14 };
    sheet.getRow(headerRow).font = { bold: true };
    sheet.columns.forEach((column) => {
      column.width = 20;
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

/**
 * The payslip's stored lines. A payslip that predates its breakdown (or
 * whose JSON was written by an older shape) falls back to the columns, so
 * a PDF never fails to print — the document matters more than the detail.
 */
function readLines(payslip: Payslip): BreakdownLine[] {
  const breakdown = payslip.breakdown as { lines?: BreakdownLine[] } | null;
  if (Array.isArray(breakdown?.lines) && breakdown.lines.length > 0) {
    return breakdown.lines;
  }
  const lines: BreakdownLine[] = [
    { label: 'Basic', kind: 'EARNING', amount: Number(payslip.basic) },
    {
      label: 'Allowances',
      kind: 'EARNING',
      amount: Number(payslip.totalAllowances),
    },
  ];
  if (Number(payslip.bonus) > 0) {
    lines.push({
      label: 'Bonus',
      kind: 'EARNING',
      amount: Number(payslip.bonus),
    });
  }
  if (Number(payslip.attendanceDeduction) > 0) {
    lines.push({
      label: 'Attendance deduction',
      kind: 'DEDUCTION',
      amount: Number(payslip.attendanceDeduction),
    });
  }
  if (Number(payslip.pfEmployee) > 0) {
    lines.push({
      label: 'Provident fund',
      kind: 'DEDUCTION',
      amount: Number(payslip.pfEmployee),
    });
  }
  if (Number(payslip.tax) > 0) {
    lines.push({
      label: 'Income tax',
      kind: 'DEDUCTION',
      amount: Number(payslip.tax),
    });
  }
  return lines;
}
