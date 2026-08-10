import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { dhakaMinutesOfDay } from '../../../common/utils/clock.util';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { AnalyticsSettingsService } from '../services/analytics-settings.service';
import { MaterializedViewService } from '../services/materialized-view.service';
import { ReportRunsService } from '../services/report-runs.service';
import { ReportSchedulesService } from '../services/report-schedules.service';
import { SiteAnalyticsService } from '../services/site-analytics.service';

/**
 * M29's four cron jobs.
 *
 * They follow the M12/M23/M24/M25/M28 convention: **the cron expression is
 * coarse and the per-school settings decide.** One expression cannot be
 * per-school, so the sweep runs on a fixed schedule and each school's
 * configuration is consulted inside it.
 */
@Injectable()
export class AnalyticsJobs {
  private readonly logger = new Logger(AnalyticsJobs.name);

  constructor(
    private readonly schedules: ReportSchedulesService,
    private readonly runs: ReportRunsService,
    private readonly views: MaterializedViewService,
    private readonly site: SiteAnalyticsService,
    private readonly schools: SchoolsRepository,
    private readonly config: AnalyticsSettingsService,
  ) {}

  /**
   * The schedule sweep. Every minute, because the cron whitelist fixes a
   * schedule to a specific minute of the hour and a coarser sweep would
   * fire "07:00 daily" at some point between seven and eight.
   *
   * It is a cheap index scan over `(status, next_run_at)` that almost
   * always returns nothing, which is what makes per-minute affordable.
   */
  @Cron('* * * * *')
  async fireDueSchedules(): Promise<{ fired: number; failed: number }> {
    const result = await this.schedules.runDue();
    if (result.fired > 0 || result.failed > 0) {
      this.logger.log(
        `schedules: ${result.fired} fired, ${result.failed} failed`,
      );
    }
    return result;
  }

  /**
   * Nightly materialized-view refresh (roadmap §3/§4).
   *
   * Runs hourly and checks each school's `analytics.mv_refresh_time`
   * against the Dhaka clock. The views are **school-independent** — one
   * `mv_attendance_monthly` holds every school's rows — so the refresh
   * happens once per window rather than once per school: the first school
   * whose configured time has arrived in this hour triggers it, and the
   * rest of the hour is a no-op.
   */
  @Cron('5 * * * *')
  async refreshViews(): Promise<{ refreshed: boolean }> {
    const nowMinutes = dhakaMinutesOfDay();
    const schools = await this.schools.findAll();

    for (const school of schools) {
      const cfg = await this.config.load(school.id);
      if (!cfg.enabled) continue;
      // Within this hour's window: the job fires at :05, so a configured
      // 02:15 is matched by "the same hour" rather than by the minute.
      if (
        Math.floor(cfg.mvRefreshMinutes / 60) !== Math.floor(nowMinutes / 60)
      ) {
        continue;
      }
      const outcomes = await this.views.refreshAll();
      this.logger.log(
        `materialized views refreshed: ${outcomes
          .map((o) => `${o.view} ${o.ok ? `${o.durationMs}ms` : 'FAILED'}`)
          .join(', ')}`,
      );
      return { refreshed: true };
    }
    return { refreshed: false };
  }

  /**
   * Folds the website counters into `site_analytics_daily`.
   *
   * Every fifteen minutes rather than nightly, for two reasons: the
   * dashboard's traffic panel is much more useful when it is roughly live,
   * and a Redis restart between folds then loses fifteen minutes of counts
   * instead of a day's.
   */
  @Cron('*/15 * * * *')
  async foldSiteAnalytics(): Promise<{ schools: number; days: number }> {
    const result = await this.site.fold();
    if (result.days > 0) {
      this.logger.log(`site analytics folded for ${result.days} school-day(s)`);
    }
    return result;
  }

  /**
   * Retention (roadmap §4's "30 d auto-purge") and the stuck-run sweep,
   * together because both are housekeeping over the same table and neither
   * is worth its own hourly wake-up.
   */
  @Cron('20 3 * * *')
  async housekeeping(): Promise<{
    purged: number;
    failed: number;
    disabled: number;
  }> {
    const [{ purged }, { failed }, disabled] = [
      await this.runs.purgeExpired(),
      await this.runs.failStale(),
      await this.schedules.disableOrphanedSchedules(),
    ];
    return { purged, failed, disabled };
  }
}
