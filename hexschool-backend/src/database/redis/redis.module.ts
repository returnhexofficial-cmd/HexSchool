import { Global, Module } from '@nestjs/common';
import { RedisCacheService } from './redis-cache.service';

/** Global so any module can cache without wiring (introduced in M04). */
@Global()
@Module({
  providers: [RedisCacheService],
  exports: [RedisCacheService],
})
export class RedisModule {}
