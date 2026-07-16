import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Generic best-effort JSON cache over a dedicated lazy Redis connection
 * (same containment pattern as RedisHealthIndicator / M03's permission
 * cache): Redis being down degrades every call to a miss/no-op — callers
 * must always be able to fall back to the database.
 */
@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('redis.url'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null, // reconnect lazily per call
    });
  }

  async getJson<T>(key: string): Promise<T | null> {
    try {
      await this.ensureConnected();
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      this.contain('read', err);
      return null;
    }
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.ensureConnected();
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.contain('write', err);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.ensureConnected();
      await this.client.del(...keys);
    } catch (err) {
      this.contain('invalidate', err); // TTL is the safety net
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

  private contain(op: string, err: unknown): void {
    this.client.disconnect(false);
    this.logger.warn(
      `cache ${op} failed (degrading to DB): ${
        err instanceof Error ? err.message : 'redis unreachable'
      }`,
    );
  }
}
