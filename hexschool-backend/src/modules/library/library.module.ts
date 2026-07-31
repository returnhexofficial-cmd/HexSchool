import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module';
import { AccountingModule } from '../accounting/accounting.module';
import { CommunicationModule } from '../communication/communication.module';
import { RbacModule } from '../rbac/rbac.module';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { SequenceModule } from '../sequence/sequence.module';
import { CatalogController } from './controllers/catalog.controller';
import { CirculationController } from './controllers/circulation.controller';
import { LibraryReportsController } from './controllers/library-reports.controller';
import { LibraryOverdueJob } from './jobs/library-overdue.job';
import { BookCopiesRepository } from './repositories/book-copies.repository';
import {
  AuthorsRepository,
  BookCategoriesRepository,
  BooksRepository,
  PublishersRepository,
} from './repositories/catalog.repository';
import {
  BookIssuesRepository,
  BookReservationsRepository,
} from './repositories/circulation.repository';
import { LibraryDirectoryRepository } from './repositories/library-directory.repository';
import { LibraryMembersRepository } from './repositories/library-members.repository';
import { StockVerificationsRepository } from './repositories/stock-verification.repository';
import { BookCopiesService } from './services/book-copies.service';
import { CatalogService } from './services/catalog.service';
import { CirculationService } from './services/circulation.service';
import { LibraryClearanceService } from './services/library-clearance.service';
import { LibraryExportService } from './services/library-export.service';
import { LibraryFinesService } from './services/library-fines.service';
import { LibraryMembersService } from './services/library-members.service';
import { LibraryNotificationsService } from './services/library-notifications.service';
import { LibraryPostingService } from './services/library-posting.service';
import { LibraryReportsService } from './services/library-reports.service';
import { LibrarySettingsService } from './services/library-settings.service';
import { OpacService } from './services/opac.service';
import { ReservationsService } from './services/reservations.service';
import { StockVerificationService } from './services/stock-verification.service';

/**
 * Module 23 — Library Management: the catalogue, the copies on the
 * shelves, the cards, and the circulation loop that connects them.
 *
 * **Direction of the integrations.** Everything this module needs, it
 * imports:
 *
 *   - `SchoolModule` for settings, `RbacModule` for the two runtime
 *     permission checks (`library.issue.override`,
 *     `library.fine.collect` at the return desk),
 *   - `SequenceModule` for gap-free accession and card numbers,
 *   - `AcademicModule` for `CalendarService.workingDays`, which is what
 *     makes the overdue fine holiday-aware,
 *   - `CommunicationModule` for `NotificationService.send()` (M17),
 *   - `AccountingModule` for `VoucherService.postAuto` (M20) — the same
 *     door M21's payroll posts through.
 *
 * It deliberately does **not** import `StudentModule`, `TeacherModule`
 * or `HrModule`. A library card is polymorphic over all three, and
 * resolving a card to a name needs one column from each — so
 * `LibraryDirectoryRepository` reads them over PrismaService, the M12
 * `EmployeeDirectoryRepository` / M17 `AudienceRepository` / M18
 * `DashboardRepository` / M19 `PublicSiteRepository` / M22 policy-query
 * precedent. That also keeps the graph honest about the dependency: the
 * library needs to know *who people are*, not how they are managed.
 *
 * Not importing them is what makes the M09 clearance hook possible at
 * all. `LibraryClearanceService` depends on PrismaService alone and is
 * provided a **second time inside StudentModule**, bound to the
 * `LIBRARY_CLEARANCE` token — the M13 `RoutineConflictChecker` pattern.
 * The alternative, StudentModule importing LibraryModule, would close a
 * cycle through AccountingModule → FeeModule → StudentModule.
 *
 * Nothing imports LibraryModule back except the leaf `PortalModule`
 * (M18), which composes `OpacService` into `/portal/library`.
 */
@Module({
  imports: [
    SchoolModule,
    RbacModule,
    SequenceModule,
    AcademicModule,
    CommunicationModule,
    AccountingModule,
  ],
  controllers: [
    CatalogController,
    CirculationController,
    LibraryReportsController,
  ],
  providers: [
    LibrarySettingsService,
    CatalogService,
    BookCopiesService,
    LibraryMembersService,
    CirculationService,
    LibraryFinesService,
    LibraryPostingService,
    ReservationsService,
    StockVerificationService,
    LibraryReportsService,
    LibraryExportService,
    LibraryNotificationsService,
    LibraryClearanceService,
    OpacService,
    LibraryOverdueJob,
    BookCategoriesRepository,
    AuthorsRepository,
    PublishersRepository,
    BooksRepository,
    BookCopiesRepository,
    LibraryMembersRepository,
    BookIssuesRepository,
    BookReservationsRepository,
    StockVerificationsRepository,
    LibraryDirectoryRepository,
    // Stateless re-provision (PrismaService only) — the M07 convention.
    SchoolsRepository,
  ],
  // For M18's portal panels and M27's certificate clearance. Every one
  // of these is injected by a consumer outside this module, and a
  // service a consumer injects but the module does not export compiles
  // cleanly and then fails to boot — the M18/M21 lesson, twice learned.
  exports: [
    OpacService,
    LibraryClearanceService,
    LibraryReportsService,
    LibraryMembersService,
    LibrarySettingsService,
  ],
})
export class LibraryModule {}
