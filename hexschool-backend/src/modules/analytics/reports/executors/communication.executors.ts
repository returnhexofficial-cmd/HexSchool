import { Injectable } from '@nestjs/common';
import { parseDate } from '../../../academic/calendar/date.util';
import type { ReportTable } from '../../calc/types';
import { AnalyticsRepository } from '../../repositories/analytics.repository';
import {
  defaultWindow,
  type ReportContext,
  type ReportExecutor,
  type ReportExecutorProvider,
} from '../executor.types';

/**
 * M17's delivery log.
 *
 * Read through `AnalyticsRepository` rather than through a communication
 * service, because `NotificationLogService` is not exported from
 * `CommunicationModule` — and widening M17's public surface for one
 * read-only list is the wrong trade. The narrow-repository precedent
 * exists precisely for this (M12/M17/M18/M19/M22/M23/M24/M28), and the
 * SELECT list stays small: the log says what was sent, where, and whether
 * it arrived. It does **not** carry `body_rendered`, so an export of the
 * SMS log is not an export of what every parent was told.
 */
@Injectable()
export class CommunicationReportExecutors implements ReportExecutorProvider {
  constructor(private readonly analytics: AnalyticsRepository) {}

  executors(): Record<string, ReportExecutor> {
    return {
      'communication.log': (ctx) => this.log(ctx),
    };
  }

  private async log(ctx: ReportContext): Promise<ReportTable> {
    const window = defaultWindow(ctx.params);
    const from = parseDate(window.from);
    const to = new Date(parseDate(window.to).getTime() + 86_399_999);
    const [rows, spend] = await Promise.all([
      this.analytics.deliveryLog(ctx.schoolId, from, to),
      this.analytics.messageSpend(ctx.schoolId, from, to),
    ]);

    return {
      title: `Delivery log — ${window.from} to ${window.to}`,
      columns: [
        { key: 'createdAt', label: 'Queued' },
        { key: 'channel', label: 'Channel' },
        { key: 'templateCode', label: 'Template' },
        { key: 'destination', label: 'Destination', width: 24 },
        { key: 'subject', label: 'Subject', width: 30 },
        { key: 'status', label: 'Status' },
        { key: 'sentAt', label: 'Sent' },
        { key: 'segments', label: 'Parts', type: 'number' },
        { key: 'cost', label: 'Cost', type: 'money' },
        { key: 'error', label: 'Error', width: 34 },
      ],
      rows: rows.map((row) => ({ ...row })),
      summary: spend.map((row) => ({
        label: `${row.channel} ${row.status}`,
        value: row.messages,
      })),
      notes: [
        'The message body is deliberately not a column — an export of the log is not an export of what every family was told.',
        `Total spend in the window: ${
          Math.round(spend.reduce((sum, row) => sum + row.cost, 0) * 10000) /
          10000
        }`,
      ],
    };
  }
}
