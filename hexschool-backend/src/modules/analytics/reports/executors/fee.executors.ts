import { Injectable } from '@nestjs/common';
import { FeeReportsService } from '../../../fee/services/fee-reports.service';
import type { ReportTable } from '../../calc/types';
import {
  defaultWindow,
  str,
  type ReportContext,
  type ReportExecutor,
  type ReportExecutorProvider,
} from '../executor.types';

/**
 * M16's money reports.
 *
 * The one thing carried through from `FeeReportsService` that is easy to
 * lose in a flattening: **collection is counted from payments and dues
 * from invoices**, on different dates. Every executor here keeps the two
 * questions in separate reports rather than trying to put both on one
 * sheet, because the sheet that mixes them is the sheet whose columns
 * stop adding up.
 */
@Injectable()
export class FeeReportExecutors implements ReportExecutorProvider {
  constructor(private readonly reports: FeeReportsService) {}

  executors(): Record<string, ReportExecutor> {
    return {
      'fee.dues': (ctx) => this.dues(ctx),
      'fee.defaulters': (ctx) => this.defaulters(ctx),
      'fee.daily': (ctx) => this.daily(ctx),
      'fee.head-wise': (ctx) => this.headWise(ctx),
      'fee.monthly': (ctx) => this.monthly(ctx),
    };
  }

  private query(ctx: ReportContext) {
    return {
      sessionId: str(ctx.params, 'sessionId'),
      classId: str(ctx.params, 'classId'),
      from: str(ctx.params, 'from'),
      to: str(ctx.params, 'to'),
    };
  }

  private async dues(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.reports.dues(this.query(ctx), ctx.schoolId);
    return {
      title: 'Dues by class',
      columns: [
        { key: 'className', label: 'Class', width: 22 },
        { key: 'students', label: 'Students owing', type: 'number' },
        { key: 'outstanding', label: 'Outstanding', type: 'money' },
      ],
      rows: report.byClass.map((row) => ({
        className: row.className,
        students: row.students,
        outstanding: row.outstanding,
      })),
      summary: [
        { label: 'Total outstanding', value: report.totalOutstanding },
        ...report.buckets.map((bucket) => ({
          label: bucket.bucket,
          value: bucket.amount,
        })),
      ],
      notes: [
        'Dues are read from invoices; money received is a separate report (Daily collection) because the two are counted on different dates.',
      ],
    };
  }

  private async defaulters(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.reports.dues(this.query(ctx), ctx.schoolId);
    return {
      title: 'Defaulters',
      columns: [
        { key: 'studentUid', label: 'Student ID' },
        { key: 'studentName', label: 'Name', width: 28 },
        { key: 'className', label: 'Class' },
        { key: 'sectionName', label: 'Section' },
        { key: 'rollNo', label: 'Roll', type: 'number' },
        { key: 'outstanding', label: 'Outstanding', type: 'money' },
        { key: 'oldestDueDate', label: 'Oldest due', type: 'date' },
        { key: 'bucket', label: 'Age' },
      ],
      rows: report.defaulters.map((row) => ({ ...row })),
      summary: [
        { label: 'Defaulters', value: report.defaulters.length },
        { label: 'Total outstanding', value: report.totalOutstanding },
      ],
    };
  }

  private async daily(ctx: ReportContext): Promise<ReportTable> {
    const window = defaultWindow(ctx.params);
    const report = await this.reports.collection(
      { from: window.from, to: window.to },
      ctx.schoolId,
    );
    return {
      title: `Collection — ${report.from} to ${report.to}`,
      columns: [
        { key: 'paidAt', label: 'Paid at' },
        { key: 'paymentNo', label: 'Receipt no' },
        { key: 'studentUid', label: 'Student ID' },
        { key: 'studentName', label: 'Student', width: 28 },
        { key: 'className', label: 'Class' },
        { key: 'invoiceNo', label: 'Invoice' },
        { key: 'method', label: 'Method' },
        { key: 'amount', label: 'Amount', type: 'money' },
      ],
      rows: report.rows.map((row) => ({ ...row })),
      summary: [
        { label: 'Receipts', value: report.rows.length },
        { label: 'Total', value: report.total },
        ...report.byMethod.map((m) => ({
          label: m.method,
          value: m.amount,
        })),
      ],
      notes: ['Only SUCCESS payments are counted.'],
    };
  }

  private async headWise(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.reports.headWise(this.query(ctx), ctx.schoolId);
    return {
      title: 'Head-wise income',
      columns: [
        { key: 'feeHeadName', label: 'Fee head', width: 28 },
        { key: 'billed', label: 'Billed', type: 'money' },
        { key: 'discounted', label: 'Discounted', type: 'money' },
        { key: 'net', label: 'Net', type: 'money' },
      ],
      rows: report.rows.map((row) => ({
        feeHeadName: row.feeHeadName,
        billed: row.billed,
        discounted: row.discounted,
        net: row.net,
      })),
      summary: [
        { label: 'Billed', value: report.totalBilled },
        { label: 'Discounted', value: report.totalDiscounted },
        { label: 'Net', value: report.totalNet },
      ],
    };
  }

  private async monthly(ctx: ReportContext): Promise<ReportTable> {
    const rows = await this.reports.monthly(this.query(ctx), ctx.schoolId);
    return {
      title: 'Billed against collected, by month',
      columns: [
        { key: 'month', label: 'Month' },
        { key: 'billed', label: 'Billed', type: 'money' },
        { key: 'collected', label: 'Collected', type: 'money' },
        { key: 'realization', label: 'Realization', type: 'percent' },
      ],
      rows: rows.map((row) => ({
        month: row.month,
        billed: row.billed,
        collected: row.collected,
        realization:
          row.billed === 0
            ? null
            : Math.round((row.collected / row.billed) * 10000) / 100,
      })),
      notes: [
        'Realization can exceed 100 % in a month that settled an earlier term’s arrears — it is not clamped, because that recovery is exactly what the figure is for.',
      ],
    };
  }
}
