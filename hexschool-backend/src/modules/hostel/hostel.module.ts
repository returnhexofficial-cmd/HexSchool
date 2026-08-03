import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { CommunicationModule } from '../communication/communication.module';
import { EnrollmentModule } from '../enrollment/enrollment.module';
import { FeeModule } from '../fee/fee.module';
import { RbacModule } from '../rbac/rbac.module';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import {
  HostelController,
  HostelAllocationsController,
} from './controllers/hostel.controller';
import { HostelReportsController } from './controllers/hostel-reports.controller';
import {
  MealOffsController,
  MessEnrollmentsController,
  MessPlansController,
} from './controllers/mess.controller';
import { HostelAllocationsRepository } from './repositories/hostel-allocations.repository';
import {
  HostelBedsRepository,
  HostelRoomsRepository,
  HostelsRepository,
} from './repositories/hostels.repository';
import {
  MealOffsRepository,
  MessEnrollmentsRepository,
  MessPlansRepository,
} from './repositories/mess.repository';
import { HostelAllocationsService } from './services/hostel-allocations.service';
import { HostelExportService } from './services/hostel-export.service';
import { HostelFeeService } from './services/hostel-fee.service';
import { HostelNotificationsService } from './services/hostel-notifications.service';
import { HostelPortalService } from './services/hostel-portal.service';
import { HostelPostingService } from './services/hostel-posting.service';
import { HostelReportsService } from './services/hostel-reports.service';
import { HostelSettingsService } from './services/hostel-settings.service';
import { HostelsService } from './services/hostels.service';
import { MessService } from './services/mess.service';

/**
 * Module 26 — Hostel Management: the buildings, their rooms and beds, who
 * sleeps in them and from when, what the kitchen charges, who is away,
 * and what a family gets back when their child moves out.
 *
 * **Direction of the integrations.** Everything this module needs, it
 * imports:
 *
 *   - `SchoolModule` for settings, `RbacModule` for the two runtime
 *     permission checks (`hostel.allocate.override` at the occupancy
 *     verdict, `hostel.vacate.override` at the dues gate),
 *   - `EnrollmentModule` for the canonical roster every allocation keys
 *     on — a boarder is an `enrollment_id`, never a `student_id`,
 *   - `CommunicationModule` for `NotificationService.send()` (M17),
 *   - `AccountingModule` for `VoucherService.postAuto` (M20) — the same
 *     door M21's payroll, M23's fines, M24's purchases and M25's fuel
 *     bills post through,
 *   - **`FeeModule` for `LedgerService.outstandingFor`**, which is the
 *     single dues source every gate in the system reads (M14's admit
 *     cards, M09's exit warning, and now the vacate clearance). A second
 *     dues query here would eventually disagree with the one that blocks
 *     the vacate, and the office would be looking at two numbers.
 *
 * That last import is what makes the fee handoff a **DI token bound in
 * the consumer** rather than an import: `HostelFeeService` — which
 * depends on `PrismaService` and `SettingsService` alone — is provided a
 * **second time inside FeeModule**, bound to `HOSTEL_FEE_SOURCE`. The
 * direction is forced, not chosen: FeeModule importing HostelModule would
 * close a cycle immediately (Hostel → Fee), and would close a second one
 * through Accounting. Same shape as M13's `RoutineConflictChecker`, M23's
 * `LIBRARY_CLEARANCE` and M25's `TRANSPORT_FEE_SOURCE` — fourth use.
 *
 * Nothing imports HostelModule back except the leaf `PortalModule` (M18),
 * which composes `HostelPortalService` into `/portal/hostel`.
 */
@Module({
  imports: [
    SchoolModule,
    RbacModule,
    EnrollmentModule,
    CommunicationModule,
    AccountingModule,
    FeeModule,
  ],
  controllers: [
    HostelController,
    HostelAllocationsController,
    MessPlansController,
    MessEnrollmentsController,
    MealOffsController,
    HostelReportsController,
  ],
  providers: [
    HostelSettingsService,
    HostelsService,
    HostelAllocationsService,
    MessService,
    HostelFeeService,
    HostelPostingService,
    HostelReportsService,
    HostelExportService,
    HostelNotificationsService,
    HostelPortalService,
    HostelsRepository,
    HostelRoomsRepository,
    HostelBedsRepository,
    HostelAllocationsRepository,
    MessPlansRepository,
    MessEnrollmentsRepository,
    MealOffsRepository,
    // Stateless re-provision (PrismaService only) — the M07 convention.
    SchoolsRepository,
  ],
  // For M18's portal panel and M09's student profile card. Every one of
  // these is injected by a consumer outside this module, and a service a
  // consumer injects but the module does not export compiles cleanly and
  // then fails to boot — the M18/M21 lesson, twice learned.
  exports: [
    HostelPortalService,
    HostelAllocationsService,
    HostelReportsService,
    HostelSettingsService,
  ],
})
export class HostelModule {}
