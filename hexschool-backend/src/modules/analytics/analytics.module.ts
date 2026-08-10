import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { REPORTS_QUEUE } from '../../queues/queues.constants';
import { AcademicModule } from '../academic/academic.module';
import { AttendanceSettingsService } from '../attendance/services/attendance-settings.service';
import { AccountingModule } from '../accounting/accounting.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { CommunicationModule } from '../communication/communication.module';
import { CommunityModule } from '../community/community.module';
import { DocumentModule } from '../document/document.module';
import { FeeModule } from '../fee/fee.module';
import { HostelModule } from '../hostel/hostel.module';
import { HrModule } from '../hr/hr.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LibraryModule } from '../library/library.module';
import { RbacModule } from '../rbac/rbac.module';
import { ResultModule } from '../result/result.module';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { StorageModule } from '../storage/storage.module';
import { TransportModule } from '../transport/transport.module';
import {
  AnalyticsController,
  PublicAnalyticsController,
} from './controllers/analytics.controller';
import { ReportRunsController } from './controllers/report-runs.controller';
import { ReportSchedulesController } from './controllers/report-schedules.controller';
import { ReportsController } from './controllers/reports.controller';
import { AnalyticsJobs } from './jobs/analytics.jobs';
import { ReportProcessor } from './processors/report.processor';
import { AnalyticsRepository } from './repositories/analytics.repository';
import { ReportDefinitionsRepository } from './repositories/report-definitions.repository';
import { ReportRunsRepository } from './repositories/report-runs.repository';
import { ReportSchedulesRepository } from './repositories/report-schedules.repository';
import { SiteAnalyticsRepository } from './repositories/site-analytics.repository';
import { REPORT_EXECUTORS } from './reports/executor.types';
import { AccountingReportExecutors } from './reports/executors/accounting.executors';
import { AnalyticsReportExecutors } from './reports/executors/analytics.executors';
import { AttendanceReportExecutors } from './reports/executors/attendance.executors';
import { CommunicationReportExecutors } from './reports/executors/communication.executors';
import { CommunityReportExecutors } from './reports/executors/community.executors';
import { FeeReportExecutors } from './reports/executors/fee.executors';
import { HostelReportExecutors } from './reports/executors/hostel.executors';
import { InventoryReportExecutors } from './reports/executors/inventory.executors';
import { LibraryReportExecutors } from './reports/executors/library.executors';
import { PayrollReportExecutors } from './reports/executors/payroll.executors';
import { ResultReportExecutors } from './reports/executors/result.executors';
import { TransportReportExecutors } from './reports/executors/transport.executors';
import { AnalyticsSettingsService } from './services/analytics-settings.service';
import { ExecutiveAnalyticsService } from './services/executive-analytics.service';
import { MaterializedViewService } from './services/materialized-view.service';
import { ReportCatalogService } from './services/report-catalog.service';
import { ReportDeliveryService } from './services/report-delivery.service';
import { ReportEngineService } from './services/report-engine.service';
import { ReportExecutorRegistry } from './services/report-executor.registry';
import { ReportRenderService } from './services/report-render.service';
import { ReportRunsService } from './services/report-runs.service';
import { ReportSchedulesService } from './services/report-schedules.service';
import { SiteAnalyticsCounterService } from './services/site-analytics-counter.service';
import { SiteAnalyticsService } from './services/site-analytics.service';

const EXECUTOR_PROVIDERS = [
  AttendanceReportExecutors,
  ResultReportExecutors,
  FeeReportExecutors,
  AccountingReportExecutors,
  PayrollReportExecutors,
  LibraryReportExecutors,
  TransportReportExecutors,
  InventoryReportExecutors,
  HostelReportExecutors,
  CommunityReportExecutors,
  CommunicationReportExecutors,
  AnalyticsReportExecutors,
];

