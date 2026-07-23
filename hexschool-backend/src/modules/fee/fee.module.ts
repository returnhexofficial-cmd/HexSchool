import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NOTIFICATIONS_QUEUE } from '../../queues/queues.constants';
import { AcademicModule } from '../academic/academic.module';
import { ClassesRepository } from '../academic/repositories/classes.repository';
import { EnrollmentModule } from '../enrollment/enrollment.module';
import { RbacModule } from '../rbac/rbac.module';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { SequenceModule } from '../sequence/sequence.module';
import { StudentGuardiansRepository } from '../student/repositories/student-guardians.repository';
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
    // `notifications` carries receipt and dues SMS (M02's shared queue,
    // log-only until M17 wires the gateway).
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
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
  ],
})
export class FeeModule {}
