import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { getQueueToken } from '@nestjs/bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';
import type { Queue } from 'bullmq';
import basicAuth from 'express-basic-auth';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { SYSTEM_QUEUE } from './queues/queues.constants';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.useGlobalInterceptors(new LoggerErrorInterceptor());

  const config = app.get(ConfigService);
  const env = config.getOrThrow<string>('app.env');
  const isProd = env === 'production';

  // Security & performance
  app.use(helmet());
  app.use(compression());
  app.use(cookieParser()); // refresh token cookie (M02)
  app.enableCors({
    origin: config.getOrThrow<string[]>('app.corsOrigins'),
    credentials: true,
  });
  app.set('trust proxy', 1); // behind Nginx in prod

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  const dashAuth = basicAuth({
    users: {
      [config.getOrThrow<string>('security.adminDashUser')]:
        config.getOrThrow<string>('security.adminDashPass'),
    },
    challenge: true,
  });

  // Swagger — open in dev, basic-auth in prod
  if (isProd) {
    app.use(['/api/docs', '/api/docs-json'], dashAuth);
  }
  const swaggerDoc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('HexSchool SMIS API')
      .setDescription(
        'School Management Information System — REST API v1. ' +
          'All responses use the `{ success, data, meta?, message? }` envelope.',
      )
      .setVersion(config.getOrThrow<string>('app.buildSha'))
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, swaggerDoc);

  // Bull Board (queue dashboard) — always credential-guarded
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');
  createBullBoard({
    queues: [new BullMQAdapter(app.get<Queue>(getQueueToken(SYSTEM_QUEUE)))],
    serverAdapter,
  });
  app.use('/admin/queues', dashAuth, serverAdapter.getRouter());

  const port = config.getOrThrow<number>('app.port');
  await app.listen(port);
}

void bootstrap();
