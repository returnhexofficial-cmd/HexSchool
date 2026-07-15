import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const PERMISSION_CACHE_TTL_SECONDS = 300;

const key = (userId: string): string => `perm:${userId}`;

/**
 * Best-effort Redis cache for per-user permission sets (PROJECT_CONTEXT
 * §16: permissions are NOT in the JWT so revocation is instant — 5 min
 * TTL + explicit invalidation on any role change). Redis being down must
 * never break authorization: every operation degrades to a miss/no-op,
 * and PermissionsService falls back to the DB (same pattern as
 * RedisHealthIndicator — own lazy connection, errors contained here).
 */
@Injectable()
export class PermissionsCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(PermissionsCacheService.name);
  private readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('redis.url'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null, // reconnect lazily per call
    });
  }

  async get(userId: string): Promise<string[] | null> {
    try {
      await this.ensureConnected();
      const raw = await this.client.get(key(userId));
      return raw ? (JSON.parse(raw) as string[]) : null;
    } catch (err) {
      this.warnOnce('read', err);
      return null;
    }
  }

  async set(userId: string, codes: string[]): Promise<void> {
    try {
      await this.ensureConnected();
      await this.client.set(
        key(userId),
        JSON.stringify(codes),
        'EX',
        PERMISSION_CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.warnOnce('write', err);
    }
  }

  async invalidate(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    try {
      await this.ensureConnected();
      await this.client.del(...userIds.map(key));
    } catch (err) {
      // TTL (5 min) is the safety net when explicit invalidation fails.
      this.warnOnce('invalidate', err);
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect(false);
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.status !== 'ready') {
      await this.client.connect();
    }
  }

  private warnOnce(op: string, err: unknown): void {
    this.client.disconnect(false);
    this.logger.warn(
      `permission cache ${op} failed (falling back to DB): ${
        err instanceof Error ? err.message : 'redis unreachable'
      }`,
    );
  }
}
