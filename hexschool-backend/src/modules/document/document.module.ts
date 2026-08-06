import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { CommunicationModule } from '../communication/communication.module';
import { EnrollmentModule } from '../enrollment/enrollment.module';
import { FeeModule } from '../fee/fee.module';
import { HostelClearanceService } from '../hostel/services/hostel-clearance.service';
import { LibraryClearanceService } from '../library/services/library-clearance.service';
import { RbacModule } from '../rbac/rbac.module';
import { ResultModule } from '../result/result.module';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { SequenceModule } from '../sequence/sequence.module';
import { StorageModule } from '../storage/storage.module';
import { StudentModule } from '../student/student.module';
import { ArchiveController } from './controllers/archive.controller';
import {
  CertificateTemplatesController,
  CertificatesController,
} from './controllers/certificates.controller';
import {
  ArchiveFilesRepository,
  ArchiveFoldersRepository,
} from './repositories/archive.repository';
import { CertificateTemplatesRepository } from './repositories/certificate-templates.repository';
import { CertificatesRepository } from './repositories/certificates.repository';
import { ArchiveService } from './services/archive.service';
import { CertificateExportService } from './services/certificate-export.service';
import { CertificatePdfService } from './services/certificate-pdf.service';
import { CertificateReportsService } from './services/certificate-reports.service';
import { CertificateTemplatesService } from './services/certificate-templates.service';
import { CertificateVerifierService } from './services/certificate-verifier.service';
import { CertificatesService } from './services/certificates.service';
import { ClearanceService } from './services/clearance.service';
import { DocumentNotificationsService } from './services/document-notifications.service';
import { DocumentPortalService } from './services/document-portal.service';
import { DocumentSettingsService } from './services/document-settings.service';
import { PrizeWizardService } from './services/prize-wizard.service';
import { SnapshotBuilderService } from './services/snapshot-builder.service';

/**
 * Module 27 — Document Management & Certificates: the templates a
 * certificate is printed from, the register of everything issued, the
 * public page that verifies one, and the school's filing cabinet.
 *
 * **This is a near-leaf, like `PortalModule` (M18) and `WebsiteModule`
 * (M19), and that is what licenses the import list.** Nothing imports
 * DocumentModule except PortalModule — itself a leaf — so importing this
 * many modules is cycle-free, and every one of them is here because a
 * certificate quotes a fact that module owns:
 *
 *   - `StudentModule` — the person being certified, and
 *     `StudentsService.updateStatus`, which roadmap §4's TC rule calls,
 *   - `EnrollmentModule` — the class, section and session the snapshot
 *     freezes, and every enrollment the fee clearance sums over,
 *   - `ResultModule` — the GPA and merit position a testimonial quotes,
 *     and the merit list the bulk-prize wizard reads,
 *   - `AttendanceModule` — roadmap §4's attendance %,
 *   - `FeeModule` — `LedgerService.outstandingFor`, which PROJECT_CONTEXT
 *     §11 makes THE dues source for every gate in the system,
 *   - `SequenceModule` — the gap-free per-type, per-year number,
 *   - `CommunicationModule`, `SchoolModule`, `RbacModule`,
 *     `StorageModule` — sending, settings, the override check, and files.
 *
 * **What it does NOT import is as deliberate.** `LibraryModule` and
 * `HostelModule` each own one third of the clearance aggregate, and both
 * expose it through a service that depends on **PrismaService alone** —
 * so both are provided a *second time here* rather than imported. That is
 * the M13 `RoutineConflictChecker` / M23 `LIBRARY_CLEARANCE` shape, and it
 * keeps the dependency honest: what M27 needs is those two modules'
 * **answers**, not library circulation or hostel management, and importing
 * either would drag Accounting, Fee, Communication and Enrollment in
 * behind it.
 *
 * **The outbound edge is a DI token bound in the consumer**, exactly as
 * M19's own module doc predicted: `CertificateVerifierService` also
 * depends on PrismaService alone and is bound inside `WebsiteModule`
 * behind `CERTIFICATE_VERIFIER`, replacing the `{ available: false }` stub
 * M19 left at `GET /public/verify/certificate`. WebsiteModule importing
 * DocumentModule would pull this entire graph into the public site's, and
 * would reverse an edge PortalModule already relies on.
 */
@Module({
  imports: [
    SchoolModule,
    RbacModule,
    SequenceModule,
    StorageModule,
    CommunicationModule,
    EnrollmentModule,
    StudentModule,
    ResultModule,
    AttendanceModule,
    FeeModule,
  ],
  controllers: [
    CertificateTemplatesController,
    CertificatesController,
    ArchiveController,
  ],
  providers: [
    DocumentSettingsService,
    SnapshotBuilderService,
    ClearanceService,
    CertificateTemplatesService,
    CertificatesService,
    CertificatePdfService,
    CertificateVerifierService,
    CertificateReportsService,
    CertificateExportService,
    PrizeWizardService,
    ArchiveService,
    DocumentNotificationsService,
    DocumentPortalService,
    CertificateTemplatesRepository,
    CertificatesRepository,
    ArchiveFoldersRepository,
    ArchiveFilesRepository,
    // Stateless re-provisions (PrismaService only) — the M07/M23 convention.
    SchoolsRepository,
    LibraryClearanceService,
    HostelClearanceService,
  ],
  // For M18's portal panel and M19's public verifier. Every one of these is
  // injected by a consumer outside this module, and a service a consumer
  // injects but the module does not export compiles cleanly and then fails
  // to boot — the M18/M21 lesson, twice learned.
  exports: [
    DocumentPortalService,
    CertificatesService,
    CertificateVerifierService,
    CertificateReportsService,
    ClearanceService,
  ],
})
export class DocumentModule {}
