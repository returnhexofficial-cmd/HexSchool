import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { dhakaToday } from '../../../common/utils/clock.util';

export interface DrainedDay {
  date: string;
  pageViews: number;
  uniqueVisitors: number;
  topPages: Array<{ path: string; views: number }>;
  topReferrers: Array<{ referrer: string; views: number }>;
}

/**
 * The website page-view counter (roadmap §3's website analytics).
 *
 * **How a visitor is counted, and what is deliberately not kept.** Roadmap
 * §3 asks for unique visitors. The obvious implementations both store
 * something they should not: a visitors table keeps IP addresses, and a
 * Redis SET of fingerprints keeps a reversible list of them. M28 already
 * settled that an IP address is a contact detail — it refused to
 * rate-limit anonymous complaints by IP for exactly this reason — and a
 * marketing-page counter is a much weaker justification than a complaint
 * box was.
 *
 * So the fingerprint is a salted SHA-256 of IP + user agent, and it goes
 * straight into a **HyperLogLog**: a fixed ~12 KB structure that answers
 * "how many distinct" and out of which no member can be read. The
 * fingerprint itself is never written anywhere. Rotating
 * `analytics.website_visitor_salt` resets uniqueness, which is the
 * intended escape hatch.
 *
 * Its own lazy Redis connection, the `RedisCacheService` /
 * `PermissionsCacheService` containment pattern: **Redis being down means
 * the count is lost, never that the page fails**. A marketing page must
 * not 500 because a counter could not increment.
 */
@Injectable()
export class SiteAnalyticsCounterService implements OnModuleDestroy {
  private readonly logger = new Logger(SiteAnalyticsCounterService.name);
  private readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('redis.url'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
  }

  /** Keys are per school and per Dhaka day, and expire on their own. */
  private keys(schoolId: string, date: string) {
    const base = `site:${schoolId}:${date}`;
    return {
      views: `${base}:views`,
      pages: `${base}:pages`,
      referrers: `${base}:referrers`,
      uniques: `${base}:uniques`,
    };
  }

  fingerprint(ip: string, userAgent: string, salt: string): string {
    return createHash('sha256')
      .update(`${salt}|${ip}|${userAgent}`)
      .digest('base64url')
      .slice(0, 22);
  }

  async record(input: {
    schoolId: string;
    path: string;
    referrer?: string;
    fingerprint: string;
    now?: Date;
  }): Promise<void> {
    const date = dhakaToday(input.now ?? new Date());
    const keys = this.keys(input.schoolId, date);
    try {
      await this.ensureConnected();
      // A single pipeline: four commands, one round trip. A page view is
      // on the request path of a public page, so it has to be cheap.
      const pipeline = this.client.pipeline();
      pipeline.incr(keys.views);
      pipeline.hincrby(keys.pages, normalizePath(input.path), 1);
      if (input.referrer) {
        pipeline.hincrby(keys.referrers, normalizeReferrer(input.referrer), 1);
      }
      pipeline.pfadd(keys.uniques, input.fingerprint);
      // Nine days: long enough that a fold job which missed a night can
      // still find yesterday, short enough that nothing accumulates.
      for (const key of Object.values(keys)) pipeline.expire(key, 9 * 86_400);
      await pipeline.exec();
    } catch (error) {
      this.contain(error);
    }
  }

  /**
   * Reads a day's counters and **resets the two that are summed**.
   *
   * Views and the per-path counters are drained, because
   * `SiteAnalyticsRepository.accumulate` increments the stored row with
   * them — folding twice without a reset would double the day. The
   * HyperLogLog is deliberately **not** reset: its cardinality is written
   * as an absolute, and clearing it would make a visitor who came back
   * after lunch count twice.
   */
  async drain(schoolId: string, date: string): Promise<DrainedDay | null> {
    const keys = this.keys(schoolId, date);
    try {
      await this.ensureConnected();

      const pipeline = this.client.pipeline();
      pipeline.getdel(keys.views);
      pipeline.hgetall(keys.pages);
      pipeline.hgetall(keys.referrers);
      pipeline.pfcount(keys.uniques);
      const results = await pipeline.exec();
      if (!results) return null;

      const views = Number(results[0]?.[1] ?? 0);
      const pages = (results[1]?.[1] ?? {}) as Record<string, string>;
      const referrers = (results[2]?.[1] ?? {}) as Record<string, string>;
      const uniques = Number(results[3]?.[1] ?? 0);

      if (views === 0 && Object.keys(pages).length === 0) return null;

      // The path hashes are drained too — they are cumulative per fold
      // in the same way the view counter is.
      await this.client.del(keys.pages, keys.referrers);

      return {
        date,
        pageViews: views,
        uniqueVisitors: uniques,
        topPages: rank(pages).map(([path, count]) => ({ path, views: count })),
        topReferrers: rank(referrers).map(([referrer, count]) => ({
          referrer,
          views: count,
        })),
      };
    } catch (error) {
      this.contain(error);
      return null;
    }
  }

  /** Today's live counters, for the dashboard tile before the fold runs. */
  async peek(
    schoolId: string,
    date = dhakaToday(),
  ): Promise<{ pageViews: number; uniqueVisitors: number } | null> {
    const keys = this.keys(schoolId, date);
    try {
      await this.ensureConnected();
      const [views, uniques] = await Promise.all([
        this.client.get(keys.views),
        this.client.pfcount(keys.uniques),
      ]);
      return { pageViews: Number(views ?? 0), uniqueVisitors: Number(uniques) };
    } catch (error) {
      this.contain(error);
      return null;
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect(false);
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.status !== 'ready') await this.client.connect();
  }

  private contain(error: unknown): void {
    this.client.disconnect(false);
    this.logger.warn(
      `site analytics counter unavailable (traffic for this request is not counted): ${
        error instanceof Error ? error.message : 'redis unreachable'
      }`,
    );
  }
}

/**
 * A path, reduced to something a report can group by.
 *
 * The query string goes, because `?utm_source=…` would give every campaign
 * its own row and bury the page itself. A long path is truncated rather
 * than dropped: an unbounded key here is an unbounded hash in Redis, and
 * the field name is attacker-controlled.
 */
function normalizePath(raw: string): string {
  const path = raw.split('?')[0].split('#')[0].trim() || '/';
  return path.slice(0, 200);
}

/** The referrer's host, not the full URL — the question is who links here. */
function normalizeReferrer(raw: string): string {
  try {
    return new URL(raw).host.slice(0, 120) || 'direct';
  } catch {
    return raw.slice(0, 120) || 'direct';
  }
}

function rank(
  counts: Record<string, string>,
  top = 20,
): Array<[string, number]> {
  return Object.entries(counts)
    .map(([key, value]) => [key, Number(value)] as [string, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, top);
}
