import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NOTIFICATIONS_QUEUE, SYSTEM_QUEUE } from './queues.constants';
import { NotificationsProcessor } from './notifications.processor';
import { SystemProcessor } from './system.processor';

/**
 * BullMQ root wiring + the demo `system` queue. Redis being down degrades
 * queues gracefully (jobs buffer client-side, health reports degraded) —
 * the HTTP API stays up for non-queue features.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.getOrThrow<string>('redis.url'));
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            username: url.username || undefined,
            password: url.password || undefined,
            maxRetriesPerRequest: null,
          },
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: SYSTEM_QUEUE },
      { name: NOTIFICATIONS_QUEUE },
    ),
  ],
  providers: [SystemProcessor, NotificationsProcessor],
  exports: [BullModule],
})
export class QueuesModule {}
