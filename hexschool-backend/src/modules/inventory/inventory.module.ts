import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { CommunicationModule } from '../communication/communication.module';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { SequenceModule } from '../sequence/sequence.module';
import { InventoryController } from './controllers/inventory.controller';
import { InventoryReportsController } from './controllers/inventory-reports.controller';
import { InventoryAlertsJob } from './jobs/inventory-alerts.job';
import { AssetUnitsRepository } from './repositories/assets.repository';
import {
  ItemCategoriesRepository,
  ItemsRepository,
  SuppliersRepository,
} from './repositories/catalog.repository';
import { InventoryDirectoryRepository } from './repositories/inventory-directory.repository';
import { StockIssuesRepository } from './repositories/issues.repository';
import { PurchasesRepository } from './repositories/purchases.repository';
import { StockLedgerRepository } from './repositories/stock.repository';
import { AssetsService } from './services/assets.service';
import { CatalogService } from './services/catalog.service';
import { InventoryExportService } from './services/inventory-export.service';
import { InventoryNotificationsService } from './services/inventory-notifications.service';
import { InventoryPostingService } from './services/inventory-posting.service';
import { InventoryReportsService } from './services/inventory-reports.service';
import { InventorySettingsService } from './services/inventory-settings.service';
import { PurchasesService } from './services/purchases.service';
import { StockIssuesService } from './services/stock-issues.service';
import { StockService } from './services/stock.service';

/**
 * Module 24 — Inventory & Assets: what the school owns, what it is
 * running out of, who is holding it, and what it paid.
 *
 * **Direction of the integrations.** Everything this module needs, it
 * imports:
 *
 *   - `SchoolModule` for settings and the school record the document
 *     patterns render against,
 *   - `SequenceModule` for gap-free purchase numbers, gate-pass numbers
 *     and asset tags,
 *   - `CommunicationModule` for `NotificationService.send()` (M17) — the
 *     low-stock and warranty sweeps,
 *   - `AccountingModule` for `VoucherService.postAuto` (M20), the same
 *     door M21's payroll, M23's library fines and M25's fuel bills post
 *     through.
 *
 * It imports **no** feature module for the people and departments a gate
 * pass is issued to. A custodian is polymorphic over `teachers` and
 * `staff_profiles`, and resolving one needs a handful of columns from
 * each — so `InventoryDirectoryRepository` reads them narrowly over
 * PrismaService (the M12 `EmployeeDirectoryRepository` / M17
 * `AudienceRepository` / M18 `DashboardRepository` / M19
 * `PublicSiteRepository` / M22 policy-query / M23
 * `LibraryDirectoryRepository` precedent, seventh use). Departments come
 * the same way rather than through AcademicModule, for the same reason:
 * what the store depends on is *who people are*, not staff or academic
 * management.
 *
 * **Nothing imports InventoryModule back.** Unlike M22, M23 and M25 it
 * exports nothing to `PortalModule` — a store has no portal audience,
 * because roadmap §5 gives it no student, parent or teacher surface and
 * inventing one would be a screen with nothing on it for the reader. The
 * services are exported anyway for M29's analytics and M30's hardening,
 * which is the M21 lesson: a service a future consumer injects but the
 * module does not export compiles cleanly and then fails to boot.
 *
 * **It leaves no no-op hooks.** Every integration it declares is bound to
 * a real implementation on the day it ships.
 */
@Module({
  imports: [
    SchoolModule,
    SequenceModule,
    CommunicationModule,
    AccountingModule,
  ],
  controllers: [InventoryController, InventoryReportsController],
  providers: [
    InventorySettingsService,
    StockService,
    CatalogService,
    PurchasesService,
    StockIssuesService,
    AssetsService,
    InventoryReportsService,
    InventoryExportService,
    InventoryPostingService,
    InventoryNotificationsService,
    InventoryAlertsJob,
    SuppliersRepository,
    ItemCategoriesRepository,
    ItemsRepository,
    StockLedgerRepository,
    PurchasesRepository,
    StockIssuesRepository,
    AssetUnitsRepository,
    InventoryDirectoryRepository,
    // Stateless re-provision (PrismaService only) — the M07 convention.
    SchoolsRepository,
  ],
  exports: [
    InventoryReportsService,
    InventorySettingsService,
    StockService,
    AssetsService,
  ],
})
export class InventoryModule {}
