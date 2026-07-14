import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import Redis from 'ioredis';

/**
 * Redis health via a dedicated lightweight connection. Redis being down must
 * degrade the health report without crashing the API (Module 01 edge case),
 * so the connection is lazy and errors are contained here.
 */
@Injectable()
export class RedisHealthIndicator implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(
    config: ConfigService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {
    this.client = new Redis(config.getOrThrow<string>('redis.url'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null, // health checks reconnect per call
    });
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      if (this.client.status !== 'ready') {
        await this.client.connect();
      }
      const pong: string = await this.client.ping();
      if (pong !== 'PONG') {
        return indicator.down({ message: `unexpected ping reply: ${pong}` });
      }
      return indicator.up();
    } catch (err) {
      this.client.disconnect(false);
      return indicator.down({
        message: err instanceof Error ? err.message : 'redis unreachable',
      });
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect(false);
  }
}
