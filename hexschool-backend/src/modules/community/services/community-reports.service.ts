import { Injectable } from '@nestjs/common';
import { dhakaToday } from '../../../common/utils/clock.util';
import {
  byMethod,
  byMonth,
  byPurpose,
  donationTotals,
  topDonors,
  type DonationRecord,
  type GroupedTotal,
  type TopDonor,
} from '../calc/donation.engine';
import { resolutionStats, type ResolutionStats } from '../calc/sla.engine';
import { dayStats, type VisitorDayStats } from '../calc/visitor.engine';
import type {
  TicketCategoryCode,
  TicketPriorityCode,
  TicketStatusCode,
  VisitorPurposeCode,
} from '../calc/types';
import type { ReportWindowDto } from '../dto';
import {
  AlumniRepository,
  DonationsRepository,
} from '../repositories/alumni.repository';
import { TicketsRepository } from '../repositories/tickets.repository';
import { VisitorsRepository } from '../repositories/visitors.repository';
import { CommunitySettingsService } from './community-settings.service';

export interface TicketSummaryReport {
  from: string;
  to: string;
  total: number;
  byStatus: Array<{ status: TicketStatusCode; count: number }>;
  byCategory: Array<{ category: TicketCategoryCode; count: number }>;
  byPriority: Array<{ priority: TicketPriorityCode; count: number }>;
  resolution: ResolutionStats;
  /** Live tickets past their SLA right now — the backlog, kept separate. */
  breachedNow: number;
  satisfaction: { rated: number; average: number };
  /** True when the caller could not see restricted complaints. */
  excludesSensitive: boolean;
}

export interface DonationSummaryReport {
  from: string;
  to: string;
  totals: ReturnType<typeof donationTotals>;
  byPurpose: GroupedTotal[];
  byMethod: GroupedTotal[];
  byMonth: GroupedTotal[];
  topDonors: TopDonor[];
}

export interface VisitorRegisterReport {
  from: string;
  to: string;
  stats: VisitorDayStats;
  rows: Array<{
    name: string;
    phone: string;
    purpose: VisitorPurposeCode;
    whomToMeet: string | null;
    gatePassNo: string | null;
    checkIn: Date;
    checkOut: Date | null;
    autoCheckedOut: boolean;
    minutes: number;
  }>;
}

/**
 * Roadmap §4's three report families. The numbers come from the pure
 * engines, so the screen, the sheet and the PDF are the same arithmetic —
 * the M12 reports/export split.
 *
 * **The ticket summary carries `excludesSensitive`.** A caller without
 * `ticket.sensitive.view` gets a report over the complaints they may
 * read, which is correct — and it says so on its face, because a "42
 * complaints this term" figure that quietly omits the ones about staff is
 * the kind of number that ends up in a governors' pack meaning something
 * other than what it says. This is the M27 lesson (a clearance source
 * that failed being indistinguishable from one that said "nothing owed")
 * applied to a report: **the shape has to say what it could not see.**
 */
