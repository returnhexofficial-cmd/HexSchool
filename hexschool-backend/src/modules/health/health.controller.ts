import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  DiskHealthIndicator,
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../../common/decorators/public.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';

// check-disk-space shells out to `wmic`, which modern Windows 11 no longer
// ships — deployment targets are Linux (Docker/Ubuntu), so the disk probe
// is skipped only on local Windows dev machines.
const CHECK_DISK = process.platform !== 'win32';

@ApiTags('health')
@Public() // orchestrator/uptime probes carry no credentials
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: PrismaHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  // Terminus already returns { status, info, error, details } and sets 503
  // when degraded — orchestrators and uptime monitors expect that raw shape.
  @Get()
  @HealthCheck()
  @SkipEnvelope()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
      ...(CHECK_DISK
        ? [
            () =>
              this.disk.checkStorage('disk', {
                path: '/',
                thresholdPercent: 0.9,
              }),
          ]
        : []),
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024),
    ]);
  }
}
