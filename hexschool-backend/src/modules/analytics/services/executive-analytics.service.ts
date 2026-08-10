import { Injectable } from '@nestjs/common';
import { RedisCacheService } from '../../../database/redis/redis-cache.service';
import { SessionsService } from '../../academic/services/sessions.service';
import {
  agingBuckets,
  buildHeatmap,
  densify,
  monthKeysEndingAt,
  percent,
  realization,
  topNWithOther,
  trend,
  yearOverYear,
  type Heatmap,
  type SeriesPoint,
  type YoYPoint,
} from '../calc/analytics.engine';
import { AnalyticsRepository } from '../repositories/analytics.repository';
import { AnalyticsSettingsService } from './analytics-settings.service';
import { SiteAnalyticsService } from './site-analytics.service';

const TTL_SECONDS = 300;

/**
 * Roadmap §4's analytics endpoints and §5's executive dashboard.
 *
 * Cached in Redis for five minutes, best-effort (the M18 dashboard
 * pattern): a cache miss is a live compute, never an error, so the
 * dashboard never depends on Redis being up.
 *
 * **Every panel that reads a materialized view says so.** Roadmap §8 asks
 * for the eventual freshness to be documented on the affected reports, and
 * "documented" in a UI means printed on the panel — a figure that quietly
 * disagrees with the live screen next to it destroys confidence in both,
 * and the reader has no way to tell which is stale without being told.
 */
@Injectable()
export class ExecutiveAnalyticsService {
  constructor(
    private readonly repo: AnalyticsRepository,
    private readonly sessions: SessionsService,
    private readonly site: SiteAnalyticsService,
    private readonly config: AnalyticsSettingsService,
    private readonly cache: RedisCacheService,
  ) {}

  private async cached<T>(
    key: string,
    refresh: boolean,
    build: () => Promise<T>,
  ): Promise<T & { computedAt: string; cached?: boolean }> {
    if (!refresh) {
      const hit = await this.cache.getJson<T & { computedAt: string }>(key);
      if (hit) return { ...hit, cached: true };
    }
    const built = { ...(await build()), computedAt: new Date().toISOString() };
    await this.cache.setJson(key, built, TTL_SECONDS);
    return built;
  }