/**
 * Module 29 — Reports & Analytics v2.
 *
 * **The second leaf aggregator, and the reason the import list is long.**
 * M18's `PortalModule` established the shape: a module that imports many
 * feature modules and is imported by none is cycle-free by construction,
 * and composing exported services beats re-querying their tables. This is
 * the same argument from the other end — a report has to be *the module's
 * own numbers*, or the spreadsheet and the screen drift apart, which is
 * the failure the M12 reports/export split was invented to prevent.
 *
 * Eleven feature modules are imported and every one of them is there for
 * its **exported report service**. That is what M24's module doc predicted
 * when it exported `InventoryReportsService` although nothing imported
 * InventoryModule at the time: "the exports exist for M29 and M30 anyway".
 * They are all used now.
 *
 * Two edges are *not* here and the absences are deliberate:
 *
 *   - **No `PortalModule`.** M18's reports hub deep-links to endpoints; it
 *     does not call this module. Its own `ReportsController` and
 *     `report.registry.ts` are **removed** by this module (see the module
 *     doc's breaking-change note) — two controllers at `@Controller('reports')`
 *     would be a route collision, and two registries would be two sources
 *     of truth.
 *   - **No `CommunicationModule` import for the delivery log.** M17 does
 *     not export `NotificationLogService`, and widening a module's public
 *     surface for one read-only list is the wrong trade;
 *     `AnalyticsRepository` reads it narrowly (the ninth use of the
 *     narrow-repository pattern). CommunicationModule IS imported, but for
 *     `NotificationService.send()` — the M17 single-entry-point rule.
 *
 * **Leaves no no-op hooks.**
 */
@Module({
  imports: [
    SchoolModule,
    RbacModule,
    StorageModule,
    AcademicModule,
    CommunicationModule,
    // ── the eleven report sources ─────────────────────────────────────
    AttendanceModule,
    ResultModule,
    FeeModule,
    AccountingModule,
    HrModule,
    LibraryModule,
    TransportModule,
    InventoryModule,
    HostelModule,
    DocumentModule,
    CommunityModule,
    // The queue this module both produces to and consumes from. Registered
    // in `QueuesModule` for the root wiring; registered again here so
    // `@InjectQueue` resolves inside this module's own injector.
    BullModule.registerQueue({ name: REPORTS_QUEUE }),
  ],
  controllers: [
    ReportsController,
    ReportRunsController,
    ReportSchedulesController,
    AnalyticsController,
    PublicAnalyticsController,
  ],
  providers: [
    // repositories
    AnalyticsRepository,
    ReportDefinitionsRepository,
    ReportSchedulesRepository,
    ReportRunsRepository,
    SiteAnalyticsRepository,
    // services
    AnalyticsSettingsService,
    ReportCatalogService,
    ReportEngineService,
    ReportRenderService,
    ReportRunsService,
    ReportSchedulesService,
    ReportDeliveryService,
    ExecutiveAnalyticsService,
    MaterializedViewService,
    SiteAnalyticsService,
    SiteAnalyticsCounterService,
    ReportExecutorRegistry,
    // worker + cron
    ReportProcessor,
    AnalyticsJobs,
    // executors, and the array token the registry merges them from
    ...EXECUTOR_PROVIDERS,
    {
      provide: REPORT_EXECUTORS,
      useFactory: (...providers: unknown[]) => providers,
      inject: EXECUTOR_PROVIDERS,
    },
    // Stateless re-provisions — the M07/M19/M23/M27/M28 convention.
    // `SchoolsRepository` needs PrismaService only; `AttendanceSettingsService`
    // needs SettingsService only, which SchoolModule exports. Both are
    // cheaper than widening another module's public surface for one read
    // (the late-analysis executor needs the late threshold, and nothing
    // else in M12's settings group).
    SchoolsRepository,
    AttendanceSettingsService,
  ],
  // Nothing imports this module today. The exports exist for M30's system
  // console, which will want the run history and the view refresh — and
  // because a service a future consumer injects but the module does not
  // export compiles cleanly and then fails to boot (the M18/M21 lesson,
  // and M24's reason for exporting into an empty room).
  exports: [
    ReportEngineService,
    ReportCatalogService,
    ExecutiveAnalyticsService,
    MaterializedViewService,
    AnalyticsSettingsService,
  ],
})
export class AnalyticsModule {}
