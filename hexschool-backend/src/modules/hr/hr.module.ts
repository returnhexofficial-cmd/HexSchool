import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module';
import { AcademicSessionsRepository } from '../academic/repositories/academic-sessions.repository';
import { AccountingModule } from '../accounting/accounting.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { CommunicationModule } from '../communication/communication.module';
import { RbacModule } from '../rbac/rbac.module';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { EmployeesController } from './controllers/employees.controller';
import {
  LeaveApplicationsController,
  LeaveBalancesController,
  LeaveTypesController,
} from './controllers/leave.controller';
import {
  BonusRunsController,
  PayrollReportsController,
  PayrollRunsController,
  PayslipsController,
  SalaryStructuresController,
} from './controllers/payroll.controller';
import { LeaveAllocationJob } from './jobs/leave-allocation.job';
import { EmployeesRepository } from './repositories/employees.repository';
import {
  LeaveApplicationsRepository,
  LeaveBalancesRepository,
  LeaveTypesRepository,
} from './repositories/leave.repository';
import {
  BonusRunsRepository,
  PayrollRunsRepository,
  PayslipsRepository,
  PfLedgerRepository,
} from './repositories/payroll.repository';
import {
  EmployeeSalariesRepository,
  SalaryStructuresRepository,
} from './repositories/salary.repository';
import { BonusService } from './services/bonus.service';
import { HrSettingsService } from './services/hr-settings.service';
import { LeaveBalancesService } from './services/leave-balances.service';
import { LeaveTypesService } from './services/leave-types.service';
import { LeaveService } from './services/leave.service';
import { PayrollExportService } from './services/payroll-export.service';
import { PayrollPostingService } from './services/payroll-posting.service';
import { PayrollReportsService } from './services/payroll-reports.service';
import { PayrollService } from './services/payroll.service';
import { PfService } from './services/pf.service';
import { SalaryService } from './services/salary.service';

/**
 * Module 21 — HR & Payroll: the unified employee view over teachers and
 * staff, the leave system that **supersedes M08's interim
 * `teacher_leaves`**, salary structures and their history-preserving
 * assignment, the monthly payroll run, payslips, the provident fund, and
 * the five payroll reports.
 *
 * **Direction of the integrations.** Everything HR needs, it imports:
 *
 *   - `AttendanceModule` for `StaffAttendancesRepository` — the register
 *     payroll deducts against, exported by M12 for exactly this.
 *   - `AccountingModule` for `VoucherService.postAuto`, the door M20
 *     built for M21/M24–M26 to post through with their own
 *     `VoucherSource` (here `PAYROLL`, idempotent on `payroll:<runId>`).
 *   - `AcademicModule` for `CalendarService.workingDays`, the denominator
 *     of every proration and the divisor of every per-day rate.
 *   - `CommunicationModule` for the payslip SMS, `SchoolModule` for the
 *     settings, `RbacModule` for the two runtime override checks.
 *
 * Nothing imports HrModule *back*: M12's attendance listener consumes
 * `hr.leave.approved` through a bare constants file
 * (`events/hr.events.ts`), which is the M08 → M12 and M16 → M20 one-way
 * event edge, and it is what keeps the module graph acyclic while an
 * approved staff leave still marks the attendance register.
 *
 * `PortalModule` (M18, a leaf aggregator) imports this for the employee
 * self-service panels — my leave, my payslips — the same way it already
 * imports every other feature module.
 */
@Module({
  imports: [
    SchoolModule,
    RbacModule,
    AcademicModule,
    AttendanceModule,
    AccountingModule,
    CommunicationModule,
  ],
  controllers: [
    EmployeesController,
    LeaveTypesController,
    LeaveApplicationsController,
    LeaveBalancesController,
    SalaryStructuresController,
    PayrollRunsController,
    PayslipsController,
    BonusRunsController,
    PayrollReportsController,
  ],
  providers: [
    HrSettingsService,
    LeaveTypesService,
    LeaveService,
    LeaveBalancesService,
    SalaryService,
    PayrollService,
    PayrollPostingService,
    PayrollReportsService,
    PayrollExportService,
    BonusService,
    PfService,
    LeaveAllocationJob,
    EmployeesRepository,
    LeaveTypesRepository,
    LeaveBalancesRepository,
    LeaveApplicationsRepository,
    SalaryStructuresRepository,
    EmployeeSalariesRepository,
    PayrollRunsRepository,
    PayslipsRepository,
    BonusRunsRepository,
    PfLedgerRepository,
    // Stateless re-provisions (PrismaService only) — the M07 convention.
    SchoolsRepository,
    AcademicSessionsRepository,
  ],
  // For M18's portal panels and M29's analytics. `HrSettingsService` is
  // exported too because the portal's payslip PDF needs the report
  // footer — Nest DI is a *runtime* graph, and a service a consumer
  // injects but the module does not export compiles cleanly and then
  // fails to boot (the M18 `NotificationsRepository` lesson, which this
  // module's e2e suite promptly repeated).
  exports: [
    LeaveService,
    LeaveTypesService,
    PayrollService,
    PayrollReportsService,
    PayrollExportService,
    HrSettingsService,
    EmployeesRepository,
  ],
})
export class HrModule {}
