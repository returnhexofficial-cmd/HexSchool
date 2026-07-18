import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import type { IncomingMessage } from 'http';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from './common/interceptors/transform-response.interceptor';
import { PrismaModule } from './database/prisma/prisma.module';
import { RedisModule } from './database/redis/redis.module';
import { AcademicModule } from './modules/academic/academic.module';
import { AdmissionModule } from './modules/admission/admission.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { AuditModule } from './modules/audit/audit.module';
import { PermissionsGuard } from './modules/rbac/guards/permissions.guard';
import { RbacModule } from './modules/rbac/rbac.module';
import { HealthModule } from './modules/health/health.module';
import { SchoolModule } from './modules/school/school.module';
import { SequenceModule } from './modules/sequence/sequence.module';
import { StaffModule } from './modules/staff/staff.module';
import { StorageModule } from './modules/storage/storage.module';
import { StudentModule } from './modules/student/student.module';
import { TeacherModule } from './modules/teacher/teacher.module';
import { VersionModule } from './modules/version/version.module';
import { QueuesModule } from './queues/queues.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),

    // Structured request logging with request-id correlation.
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          genReqId: (req: IncomingMessage) =>
            (req.headers['x-request-id'] as string) ?? randomUUID(),
          customProps: (req: IncomingMessage) => ({
            requestId: (req as IncomingMessage & { id?: string }).id,
          }),
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          autoLogging: {
            ignore: (req: IncomingMessage) => req.url === '/api/v1/health',
          },
          transport:
            config.get<string>('app.env') === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),

    // DB unreachable at boot → PrismaService.$connect throws → bootstrap
    // exits non-zero and the orchestrator restarts it.
    PrismaModule,
    // Best-effort JSON cache (M04); callers always fall back to the DB.
    RedisModule,

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.getOrThrow<number>('security.rateLimitTtlMs'),
            limit: config.getOrThrow<number>('security.rateLimitMax'),
          },
        ],
        // e2e suites hammer /auth/* from one IP; rate limits are not what
        // those tests assert, so skip throttling under NODE_ENV=test.
        skipIf: () => config.get<string>('app.env') === 'test',
      }),
    }),

    // In-process events now; heavy work goes through BullMQ (queue-swap-ready).
    EventEmitterModule.forRoot(),

    // Cron jobs (nightly auth cleanup, later: report schedules, backups).
    ScheduleModule.forRoot(),

    QueuesModule,
    StorageModule,
    HealthModule,
    VersionModule,
    // AuditModule registers the global AuditInterceptor; being an import,
    // it sits OUTSIDE the root TransformResponseInterceptor below.
    AuditModule,
    RbacModule,
    AuthModule,
    SchoolModule,
    AcademicModule,
    SequenceModule,
    StaffModule,
    TeacherModule,
    StudentModule,
    AdmissionModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformResponseInterceptor },
    // Global guards run in REGISTRATION order, and root-module providers
    // register before imported modules' — so the auth pipeline is pinned
    // here explicitly: throttle → authenticate → authorize (M02+M03).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
