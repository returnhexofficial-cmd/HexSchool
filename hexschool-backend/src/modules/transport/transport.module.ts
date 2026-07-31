import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { CommunicationModule } from '../communication/communication.module';
import { EnrollmentModule } from '../enrollment/enrollment.module';
import { RbacModule } from '../rbac/rbac.module';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { TransportController } from './controllers/transport.controller';
import { TransportReportsController } from './controllers/transport-reports.controller';
import { TransportExpiryJob } from './jobs/transport-expiry.job';
import {
  DriversRepository,
  VehiclesRepository,
} from './repositories/fleet.repository';
import {
  RoutesRepository,
  RouteStopsRepository,
} from './repositories/routes.repository';
import { TransportAssignmentsRepository } from './repositories/transport-assignments.repository';
import { TransportBillingRepository } from './repositories/transport-billing.repository';
import { VehicleExpensesRepository } from './repositories/vehicle-expenses.repository';
import { FleetService } from './services/fleet.service';
import { RoutesService } from './services/routes.service';
import { TransportAssignmentsService } from './services/transport-assignments.service';
import { TransportExportService } from './services/transport-export.service';
import { TransportFeeService } from './services/transport-fee.service';
import { TransportNotificationsService } from './services/transport-notifications.service';
import { TransportPortalService } from './services/transport-portal.service';
import { TransportPostingService } from './services/transport-posting.service';
import { TransportReportsService } from './services/transport-reports.service';
import { TransportSettingsService } from './services/transport-settings.service';
import { VehicleExpensesService } from './services/vehicle-expenses.service';

/**
 * Module 25 — Transport Management: the fleet, the routes and their
 * stops, who rides which bus from where, what that costs a family, and
 * what running it costs the school.
 *
 * **Direction of the integrations.** Everything this module needs, it
 * imports:
 *
 *   - `SchoolModule` for settings, `RbacModule` for the one runtime
 *     permission check (`transport.assign.override` at the capacity
 *     guard),
 *   - `EnrollmentModule` for the canonical roster every assignment keys
 *     on — a rider is an `enrollment_id`, never a `student_id`,
 *   - `CommunicationModule` for `NotificationService.send()` (M17),
 *   - `AccountingModule` for `VoucherService.postAuto` (M20) — the same
 *     door M21's payroll and M23's library fines post through.
 *
 * It deliberately does **not** import `FeeModule`, and the direction is
 * forced rather than chosen. The transport fee line has to reach M16's
 * invoice generation, so `TransportFeeService` — which depends on
 * `PrismaService` and `SettingsService` alone — is provided a **second
 * time inside FeeModule**, bound to the `TRANSPORT_FEE_SOURCE` token.
 * That is the M13 `RoutineConflictChecker` / M23 `LIBRARY_CLEARANCE`
 * pattern, and the alternative (FeeModule importing TransportModule)
 * would close a cycle: Transport → Accounting → Fee.
 *
 * The two invoice figures the collection report needs come from
 * `TransportBillingRepository`, a narrow read over PrismaService — the
 * M17 `AudienceRepository` / M18 `DashboardRepository` / M19
 * `PublicSiteRepository` / M22 policy-query / M23
 * `LibraryDirectoryRepository` precedent.
 *
 * Nothing imports TransportModule back except the leaf `PortalModule`
 * (M18), which composes `TransportPortalService` into
 * `/portal/transport`.
 */
@Module({
  imports: [
    SchoolModule,
    RbacModule,
    EnrollmentModule,
    CommunicationModule,
    AccountingModule,
  ],
  controllers: [TransportController, TransportReportsController],
  providers: [
    TransportSettingsService,
    FleetService,
    RoutesService,
    TransportAssignmentsService,
    VehicleExpensesService,
    TransportFeeService,
    TransportPostingService,
    TransportReportsService,
    TransportExportService,
    TransportNotificationsService,
    TransportPortalService,
    TransportExpiryJob,
    VehiclesRepository,
    DriversRepository,
    RoutesRepository,
    RouteStopsRepository,
    TransportAssignmentsRepository,
    VehicleExpensesRepository,
    TransportBillingRepository,
    // Stateless re-provision (PrismaService only) — the M07 convention.
    SchoolsRepository,
  ],
  // For M18's portal panel and M09's student profile card. Every one of
  // these is injected by a consumer outside this module, and a service a
  // consumer injects but the module does not export compiles cleanly and
  // then fails to boot — the M18/M21 lesson, twice learned.
  exports: [
    TransportPortalService,
    TransportAssignmentsService,
    TransportReportsService,
    TransportSettingsService,
  ],
})
export class TransportModule {}
