import { Module } from '@nestjs/common';
import { FeeModule } from '../fee/fee.module';
import { RbacModule } from '../rbac/rbac.module';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { SequenceModule } from '../sequence/sequence.module';
import { AccountingController } from './controllers/accounting.controller';
import { AccountsController } from './controllers/accounts.controller';
import {
  BudgetsController,
  FiscalPeriodsController,
} from './controllers/budgets.controller';
import { VouchersController } from './controllers/vouchers.controller';
import { AccountingListener } from './events/accounting.listener';
import { AccountingConfigRepository } from './repositories/accounting-config.repository';
import { AccountsRepository } from './repositories/accounts.repository';
import { VouchersRepository } from './repositories/vouchers.repository';
import { AccountingExportService } from './services/accounting-export.service';
import { AccountingReportsService } from './services/accounting-reports.service';
import { AccountingSettingsService } from './services/accounting-settings.service';
import { AccountingToolsService } from './services/accounting-tools.service';
import { AccountsService } from './services/accounts.service';
import { AutoPostingService } from './services/auto-posting.service';
import { BudgetService } from './services/budget.service';
import { FiscalPeriodService } from './services/fiscal-period.service';
import { PostingMapService } from './services/posting-map.service';
import { VoucherService } from './services/voucher.service';

/**
 * Module 20 — Accounting & Finance: the chart of accounts, double-entry
 * vouchers, auto-posting from the M16 money events, the eight reports,
 * budgets and the period close.
 *
 * **Direction of the M16 integration.** FeeModule *emits*
 * `payment.success` / `payment.refunded`; this module *listens*
 * (`events/accounting.listener.ts`). Fees never learn that accounting
 * exists, so a school running without a ledger loses nothing — the M08
 * `teacher.leave.approved` → M12 pattern.
 *
 * That one-way event edge is also what lets AccountingModule *import*
 * FeeModule safely: auto-posting needs the invoice a payment settled, and
 * FeeModule already exports the reads for it. Nothing in FeeModule
 * imports back, so the graph stays acyclic. M21 payroll will import THIS
 * module the same way, for the salary-disbursement posting the roadmap
 * hands it.
 *
 * `SchoolModule` supplies SettingsService and the school profile printed
 * on statements; `SequenceModule` the gap-free DV/CV/JV/CN numbers;
 * `RbacModule` the runtime check behind `accounting.period.reopen`.
 * `PrismaService` reaches AutoPostingService through the global
 * PrismaModule — the payment + invoice-item read it needs is a narrow
 * cross-module query, the `AudienceRepository`/`DashboardRepository`
 * precedent.
 */
@Module({
  imports: [SchoolModule, SequenceModule, RbacModule, FeeModule],
  controllers: [
    AccountsController,
    VouchersController,
    AccountingController,
    BudgetsController,
    FiscalPeriodsController,
  ],
  providers: [
    AccountsService,
    VoucherService,
    PostingMapService,
    AutoPostingService,
    FiscalPeriodService,
    BudgetService,
    AccountingReportsService,
    AccountingExportService,
    AccountingToolsService,
    AccountingSettingsService,
    AccountingListener,
    AccountsRepository,
    VouchersRepository,
    AccountingConfigRepository,
    // Stateless re-provision (needs PrismaService only) — the M07 convention.
    SchoolsRepository,
  ],
  // M21 payroll posts salary disbursements through `VoucherService.postAuto`
  // with source PAYROLL; M24/M25/M26 do the same for their own vouchers.
  exports: [VoucherService, PostingMapService, AccountingReportsService],
})
export class AccountingModule {}
