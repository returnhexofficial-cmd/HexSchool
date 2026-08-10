import { Injectable } from '@nestjs/common';
import { parseDate } from '../../../academic/calendar/date.util';
import { LibraryReportsService } from '../../../library/services/library-reports.service';
import type { ReportTable } from '../../calc/types';
import {
  defaultWindow,
  type ReportContext,
  type ReportExecutor,
  type ReportExecutorProvider,
} from '../executor.types';

/** M23's four report shapes. */
@Injectable()
export class LibraryReportExecutors implements ReportExecutorProvider {
  constructor(private readonly reports: LibraryReportsService) {}

  executors(): Record<string, ReportExecutor> {
    return {
      'library.overdue': (ctx) => this.overdue(ctx),
      'library.issued': (ctx) => this.issued(ctx),
      'library.popular': (ctx) => this.popular(ctx),
      'library.stock': (ctx) => this.stock(ctx),
    };
  }

  private async overdue(ctx: ReportContext): Promise<ReportTable> {
    const rows = await this.reports.overdue(ctx.schoolId);
    return {
      title: 'Overdue books',
      columns: [
        { key: 'accessionNo', label: 'Accession no' },
        { key: 'title', label: 'Title', width: 36 },
        { key: 'cardNo', label: 'Card no' },
        { key: 'memberName', label: 'Borrower', width: 26 },
        { key: 'memberContext', label: 'Class / department', width: 20 },
        { key: 'dueAt', label: 'Due', type: 'date' },
        { key: 'daysOverdue', label: 'Days late', type: 'number' },
        { key: 'outstandingFine', label: 'Fine so far', type: 'money' },
      ],
      rows: rows.map((row) => ({ ...row })),
      summary: [
        { label: 'Loans overdue', value: rows.length },
        {
          label: 'Fines outstanding',
          value:
            Math.round(
              rows.reduce((sum, row) => sum + row.outstandingFine, 0) * 100,
            ) / 100,
        },
      ],
      notes: [
        'Overdue is counted in whole elapsed days, so a same-hour return on day 8 of a 7-day loan is not late.',
      ],
    };
  }

  private async issued(ctx: ReportContext): Promise<ReportTable> {
    const rows = await this.reports.issued(ctx.schoolId);
    return {
      title: 'Books on loan',
      columns: [
        { key: 'accessionNo', label: 'Accession no' },
        { key: 'title', label: 'Title', width: 36 },
        { key: 'cardNo', label: 'Card no' },
        { key: 'memberName', label: 'Borrower', width: 26 },
        { key: 'issuedAt', label: 'Issued', type: 'date' },
        { key: 'dueAt', label: 'Due', type: 'date' },
        { key: 'renewCount', label: 'Renewals', type: 'number' },
        { key: 'overdue', label: 'Overdue' },
      ],
      rows: rows.map((row) => ({ ...row })),
      summary: [{ label: 'On loan', value: rows.length }],
    };
  }

  private async popular(ctx: ReportContext): Promise<ReportTable> {
    const window = defaultWindow(ctx.params);
    const rows = await this.reports.popular(
      ctx.schoolId,
      parseDate(window.from),
      parseDate(window.to),
    );
    return {
      title: `Popular titles — ${window.from} to ${window.to}`,
      columns: [
        { key: 'title', label: 'Title', width: 40 },
        { key: 'authors', label: 'Authors', width: 30 },
        { key: 'category', label: 'Category' },
        { key: 'issues', label: 'Times borrowed', type: 'number' },
      ],
      rows: rows.map((row) => ({
        title: row.title,
        authors: row.authors.join(', '),
        category: row.category,
        issues: row.issues,
      })),
    };
  }

  private async stock(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.reports.stock(ctx.schoolId);
    return {
      title: 'Category stock',
      columns: [
        { key: 'categoryName', label: 'Category', width: 28 },
        { key: 'titles', label: 'Titles', type: 'number' },
        { key: 'copies', label: 'Copies', type: 'number' },
        { key: 'available', label: 'Available', type: 'number' },
        { key: 'issued', label: 'On loan', type: 'number' },
        { key: 'lost', label: 'Lost', type: 'number' },
      ],
      rows: report.byCategory.map((row) => ({ ...row })),
      summary: [
        { label: 'In stock', value: report.inStock },
        { label: 'Written off', value: report.writtenOff },
      ],
      notes: [
        'LOST copies are excluded from the stock count (roadmap M23 §6).',
      ],
    };
  }
}