  /** `GET /analytics/enrollment` — roadmap §4's YoY trend. */
  async enrollment(
    schoolId: string,
    refresh = false,
  ): Promise<{
    series: YoYPoint[];
    byClass: Array<{ className: string; count: number }>;
    total: number;
    trend: ReturnType<typeof trend>;
    computedAt: string;
  }> {
    return this.cached(
      `analytics:enrollment:${schoolId}`,
      refresh,
      async () => {
        const now = new Date();
        const thisMonth = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
        );
        const from = new Date(
          Date.UTC(thisMonth.getUTCFullYear() - 2, thisMonth.getUTCMonth(), 1),
        );
        const raw = await this.repo.enrollmentByMonth(
          schoolId,
          from,
          thisMonth,
        );
        const byKey = new Map(raw.map((p) => [p.month, p.count]));

        const currentKeys = monthKeysEndingAt(thisMonth, 12);
        const priorKeys = monthKeysEndingAt(
          new Date(
            Date.UTC(
              thisMonth.getUTCFullYear() - 1,
              thisMonth.getUTCMonth(),
              1,
            ),
          ),
          12,
        );
        const current: SeriesPoint[] = currentKeys.map((key) => ({
          key,
          value: byKey.get(key) ?? 0,
        }));
        const prior: SeriesPoint[] = priorKeys.map((key) => ({
          key,
          value: byKey.get(key) ?? 0,
        }));

        const session = await this.sessions.getCurrent(schoolId);
        const byClass = session
          ? await this.repo.headcountByClass(schoolId, session.id)
          : [];

        return {
          series: yearOverYear(current, prior),
          byClass: byClass.map((row) => ({
            className: row.className,
            count: row.count,
          })),
          total: byClass.reduce((sum, row) => sum + row.count, 0),
          trend: trend(current),
        };
      },
    );
  }

  /** `GET /analytics/attendance-heatmap` — roadmap §4, section × month. */
  async attendanceHeatmap(
    schoolId: string,
    sessionId?: string,
    refresh = false,
  ): Promise<{
    heatmap: Heatmap;
    freshness: string;
    computedAt: string;
  }> {
    const key = `analytics:heatmap:${schoolId}:${sessionId ?? 'current'}`;
    return this.cached(key, refresh, async () => {
      const session =
        sessionId ?? (await this.sessions.getCurrent(schoolId))?.id;
      const [rows, labels] = await Promise.all([
        this.repo.attendanceMonthly(schoolId, session),
        this.repo.sectionLabels(schoolId, session),
      ]);

      const months = [...new Set(rows.map((row) => row.month))].sort();
      const sectionNames = [
        ...new Set(
          rows.map((row) => labels.get(row.sectionId) ?? row.sectionId),
        ),
      ].sort((a, b) => a.localeCompare(b));

      return {
        heatmap: buildHeatmap(
          rows.map((row) => ({
            row: labels.get(row.sectionId) ?? row.sectionId,
            column: row.month,
            value:
              percent(row.present + row.late + row.halfDay * 0.5, row.marked) ??
              0,
          })),
          sectionNames,
          months,
        ),
        freshness:
          'Refreshed nightly from mv_attendance_monthly — up to 24 hours old',
      };
    });
  }

  /** `GET /analytics/finance` — realization %, dues aging, collection trend. */
  async finance(
    schoolId: string,
    refresh = false,
  ): Promise<{
    monthly: Array<{
      month: string;
      billed: number;
      collected: number;
      rate: number | null;
    }>;
    twelveMonth: ReturnType<typeof realization>;
    aging: ReturnType<typeof agingBuckets>;
    collectionTrend: ReturnType<typeof trend>;
    freshness: string;
    computedAt: string;
  }> {
    return this.cached(`analytics:finance:${schoolId}`, refresh, async () => {
      const [months, invoices] = await Promise.all([
        this.repo.collectionMonthly(schoolId, 24),
        this.repo.outstandingInvoices(schoolId, new Date()),
      ]);

      const keys = monthKeysEndingAt(new Date(), 12);
      const recent = months.filter((row) => keys.includes(row.month));
      const totals = recent.reduce(
        (acc, row) => ({
          billed: acc.billed + row.billed,
          collected: acc.collected + row.collected,
        }),
        { billed: 0, collected: 0 },
      );

      return {
        monthly: densify(
          months.map((row) => ({ key: row.month, value: row.collected })),
          keys,
        ).map((point) => {
          const source = months.find((row) => row.month === point.key);
          return {
            month: point.key,
            billed: source?.billed ?? 0,
            collected: point.value,
            rate: percent(point.value, source?.billed ?? 0),
          };
        }),
        twelveMonth: realization(totals.billed, totals.collected),
        aging: agingBuckets(invoices),
        collectionTrend: trend(
          densify(
            months.map((row) => ({ key: row.month, value: row.collected })),
            keys,
          ),
        ),
        freshness:
          'Refreshed nightly from mv_collection_monthly — up to 24 hours old',
      };
    });
  }

  /** `GET /analytics/results` — pass % and GPA over time. */
  async results(
    schoolId: string,
    sessionId?: string,
    refresh = false,
  ): Promise<{
    exams: Array<{
      examId: string;
      examName: string;
      examDate: string;
      candidates: number;
      passRate: number | null;
      avgGpa: number | null;
    }>;
    freshness: string;
    computedAt: string;
  }> {
    const key = `analytics:results:${schoolId}:${sessionId ?? 'all'}`;
    return this.cached(key, refresh, async () => {
      const rows = await this.repo.resultSummary(schoolId, sessionId);
      return {
        exams: rows.map((row) => ({
          examId: row.examId,
          examName: row.examName,
          examDate: row.examDate,
          candidates: row.candidates,
          passRate: percent(row.passed, row.candidates),
          avgGpa: row.avgGpa,
        })),
        freshness:
          'Refreshed nightly from mv_result_summary — up to 24 hours old',
      };
    });
  }

  /** `GET /analytics/operations` — the KPI row across the operational modules. */
  async operations(
    schoolId: string,
    refresh = false,
  ): Promise<{
    snapshot: Awaited<ReturnType<AnalyticsRepository['operationsSnapshot']>>;
    staff: Awaited<ReturnType<AnalyticsRepository['teacherLoad']>> | null;
    messaging: Array<{ label: string; value: number }>;
    smsSpend: number;
    computedAt: string;
  }> {
    return this.cached(
      `analytics:operations:${schoolId}`,
      refresh,
      async () => {
        const session = await this.sessions.getCurrent(schoolId);
        const from = new Date(Date.now() - 30 * 86_400_000);
        const [snapshot, staff, spend] = await Promise.all([
          this.repo.operationsSnapshot(schoolId),
          session ? this.repo.teacherLoad(schoolId, session.id) : null,
          this.repo.messageSpend(schoolId, from, new Date()),
        ]);

        return {
          snapshot,
          staff,
          messaging: topNWithOther(
            spend.map((row) => ({
              label: `${row.channel} ${row.status}`,
              value: row.messages,
            })),
            6,
          ),
          smsSpend:
            Math.round(
              spend
                .filter((row) => row.channel === 'SMS')
                .reduce((sum, row) => sum + row.cost, 0) * 10000,
            ) / 10000,
        };
      },
    );
  }

  /**
   * `GET /analytics/executive` — the whole dashboard in one call.
   *
   * One request rather than six, because six parallel requests each doing
   * their own session lookup and their own cache round trip is how a
   * dashboard ends up slower than the sum of its panels. Each panel keeps
   * its own endpoint for drill-through and its own cache entry, so this is
   * a composition and not a duplicate query path.
   */
  async executive(
    schoolId: string,
    sessionId?: string,
    refresh = false,
  ): Promise<Record<string, unknown>> {
    const cfg = await this.config.load(schoolId);
    const [enrollment, heatmap, finance, results, operations, website] =
      await Promise.all([
        this.enrollment(schoolId, refresh),
        this.attendanceHeatmap(schoolId, sessionId, refresh),
        this.finance(schoolId, refresh),
        this.results(schoolId, sessionId, refresh),
        this.operations(schoolId, refresh),
        cfg.websiteTrackingEnabled
          ? this.site.report(schoolId, { days: 30 })
          : Promise.resolve(null),
      ]);

    const session = await this.sessions.getCurrent(schoolId);
    return {
      session: session ? { id: session.id, name: session.name } : null,
      enrollment,
      attendance: heatmap,
      finance,
      results,
      operations,
      website,
      computedAt: new Date().toISOString(),
    };
  }
}