@Injectable()
export class CommunityReportsService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly visitors: VisitorsRepository,
    private readonly donations: DonationsRepository,
    private readonly alumni: AlumniRepository,
    private readonly config: CommunitySettingsService,
  ) {}

  async ticketSummary(
    query: ReportWindowDto,
    schoolId: string,
    includeSensitive: boolean,
  ): Promise<TicketSummaryReport> {
    const { from, to } = this.window(query);
    const cfg = await this.config.load(schoolId);

    const rows = await this.tickets.findAllFor(schoolId, {
      from,
      to,
      includeSensitive,
    });

    const count = <K extends string>(
      key: (row: (typeof rows)[number]) => K,
    ): Array<Record<string, unknown>> => {
      const buckets = new Map<K, number>();
      for (const row of rows) {
        buckets.set(key(row), (buckets.get(key(row)) ?? 0) + 1);
      }
      return [...buckets.entries()].map(([value, n]) => ({ value, count: n }));
    };

    const rated = rows.filter((row) => row.satisfactionRating !== null);
    const now = new Date();
    const slaViews = rows.map((row) => ({
      id: row.id,
      status: row.status,
      priority: row.priority,
      createdAt: row.createdAt,
      reopenedAt: row.reopenedAt,
      firstResponseAt: row.firstResponseAt,
      resolvedAt: row.resolvedAt,
      escalatedAt: row.escalatedAt,
    }));

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      total: rows.length,
      byStatus: count((row) => row.status).map((b) => ({
        status: b.value as TicketStatusCode,
        count: b.count as number,
      })),
      byCategory: count((row) => row.category).map((b) => ({
        category: b.value as TicketCategoryCode,
        count: b.count as number,
      })),
      byPriority: count((row) => row.priority).map((b) => ({
        priority: b.value as TicketPriorityCode,
        count: b.count as number,
      })),
      resolution: resolutionStats(slaViews, cfg.ticketSlaHours),
      breachedNow: slaViews.filter((view) => {
        const started =
          view.status === 'REOPENED' && view.reopenedAt
            ? view.reopenedAt
            : view.createdAt;
        const hours = cfg.ticketSlaHours[view.priority];
        return (
          ['OPEN', 'IN_PROGRESS', 'REOPENED'].includes(view.status) &&
          now.getTime() - started.getTime() > hours * 60 * 60 * 1000
        );
      }).length,
      satisfaction: {
        rated: rated.length,
        average:
          rated.length === 0
            ? 0
            : Math.round(
                (rated.reduce(
                  (sum, row) => sum + (row.satisfactionRating ?? 0),
                  0,
                ) /
                  rated.length) *
                  100,
              ) / 100,
      },
      excludesSensitive: !includeSensitive,
    };
  }

  async ticketRegister(
    query: ReportWindowDto,
    schoolId: string,
    includeSensitive: boolean,
  ) {
    const { from, to } = this.window(query);
    const rows = await this.tickets.findAllFor(schoolId, {
      from,
      to,
      includeSensitive,
    });
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      excludesSensitive: !includeSensitive,
      rows,
    };
  }

  async visitorRegister(
    query: ReportWindowDto,
    schoolId: string,
  ): Promise<VisitorRegisterReport> {
    const { from, to } = this.window(query);
    const rows = await this.visitors.findAllFor(schoolId, { from, to });
    const now = new Date();

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      stats: dayStats(
        rows.map((row) => ({
          id: row.id,
          checkIn: row.checkIn,
          checkOut: row.checkOut,
          validUntil: row.validUntil,
          purpose: row.purpose,
          autoCheckedOut: row.autoCheckedOut,
        })),
        now,
      ),
      rows: rows.map((row) => ({
        name: row.name,
        phone: row.phone,
        purpose: row.purpose,
        whomToMeet: row.whomToMeet,
        gatePassNo: row.gatePassNo,
        checkIn: row.checkIn,
        checkOut: row.checkOut,
        autoCheckedOut: row.autoCheckedOut,
        minutes: Math.max(
          0,
          Math.round(
            ((row.checkOut ?? now).getTime() - row.checkIn.getTime()) / 60_000,
          ),
        ),
      })),
    };
  }

  async donationSummary(
    query: ReportWindowDto,
    schoolId: string,
  ): Promise<DonationSummaryReport> {
    const { from, to } = this.window(query);
    const rows = await this.donations.findAllFor(schoolId, { from, to });
    const records: DonationRecord[] = rows.map((row) => ({
      id: row.id,
      amount: Number(row.amount),
      purpose: row.purpose,
      method: row.method,
      receivedAt: row.receivedAt,
      donorName: row.donorName,
      alumniId: row.alumniId,
      cancelledAt: row.cancelledAt,
    }));

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      totals: donationTotals(records),
      byPurpose: byPurpose(records),
      byMethod: byMethod(records),
      byMonth: byMonth(records),
      topDonors: topDonors(records),
    };
  }

  async donationRegister(query: ReportWindowDto, schoolId: string) {
    const { from, to } = this.window(query);
    const rows = await this.donations.findAllFor(schoolId, { from, to });
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      rows,
    };
  }

  async alumniDirectory(schoolId: string) {
    const rows = await this.alumni.findAllFor(schoolId, {
      status: 'APPROVED',
    });
    const batches = await this.alumni.batchYears(schoolId, false);
    return { total: rows.length, batches, rows };
  }

  /**
   * Defaults to the current month, in **Dhaka**. The M25 lesson: building
   * a window from UTC while the server dates everything through
   * `dhakaToday()` puts the boundary six hours out, and a report run at
   * 19:00 disagrees with the same report run at 14:00.
   */
  private window(query: ReportWindowDto): { from: Date; to: Date } {
    const today = dhakaToday();
    const from = query.from
      ? new Date(`${query.from.slice(0, 10)}T00:00:00.000Z`)
      : new Date(`${today.slice(0, 8)}01T00:00:00.000Z`);
    const to = query.to
      ? new Date(`${query.to.slice(0, 10)}T23:59:59.999Z`)
      : new Date(`${today}T23:59:59.999Z`);
    return { from, to };
  }
}
