import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module';
import { ClassesRepository } from '../academic/repositories/classes.repository';
import { CommunicationModule } from '../communication/communication.module';
import { EnrollmentModule } from '../enrollment/enrollment.module';
import { RbacModule } from '../rbac/rbac.module';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { SequenceModule } from '../sequence/sequence.module';
import { StudentGuardiansRepository } from '../student/repositories/student-guardians.repository';
import { HostelFeeService } from '../hostel/services/hostel-fee.service';
import { HOSTEL_FEE_SOURCE } from '../hostel/hostel.constants';
import { TransportFeeService } from '../transport/services/transport-fee.service';
import { TRANSPORT_FEE_SOURCE } from '../transport/transport.constants';
import { FeeHeadsController } from './controllers/fee-setup.controller';
import {
  FeeOverridesController,
  FeeStructuresController,
} from './controllers/fee-setup.controller';
import { FeeReportsController } from './controllers/fee-reports.controller';
import {
  InvoicesController,
  PaymentsController,
  StudentFeesController,
} from './controllers/invoices.controller';
import { BkashAdapter } from './gateways/bkash.adapter';
import { NagadAdapter } from './gateways/nagad.adapter';
import { SslcommerzAdapter } from './gateways/sslcommerz.adapter';
import { FineJob } from './jobs/fine.job';
import { ReconciliationJob } from './jobs/reconciliation.job';
import { FeeHeadsRepository } from './repositories/fee-heads.repository';
import { FeeOverridesRepository } from './repositories/fee-overrides.repository';
import { FeeStructuresRepository } from './repositories/fee-structures.repository';
import { InvoicesRepository } from './repositories/invoices.repository';
import { PaymentsRepository } from './repositories/payments.repository';
import { CollectionService } from './services/collection.service';
import { FeeExportService } from './services/fee-export.service';
import { FeeReportsService } from './services/fee-reports.service';
import { FeeSettingsService } from './services/fee-settings.service';
import { FeeSetupService } from './services/fee-setup.service';
import { InvoiceService } from './services/invoice.service';
import { LedgerService } from './services/ledger.service';
import { PaymentGatewayService } from './services/payment-gateway.service';

/**
 * Module 16 — Fees & Payments: fee heads and the class × head amount
 * matrix, per-student concessions, monthly and ad-hoc invoicing with
 * proration, the collection desk, refunds, the three BD gateways, the
 * dues ledger, late fines and the money reports.
 *
 * `AcademicModule` supplies SessionsService; `EnrollmentModule` the
 * canonical roster every invoice keys on; `SchoolModule` settings and
 * the school profile printed on receipts; `SequenceModule` the gap-free
 * invoice and receipt numbers; `RbacModule` the runtime permission
 * checks behind the waiver and overpayment overrides. The remaining
 * repositories are stateless re-provisions (the M07 convention).
 *
 * `InvoiceDuesGate` lives here but is bound to `EXAM_DUES_GATE` **inside
 * ExamModule** — see `services/dues.gate.ts` for why that direction.
 */
@Module({
  imports: [
    AcademicModule,
    EnrollmentModule,
    SchoolModule,
    SequenceModule,
    RbacModule,
    // M17: receipt SMS goes through NotificationService (FEE_RECEIPT template).
    CommunicationModule,
  ],
  controllers: [
    FeeHeadsController,
    FeeStructuresController,
    FeeOverridesController,
    InvoicesController,
    PaymentsController,
    StudentFeesController,
    FeeReportsController,
  ],
  providers: [
    FeeSetupService,
    InvoiceService,
    CollectionService,
    PaymentGatewayService,
    LedgerService,
    FeeReportsService,
    FeeExportService,
    FeeSettingsService,
    FineJob,
    ReconciliationJob,
    SslcommerzAdapter,
    BkashAdapter,
    NagadAdapter,
    FeeHeadsRepository,
    FeeStructuresRepository,
    FeeOverridesRepository,
    InvoicesRepository,
    PaymentsRepository,
    // Stateless re-provisions (only need PrismaService).
    ClassesRepository,
    SchoolsRepository,
    StudentGuardiansRepository,
    // M25 — the transport line on a monthly bill. `TransportFeeService`
    // depends on PrismaService + SettingsService alone, so it is bound
    // HERE rather than imported: FeeModule importing TransportModule
    // would close a cycle (Transport → Accounting → Fee). The M13
    // `RoutineConflictChecker` / M23 `LIBRARY_CLEARANCE` pattern, and the
    // token is ALWAYS bound — a school with no routes simply gets an
    // empty map (the M08/M14 "the call site is what gets forgotten"
    // rule).
    { provide: TRANSPORT_FEE_SOURCE, useClass: TransportFeeService },
    // M26 — the hostel and mess lines on a monthly bill. Same shape and
    // the same reason, one module later: `HostelFeeService` depends on
    // PrismaService + SettingsService alone, and HostelModule imports
    // THIS module (for `LedgerService.outstandingFor` at the vacate
    // gate), so importing HostelModule here would close the cycle
    // directly. Always bound — a school with no hostel gets an empty map.
    { provide: HOSTEL_FEE_SOURCE, useClass: HostelFeeService },
  ],
  // M09 exit-status clearance, M14 admit cards and M27 certificates all
  // read the ledger; M18 portals render dues and invoices.
  // `PaymentGatewayService` is exported so M10 can take an admission fee
  // through the same adapters (roadmap M16 §4 "admission payment
  // interface wired to same adapters") — AdmissionModule imports this
  // one, never the reverse.
  exports: [
    LedgerService,
    InvoicesRepository,
    InvoiceService,
    PaymentGatewayService,
    // M29 — the money report shapes the analytics module renders to
    // spreadsheets. Additive, and the same reason M12/M20/M21/M23/M24/
    // M25/M26 export theirs: a report has to be the module's own numbers,
    // or the sheet and the screen drift apart.
    FeeReportsService,
  ],
})
export class FeeModule {}
