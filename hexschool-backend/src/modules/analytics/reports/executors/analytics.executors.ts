import { Injectable } from '@nestjs/common';
import { parseDate } from '../../../academic/calendar/date.util';
import { SessionsService } from '../../../academic/services/sessions.service';
import {
  buildHeatmap,
  monthKeysEndingAt,
  percent,
  yearOverYear,
} from '../../calc/analytics.engine';
import type { ReportRow, ReportTable } from '../../calc/types';
import { AnalyticsRepository } from '../../repositories/analytics.repository';
import { SiteAnalyticsRepository } from '../../repositories/site-analytics.repository';
import {
  defaultWindow,
  str,
  type ReportContext,
  type ReportExecutor,
  type ReportExecutorProvider,
} from '../executor.types';

/**
 * M29's own reports — the three that have no source module because they
 * are cross-module by construction: the year-on-year enrollment trend,
 * the section × month attendance heatmap, and website traffic.
 */
@Injectable()
export class AnalyticsReportExecutors implements ReportExecutorProvider {
  constructor(
    private readonly analytics: AnalyticsRepository,
    private readonly site: SiteAnalyticsRepository,
    private readonly sessions: SessionsService,
  ) {}

  executors(): Record<string, ReportExecutor> {
    return {
      'analytics.enrollment-trend': (ctx) => this.enrollmentTrend(ctx),
      'analytics.attendance-heatmap': (ctx) => this.attendanceHeatmap(ctx),
      'analytics.website': (ctx) => this.website(ctx),
    };
  }

  private async enrollmentTrend(ctx: ReportContext): Promise<ReportTable> {
    const now = new Date();
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const from = new Date(
      Date.UTC(to.getUTCFullYear() - 2, to.getUTCMonth(), 1),
    );

    const series = await this.analytics.enrollmentByMonth(
      ctx.schoolId,
      from,
      to,
    );
    const currentKeys = monthKeysEndingAt(to, 12);
    const priorKeys = monthKeysEndingAt(
      new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth(), 1)),
      12,
    );
    const byKey = new Map(series.map((p) => [p.month, p.count]));

    const rows: ReportRow[] = yearOverYear(
      currentKeys.map((key) => ({ key, value: byKey.get(key) ?? 0 })),
      priorKeys.map((key) => ({ key, value: byKey.get(key) ?? 0 })),
    ).map((point) => ({
      month: point.key,
      current: point.current,
      previous: point.previous,
      changePct: point.changePct,
    }));

    return {
      title: 'Enrollment trend (year on year)',
      columns: [
        { key: 'month', label: 'Month' },
        { key: 'current', label: 'On the roll', type: 'number' },
        { key: 'previous', label: 'A year earlier', type: 'number' },
        { key: 'changePct', label: 'Change', type: 'percent' },
      ],
      rows,
      notes: [
        'Counted from the enrollment date to the session end, not from the current status — everybody promoted last year is PROMOTED today, and a status filter would report last year’s roll as empty.',
        'A month whose baseline was zero shows no percentage rather than infinite growth.',
      ],
    };
  }

  private async attendanceHeatmap(ctx: ReportContext): Promise<ReportTable> {
    const sessionId =
      str(ctx.params, 'sessionId') ??
      (await this.sessions.getCurrent(ctx.schoolId))?.id;

    const [rows, labels] = await Promise.all([
      this.analytics.attendanceMonthly(ctx.schoolId, sessionId),
      this.analytics.sectionLabels(ctx.schoolId, sessionId),
    ]);

    const months = [...new Set(rows.map((row) => row.month))].sort();
    const sectionIds = [...new Set(rows.map((row) => row.sectionId))];
    const rowLabels = sectionIds
      .map((id) => labels.get(id) ?? id)
      .sort((a, b) => a.localeCompare(b));

    const points = rows.map((row) => ({
      row: labels.get(row.sectionId) ?? row.sectionId,
      column: row.month,
      // The M12 percentage, recomputed from the view's counts so the
      // heatmap and the register cannot disagree: present + late + half a
      // half-day, over the rows actually marked.
      value:
        percent(row.present + row.late + row.halfDay * 0.5, row.marked) ?? 0,
    }));

    const map = buildHeatmap(points, rowLabels, months);
    const table: ReportRow[] = map.rows.map((label) => {
      const cells: ReportRow = { section: label };
      for (const month of map.columns) {
        cells[month] =
          map.cells.find((c) => c.row === label && c.column === month)?.value ??
          null;
      }
      return cells;
    });

    return {
      title: 'Attendance heatmap (section × month)',
      columns: [
        { key: 'section', label: 'Section', width: 22 },
        ...map.columns.map((month) => ({
          key: month,
          label: month,
          type: 'percent' as const,
          width: 10,
        })),
      ],
      rows: table,
      summary: [
        { label: 'Lowest', value: map.min === null ? '—' : `${map.min}%` },
        { label: 'Highest', value: map.max === null ? '—' : `${map.max}%` },
      ],
      notes: [
        'A blank cell is a month with no register at all, which is not the same fact as 0 % attendance — the two are deliberately not painted the same.',
        'Served from mv_attendance_monthly, refreshed nightly: up to 24 hours stale.',
      ],
    };
  }

  private async website(ctx: ReportContext): Promise<ReportTable> {
    const window = defaultWindow(ctx.params);
    const rows = await this.site.range(
      ctx.schoolId,
      parseDate(window.from),
      parseDate(window.to),
    );

    return {
      title: `Website traffic — ${window.from} to ${window.to}`,
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'pageViews', label: 'Page views', type: 'number' },
        { key: 'uniqueVisitors', label: 'Unique visitors', type: 'number' },
        { key: 'topPage', label: 'Busiest page', width: 34 },
      ],
      rows: rows.map((row) => ({
        date: row.date,
        pageViews: row.pageViews,
        uniqueVisitors: row.uniqueVisitors,
        topPage: row.topPages[0]?.path ?? '—',
      })),
      summary: [
        {
          label: 'Page views',
          value: rows.reduce((sum, row) => sum + row.pageViews, 0),
        },
        {
          label: 'Busiest day',
          value:
            rows.length === 0
              ? '—'
              : rows.reduce((best, row) =>
                  row.pageViews > best.pageViews ? row : best,
                ).date,
        },
      ],
      notes: [
        'Unique visitors are counted in a HyperLogLog over a salted hash of IP and user agent, which no visitor can be read back out of — so the daily figures cannot be summed into a unique total for the window.',
      ],
    };
  }
}
