import { Injectable, Logger } from '@nestjs/common';
import { parseDate } from '../../academic/calendar/date.util';
import { dhakaToday } from '../../../common/utils/clock.util';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import type { CollectPageViewDto } from '../dto';
import {
  SiteAnalyticsRepository,
  type SiteAnalyticsDay,
} from '../repositories/site-analytics.repository';
import { AnalyticsSettingsService } from './analytics-settings.service';
import { SiteAnalyticsCounterService } from './site-analytics-counter.service';

/**
 * Roadmap §3's website analytics.
 *
 * **The roadmap said "decide", and this is the decision.** Its default
 * suggestion was a page-view counter as middleware on the public API
 * routes; that is not implemented, because an API hit is not a page view.
 * A Next-rendered marketing page makes anywhere between zero and five
 * calls to `/public/*` depending on the route — the notices page fetches,
 * a static CMS page does not — so counting API hits would report the
 * notices page as five times more popular than the homepage while
 * reporting the homepage as unvisited. Every number would be wrong in a
 * way nobody could see.
 *
 * Instead the public layout fires one beacon per page view at
 * `POST /public/analytics/collect`. It is `@Public()`, throttled, and
 * carries a path and a referrer and nothing else. The trade is explicit:
 * a visitor with JavaScript disabled is not counted, which understates
 * traffic slightly, and is much better than the alternative of counting
 * confidently and wrongly.
 */
@Injectable()
export class SiteAnalyticsService {
  private readonly logger = new Logger(SiteAnalyticsService.name);

  constructor(
    private readonly counter: SiteAnalyticsCounterService,
    private readonly repo: SiteAnalyticsRepository,
    private readonly schools: SchoolsRepository,
    private readonly config: AnalyticsSettingsService,
  ) {}

  /**
   * Records one page view. Never throws — a counter that can break the
   * public site is worse than no counter.
   */
  async collect(
    schoolId: string,
    dto: CollectPageViewDto,
    request: { ip: string; userAgent: string },
  ): Promise<{ recorded: boolean }> {
    try {
      const cfg = await this.config.load(schoolId);
      if (!cfg.enabled || !cfg.websiteTrackingEnabled) {
        return { recorded: false };
      }
      await this.counter.record({
        schoolId,
        path: dto.path,
        referrer: dto.referrer,
        fingerprint: this.counter.fingerprint(
          request.ip,
          request.userAgent,
          cfg.websiteVisitorSalt,
        ),
      });
      return { recorded: true };
    } catch (error) {
      this.logger.warn(
        `page view not recorded: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return { recorded: false };
    }
  }

  /**
   * Folds the Redis counters into `site_analytics_daily`.
   *
   * Runs for **today and yesterday**, not only today. A fold at 00:05 that
   * looked at today alone would lose everything after the previous fold on
   * the day before, every single night — and the loss would be invisible,
   * because the row for yesterday would exist and simply be short.
   */
  async fold(now = new Date()): Promise<{ schools: number; days: number }> {
    const schools = await this.schools.findAll();
    const today = dhakaToday(now);
    const yesterday = dhakaToday(new Date(now.getTime() - 86_400_000));
    const dates = today === yesterday ? [today] : [yesterday, today];

    let days = 0;
    for (const school of schools) {
      const cfg = await this.config.load(school.id);
      if (!cfg.enabled || !cfg.websiteTrackingEnabled) continue;

      for (const date of dates) {
        const drained = await this.counter.drain(school.id, date);
        if (!drained) continue;
        await this.repo.accumulate({
          schoolId: school.id,
          date: parseDate(date),
          pageViews: drained.pageViews,
          uniqueVisitors: drained.uniqueVisitors,
          topPages: drained.topPages.slice(0, cfg.websiteTopN),
          topReferrers: drained.topReferrers.slice(0, cfg.websiteTopN),
        });
        days += 1;
      }
    }
    return { schools: schools.length, days };
  }

  /** Roadmap §4's `GET /analytics/website`. */
  async report(
    schoolId: string,
    window: { from?: string; to?: string; days?: number },
  ): Promise<{
    from: string;
    to: string;
    days: SiteAnalyticsDay[];
    totals: { pageViews: number; peakDay: string | null };
    today: { pageViews: number; uniqueVisitors: number } | null;
    topPages: Array<{ path: string; views: number }>;
  }> {
    const to = window.to ?? dhakaToday();
    const from =
      window.from ??
      new Date(parseDate(to).getTime() - (window.days ?? 30) * 86_400_000)
        .toISOString()
        .slice(0, 10);

    const days = await this.repo.range(
      schoolId,
      parseDate(from),
      parseDate(to),
    );
    const pageViews = days.reduce((sum, day) => sum + day.pageViews, 0);
    const peak = days.reduce<SiteAnalyticsDay | null>(
      (best, day) =>
        best === null || day.pageViews > best.pageViews ? day : best,
      null,
    );

    // Top pages across the window: the per-day lists are already truncated
    // to the top N, so this is "most popular among the pages each day
    // noticed" rather than a true window ranking. Stated rather than
    // implied — a page that was 21st every day is genuinely absent here.
    const merged = new Map<string, number>();
    for (const day of days) {
      for (const page of day.topPages) {
        merged.set(page.path, (merged.get(page.path) ?? 0) + page.views);
      }
    }

    return {
      from,
      to,
      days,
      totals: { pageViews, peakDay: peak?.date ?? null },
      today: await this.counter.peek(schoolId),
      topPages: [...merged.entries()]
        .map(([path, views]) => ({ path, views }))
        .sort((a, b) => b.views - a.views)
        .slice(0, 20),
    };
  }
}
