import { Injectable } from '@nestjs/common';
import { RedisCacheService } from '../../../database/redis/redis-cache.service';

/**
 * The cacheable public payloads. A closed list, deliberately: `bust`
 * deletes all of them by name, so invalidation cannot depend on a
 * bookkeeping key that might itself be missing.
 */
export const WEBSITE_CACHE_KEYS = [
  'config',
  'home',
  'events',
  'galleries',
  'downloads',
  'faqs',
  'committee',
  'teachers',
] as const;

export type WebsiteCacheKey = (typeof WEBSITE_CACHE_KEYS)[number];

/**
 * Redis caching for the public composite endpoints (roadmap M19 §4 —
 * "all cached (Redis 60 s) and rate-limited"; §8 — "result search during
 * a publish spike"). Best-effort like every other use of
 * `RedisCacheService`: a Redis outage degrades to a live query, never an
 * error page.
 *
 * Every admin write busts the whole school's website namespace rather
 * than a computed key set. The home payload composes eight sources, so
 * per-entity invalidation would mean every writer knowing which composite
 * it appears in — a rule that rots the moment someone adds a section. A
 * blunt bust plus a 60-second TTL is the cheaper correct answer.
 *
 * **Why the key list is a constant and not an index kept in Redis.** The
 * first design tracked the live payload names in a `…:keys` entry and
 * deleted whatever it listed. That makes invalidation depend on a second
 * best-effort value: if the index write is the one call a Redis blip
 * drops, `bust` finds nothing to delete and the site serves *stale
 * published content* until the TTL expires — a silent failure, and the
 * one this cache exists to avoid. A `SCAN` would be the alternative and
 * must not be run against a shared Redis. Naming the keys removes the
 * failure mode entirely at the cost of one line per new payload, which a
 * unit test pins.
 */
@Injectable()
export class WebsiteCacheService {
  constructor(private readonly redis: RedisCacheService) {}

  key(schoolId: string, name: string): string {
    return `website:${schoolId}:${name}`;
  }

  /** Cache-aside read-through. */
  async wrap<T>(
    schoolId: string,
    name: WebsiteCacheKey,
    ttlSeconds: number,
    compute: () => Promise<T>,
  ): Promise<T> {
    const key = this.key(schoolId, name);
    const hit = await this.redis.getJson<T>(key);
    if (hit !== null) return hit;

    const value = await compute();
    await this.redis.setJson(key, value, ttlSeconds);
    return value;
  }

  /** Drops every cached website payload for the school. */
  async bust(schoolId: string): Promise<void> {
    await this.redis.del(
      ...WEBSITE_CACHE_KEYS.map((name) => this.key(schoolId, name)),
    );
  }
}
