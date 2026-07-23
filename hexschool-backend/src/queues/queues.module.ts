import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  NOTIFICATIONS_QUEUE,
  RESULTS_QUEUE,
  SYSTEM_QUEUE,
} from './queues.constants';
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
      // M15 result processing. The worker lives in ResultModule (it needs
      // the processing service); this registration exists so Bull Board
      // shows the queue and the root wiring stays in one place.
      { name: RESULTS_QUEUE },
    ),
  ],
  // The notifications worker moved to CommunicationModule (M17) — it needs
  // the render/dispatch services. This module keeps only the root wiring
  // and the demo `system` queue.
  providers: [SystemProcessor],
  exports: [BullModule],
})
export class QueuesModule {}
