import { Injectable } from '@nestjs/common';
import { SettingsService } from '../../school/services/settings.service';

export interface AnalyticsConfig {
  enabled: boolean;
  /** Days a generated report file is kept before the purge job removes it. */
  retentionDays: number;
  /** Hard cap on rows a single run may produce. */
  maxRows: number;
  /** Consecutive failures after which a schedule is DISABLED (roadmap §6). */
  scheduleMaxFailures: number;
  /** Whether a scheduled report attaches the file or links to it. */
  scheduleAttachFiles: boolean;
  /** Attachments above this many bytes are linked instead. */
  scheduleAttachMaxBytes: number;
  /** Nightly MV refresh time, minutes past midnight Dhaka. */
  mvRefreshMinutes: number;
  /** Whether the public site records page views at all. */
  websiteTrackingEnabled: boolean;
  /** Salt for the visitor fingerprint. Rotating it resets uniqueness. */
  websiteVisitorSalt: string;
  /** How many top pages/referrers a day's row keeps. */
  websiteTopN: number;
}

/**
 * One typed read of the whole `analytics.*` group — the M12/M13/M23–M28
 * settings-service convention.
 *
 * `clamp` is the helper every one of those modules ended up needing, and
 * it is copied here for the same reason M26/M27/M28 copied it: `null`,
 * `undefined` and `''` all mean "no value", and `Number()` maps the first
 * and third to **0** rather than to NaN, so a finiteness check alone never
 * sees them and they clamp to `min`. Here a missing
 * `analytics.report_retention_days` would clamp to 1 and delete every
 * export overnight, and a missing `analytics.report_max_rows` would cap
 * every report at a single row.
 */
function clamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function text(value: unknown, fallback: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return s.length > 0 ? s : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

@Injectable()
export class AnalyticsSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async load(schoolId: string): Promise<AnalyticsConfig> {
    const get = <T>(key: string) => this.settings.getValue<T>(schoolId, key);

    const [
      enabled,
      retentionDays,
      maxRows,
      scheduleMaxFailures,
      scheduleAttachFiles,
      scheduleAttachMaxBytes,
      mvRefreshTime,
      websiteTrackingEnabled,
      websiteVisitorSalt,
      websiteTopN,
    ] = await Promise.all([
      get<boolean>('analytics.enabled'),
      get<number>('analytics.report_retention_days'),
      get<number>('analytics.report_max_rows'),
      get<number>('analytics.schedule_max_failures'),
      get<boolean>('analytics.schedule_attach_files'),
      get<number>('analytics.schedule_attach_max_bytes'),
      get<string>('analytics.mv_refresh_time'),
      get<boolean>('analytics.website_tracking_enabled'),
      get<string>('analytics.website_visitor_salt'),
      get<number>('analytics.website_top_n'),
    ]);

    return {
      enabled: flag(enabled, true),
      retentionDays: clamp(retentionDays, 1, 365, 30),
      maxRows: clamp(maxRows, 100, 500_000, 50_000),
      scheduleMaxFailures: clamp(scheduleMaxFailures, 1, 10, 3),
      scheduleAttachFiles: flag(scheduleAttachFiles, true),
      scheduleAttachMaxBytes: clamp(
        scheduleAttachMaxBytes,
        10_000,
        25_000_000,
        5_000_000,
      ),
      mvRefreshMinutes: minutesFrom(text(mvRefreshTime, '02:15'), 135),
      websiteTrackingEnabled: flag(websiteTrackingEnabled, true),
      websiteVisitorSalt: text(websiteVisitorSalt, 'smis-site-analytics'),
      websiteTopN: clamp(websiteTopN, 5, 100, 20),
    };
  }
}

/** "HH:mm" → minutes past midnight, falling back rather than throwing. */
function minutesFrom(value: string, fallback: number): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}
