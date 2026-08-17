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
import { AttendanceModule } from './modules/attendance/attendance.module';
import { CommunicationModule } from './modules/communication/communication.module';
import { ExamModule } from './modules/exam/exam.module';
import { FeeModule } from './modules/fee/fee.module';
import { ResultModule } from './modules/result/result.module';
import { AuthModule } from './modules/auth/auth.module';
import { EnrollmentModule } from './modules/enrollment/enrollment.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { AuditModule } from './modules/audit/audit.module';
import { PermissionsGuard } from './modules/rbac/guards/permissions.guard';
import { RbacModule } from './modules/rbac/rbac.module';
import { HealthModule } from './modules/health/health.module';
import { PortalModule } from './modules/portal/portal.module';
import { SchoolModule } from './modules/school/school.module';
import { SequenceModule } from './modules/sequence/sequence.module';
import { StaffModule } from './modules/staff/staff.module';
import { StorageModule } from './modules/storage/storage.module';
import { StudentModule } from './modules/student/student.module';
import { TeacherModule } from './modules/teacher/teacher.module';
import { TimetableModule } from './modules/timetable/timetable.module';
import { VersionModule } from './modules/version/version.module';
import { WebsiteModule } from './modules/website/website.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { HrModule } from './modules/hr/hr.module';
import { AssignmentModule } from './modules/assignment/assignment.module';
import { LibraryModule } from './modules/library/library.module';
import { TransportModule } from './modules/transport/transport.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { CommunityModule } from './modules/community/community.module';
import { DocumentModule } from './modules/document/document.module';
import { HostelModule } from './modules/hostel/hostel.module';
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
        //
        // Browser QA has the same problem without being able to claim
        // NODE_ENV=test: the Playwright harness signs in once per seeded role
        // to build its storage states, and 7 logins in a burst trips the
        // 5/min credential limit — 4 roles authenticated and the rest were
        // refused. AUTH_THROTTLE_ENABLED=false lifts the limit for a local QA
        // run.
        //
        // Guarded so it can never take effect in production, whatever ends up
        // in the environment.
        skipIf: () => {
          const env = config.get<string>('app.env');
          if (env === 'test') return true;
          return (
            env !== 'production' &&
            process.env.AUTH_THROTTLE_ENABLED === 'false'
          );
        },
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
    EnrollmentModule,
    // TimetableModule before AttendanceModule: the latter imports it for
    // period-mode marking (RoutineService.getCurrentPeriod).
    TimetableModule,
    AttendanceModule,
    ExamModule,
    // ResultModule after ExamModule: it consumes the exam aggregate, and
    // ExamModule is where its EXAM_RESULT_GATE provider is bound.
    ResultModule,
    // FeeModule likewise binds EXAM_DUES_GATE inside ExamModule, and
    // exports the gateway adapters that M10 admission payments reuse.
    FeeModule,
    // CommunicationModule owns the notifications worker and the single
    // NotificationService.send() entry point; the producer modules above
    // import it to retro-wire their queued events.
    CommunicationModule,
    // PortalModule is the Phase-1 capstone aggregator (portals, dashboards,
    // reports) — a leaf that imports the feature modules above.
    PortalModule,
    // WebsiteModule (M19) is the public face: the CMS admin API and the
    // @Public() site API. Also a leaf — nothing imports it.
    WebsiteModule,
    // AccountingModule (M20) imports FeeModule for the invoice reads
    // auto-posting needs, and listens for `payment.success` — the fee
    // module never learns the ledger exists. M21 payroll imports THIS one.
    AccountingModule,
    HrModule,
    // AssignmentModule (M22) reads the M11 roster and sends through M17;
    // nothing imports it back except PortalModule, which composes its
    // student-facing service into /portal/assignments.
    AssignmentModule,
    // LibraryModule (M23) imports Academic (the holiday-aware fine),
    // Communication (the overdue chase) and Accounting (the fine
    // voucher). It reads students/teachers/staff over a narrow
    // directory repository rather than importing those three modules,
    // which is also what lets StudentModule bind its clearance checker
    // without closing a cycle.
    LibraryModule,
    // TransportModule (M25) imports Enrollment (a rider is an
    // enrollment), Communication (the document-expiry alert) and
    // Accounting (the fuel voucher). It does NOT import FeeModule: the
    // transport fee line reaches M16 through the `TRANSPORT_FEE_SOURCE`
    // token, bound inside FeeModule, because the reverse import would
    // close a cycle through Accounting.
    TransportModule,
    // InventoryModule (M24) imports School, Sequence, Communication (the
    // low-stock sweep) and Accounting (the purchase voucher). It imports
    // no feature module for the people and departments a gate pass goes
    // to — `InventoryDirectoryRepository` reads those narrowly over
    // PrismaService, the M12/M17/M18/M19/M22/M23/M25 precedent — and
    // nothing imports it back.
    InventoryModule,
    // HostelModule (M26) imports Enrollment (a boarder is an enrollment),
    // Communication (the allocation and meal-off notices), Accounting
    // (the deposit voucher pair) and — unlike M25 — **FeeModule**, for
    // `LedgerService.outstandingFor`: the vacate clearance reads the same
    // dues source every other gate in the system reads. The hostel and
    // mess fee LINES still reach M16 through the `HOSTEL_FEE_SOURCE`
    // token bound inside FeeModule, because the reverse import would now
    // close a cycle directly.
    HostelModule,
    // DocumentModule (M27) is a near-leaf like Portal (M18) and Website
    // (M19): only the leaf PortalModule imports it back, which is what
    // makes its long import list cycle-free. It imports Student,
    // Enrollment, Result, Attendance and Fee because a certificate quotes
    // a fact each of them owns, and deliberately imports NEITHER Library
    // nor Hostel — both expose their third of the clearance aggregate
    // through a PrismaService-only service that DocumentModule provides a
    // second time (the M23 `LIBRARY_CLEARANCE` shape). Its own outbound
    // edge is the same trick in reverse: `CertificateVerifierService` is
    // bound inside WebsiteModule behind `CERTIFICATE_VERIFIER`, replacing
    // the stub M19 left at `GET /public/verify/certificate`.
    DocumentModule,
    // CommunityModule (M28) is a near-leaf for the fourth time: only the
    // leaf PortalModule imports it back, and that edge is what finally
    // turns M18's contact-school stub into a real ticket thread. What is
    // NOT in its import list is the interesting part — all three of its
    // thirds are about people the system already knows, and it imports
    // neither Student, Teacher, Staff nor Enrollment for them. A narrow
    // `CommunityDirectoryRepository` over PrismaService supplies the
    // handful of columns it needs, the M12/M17/M18/M19/M22/M23/M24
    // precedent, eighth use. It imports School (settings), Sequence (three
    // gap-free number series), Communication (every message), Accounting
    // (a donation posts through `postAuto`, new `VoucherSource.DONATION`),
    // Rbac (the sensitive-complaint check shapes the QUERY, so it lives in
    // the service) and Storage.
    CommunityModule,
    // AnalyticsModule (M29) is the **second leaf aggregator** — the M18
    // PortalModule shape, applied to reporting. It imports eleven feature
    // modules purely for their exported report services, so a spreadsheet
    // prints the module's own numbers rather than a second query that
    // drifts (the M12 reports/export split, across module boundaries), and
    // nothing imports it back, so the graph stays acyclic. It also takes
    // over `@Controller('reports')` from PortalModule: M18's code-only
    // registry is superseded by `report_definitions`, and two controllers
    // on one path would collide.
    AnalyticsModule,
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
