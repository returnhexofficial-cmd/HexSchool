import { Injectable } from '@nestjs/common';
import { PayrollReportsService } from '../../../hr/services/payroll-reports.service';
import type { ReportTable } from '../../calc/types';
import {
  defaultMonthWindow,
  type ReportContext,
  type ReportExecutor,
  type ReportExecutorProvider,
} from '../executor.types';

/**
 * M21's payroll reports — **the module that makes roadmap §6's column
 * stripping worth having.**
 *
 * Salary is the roadmap's own example of a sensitive column, and it is
 * the realistic one: a payroll register is routinely wanted by people who
 * should not see individual pay. The head wants the headcount and the
 * total cost; an audit wants the tax column; the office assistant
 * preparing an attendance reconciliation wants days present and nothing
 * else. So every money column here declares `payroll.view`, and a
 * requester without it gets the same report with the money gone and a
 * note saying so — rather than a 403 that tells them to go and ask
 * somebody, which is how a school ends up emailing spreadsheets around
 * instead.
 */
@Injectable()
export class PayrollReportExecutors implements ReportExecutorProvider {
  constructor(private readonly reports: PayrollReportsService) {}

  executors(): Record<string, ReportExecutor> {
    return {
      'payroll.register': (ctx) => this.register(ctx),
      'payroll.pf': (ctx) => this.pf(ctx),
      'payroll.tax': (ctx) => this.tax(ctx),
      'payroll.grades': (ctx) => this.grades(ctx),
    };
  }

  private async register(ctx: ReportContext): Promise<ReportTable> {
    // Months, not dates — M21's window is a payroll-run month (see
    // `defaultMonthWindow`).
    const window = defaultMonthWindow(ctx.params);
    const report = await this.reports.register(window, ctx.schoolId);

    return {
      title: `Payroll register — ${report.from} to ${report.to}`,
      subtitle: report.runs
        .map((run) => `${run.month} (${run.status})`)
        .join(', '),
      columns: [
        { key: 'employeeId', label: 'Employee ID' },
        { key: 'name', label: 'Name', width: 28 },
        { key: 'designation', label: 'Designation', width: 20 },
        { key: 'workingDays', label: 'Working days', type: 'number' },
        { key: 'daysPresent', label: 'Present', type: 'number' },
        { key: 'daysAbsent', label: 'Absent', type: 'number' },
        {
          key: 'basic',
          label: 'Basic',
          type: 'money',
          permission: 'payroll.view',
        },
        {
          key: 'allowances',
          label: 'Allowances',
          type: 'money',
          permission: 'payroll.view',
        },
        {
          key: 'gross',
          label: 'Gross',
          type: 'money',
          permission: 'payroll.view',
        },
        {
          key: 'attendanceDeduction',
          label: 'Attendance deduction',
          type: 'money',
          permission: 'payroll.view',
        },
        {
          key: 'otherDeductions',
          label: 'Other deductions',
          type: 'money',
          permission: 'payroll.view',
        },
        {
          key: 'pfEmployee',
          label: 'PF',
          type: 'money',
          permission: 'payroll.view',
        },
        { key: 'tax', label: 'Tax', type: 'money', permission: 'payroll.view' },
        {
          key: 'bonus',
          label: 'Bonus',
          type: 'money',
          permission: 'payroll.view',
        },
        {
          key: 'netPayable',
          label: 'Net payable',
          type: 'money',
          permission: 'payroll.view',
        },
        { key: 'status', label: 'Status' },
      ],
      rows: report.rows.map((row) => ({ ...row })),
      summary: ctx.held.has('payroll.view')
        ? [
            { label: 'Employees', value: report.rows.length },
            { label: 'Gross', value: report.totals.gross },
            { label: 'Net payable', value: report.totals.netPayable },
          ]
        : [{ label: 'Employees', value: report.rows.length }],
      notes: [
        'The attendance deduction is a per-day rate over the full monthly figure, not over the prorated one.',
      ],
    };
  }

  private async pf(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.reports.pfReport(ctx.schoolId);
    return {
      title: 'Provident fund',
      columns: [
        { key: 'employeeId', label: 'Employee ID' },
        { key: 'name', label: 'Name', width: 28 },
        {
          key: 'employeeTotal',
          label: 'Employee contribution',
          type: 'money',
          permission: 'payroll.view',
        },
        {
          key: 'employerTotal',
          label: 'Employer contribution',
          type: 'money',
          permission: 'payroll.view',
        },
        {
          key: 'withdrawn',
          label: 'Withdrawn',
          type: 'money',
          permission: 'payroll.view',
        },
        {
          key: 'balance',
          label: 'Balance',
          type: 'money',
          permission: 'payroll.view',
        },
      ],
      rows: report.rows.map((row) => ({ ...row })),
      summary: ctx.held.has('payroll.view')
        ? [{ label: 'Fund balance', value: report.totals.balance }]
        : [{ label: 'Members', value: report.rows.length }],
    };
  }

  private async tax(ctx: ReportContext): Promise<ReportTable> {
    const window = defaultMonthWindow(ctx.params);
    const report = await this.reports.taxReport(window, ctx.schoolId);
    return {
      title: `Tax deducted at source — ${report.window.from} to ${report.window.to}`,
      columns: [
        { key: 'employeeId', label: 'Employee ID' },
        { key: 'name', label: 'Name', width: 28 },
        { key: 'months', label: 'Months', type: 'number' },
        {
          key: 'taxableGross',
          label: 'Taxable gross',
          type: 'money',
          permission: 'payroll.view',
        },
        {
          key: 'taxDeducted',
          label: 'Tax deducted',
          type: 'money',
          permission: 'payroll.view',
        },
      ],
      rows: report.rows.map((row) => ({ ...row })),
      summary: ctx.held.has('payroll.view')
        ? [{ label: 'Total deducted', value: report.total }]
        : [],
      notes: [
        'Disbursed runs only. Income tax annualizes the current month rather than tracking year-to-date, so a mid-year increment reads slightly out either side of it.',
      ],
    };
  }

  private async grades(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.reports.gradeDistribution(ctx.schoolId);
    return {
      title: 'Salary-grade distribution',
      columns: [
        { key: 'structureName', label: 'Structure', width: 28 },
        { key: 'grade', label: 'Grade' },
        { key: 'headcount', label: 'Headcount', type: 'number' },
        {
          key: 'basic',
          label: 'Basic',
          type: 'money',
          permission: 'payroll.view',
        },
        {
          key: 'gross',
          label: 'Monthly gross',
          type: 'money',
          permission: 'payroll.view',
        },
      ],
      rows: report.rows.map((row) => ({ ...row })),
      summary: ctx.held.has('payroll.view')
        ? [
            { label: 'Headcount', value: report.headcount },
            { label: 'Monthly cost', value: report.monthlyCost },
          ]
        : [{ label: 'Headcount', value: report.headcount }],
      notes: ['Read from the live salary assignments, not from a payroll run.'],
    };
  }
}
