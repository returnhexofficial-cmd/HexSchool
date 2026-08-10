import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';

export interface TopPage {
  path: string;
  views: number;
}

export interface SiteAnalyticsDay {
  date: string;
  pageViews: number;
  uniqueVisitors: number;
  topPages: TopPage[];
  topReferrers: Array<{ referrer: string; views: number }>;
}

/**
 * `site_analytics_daily` — one row per school per day (roadmap §3).
 *
 * The write path is an **upsert that adds**, not one that replaces. The
 * fold job runs several times a day against a day that is still
 * accumulating, and a replacing upsert would make each fold overwrite the
 * last with a partial count. Adding lets the counters be drained: the
 * Redis side is reset by the same job, so what is written here is always
 * "the traffic since the previous fold", and the row is the running total.
 */
@Injectable()
export class SiteAnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async accumulate(input: {
    schoolId: string;
    date: Date;
    pageViews: number;
    uniqueVisitors: number;
    topPages: TopPage[];
    topReferrers: Array<{ referrer: string; views: number }>;
  }): Promise<void> {
    // `unique_visitors` is NOT summed. It is a HyperLogLog cardinality for
    // the whole day, recomputed each fold from a key that is not reset —
    // adding two partial cardinalities would double-count every visitor
    // who came back after lunch. The CHECK constraint
    // (unique_visitors <= page_views) is what would catch this if it were
    // ever changed to a sum.
    await this.prisma.siteAnalyticsDaily.upsert({
      where: {
        schoolId_date: { schoolId: input.schoolId, date: input.date },
      },
      create: {
        schoolId: input.schoolId,
        date: input.date,
        pageViews: input.pageViews,
        uniqueVisitors: Math.min(input.uniqueVisitors, input.pageViews),
        topPages: input.topPages as unknown as Prisma.InputJsonValue,
        topReferrers: input.topReferrers,
      },
      update: {
        pageViews: { increment: input.pageViews },
        uniqueVisitors: input.uniqueVisitors,
        topPages: input.topPages as unknown as Prisma.InputJsonValue,
        topReferrers: input.topReferrers,
      },
    });
  }

  async range(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<SiteAnalyticsDay[]> {
    const rows = await this.prisma.siteAnalyticsDaily.findMany({
      where: { schoolId, date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });
    return rows.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      pageViews: row.pageViews,
      uniqueVisitors: row.uniqueVisitors,
      topPages: (row.topPages as TopPage[] | null) ?? [],
      topReferrers:
        (row.topReferrers as Array<{
          referrer: string;
          views: number;
        }> | null) ?? [],
    }));
  }

  /** The current day's row, if the fold has already written one. */
  async forDate(
    schoolId: string,
    date: Date,
  ): Promise<SiteAnalyticsDay | null> {
    const row = await this.prisma.siteAnalyticsDaily.findUnique({
      where: { schoolId_date: { schoolId, date } },
    });
    if (!row) return null;
    return {
      date: row.date.toISOString().slice(0, 10),
      pageViews: row.pageViews,
      uniqueVisitors: row.uniqueVisitors,
      topPages: (row.topPages as TopPage[] | null) ?? [],
      topReferrers:
        (row.topReferrers as Array<{
          referrer: string;
          views: number;
        }> | null) ?? [],
    };
  }
}
