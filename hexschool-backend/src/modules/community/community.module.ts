import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { RecaptchaService } from '../admission/services/recaptcha.service';
import { CommunicationModule } from '../communication/communication.module';
import { RbacModule } from '../rbac/rbac.module';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { SequenceModule } from '../sequence/sequence.module';
import { StorageModule } from '../storage/storage.module';
import {
  AlumniController,
  AlumniEventsController,
  DonationsController,
} from './controllers/alumni.controller';
import { PublicCommunityController } from './controllers/public-community.controller';
import { TicketsController } from './controllers/tickets.controller';
import {
  AppointmentsController,
  VisitorsController,
} from './controllers/visitors.controller';
import { TicketSlaJob } from './jobs/ticket-sla.job';
import { VisitorAutoCheckoutJob } from './jobs/visitor-auto-checkout.job';
import {
  AlumniEventRegistrationsRepository,
  AlumniEventsRepository,
  AlumniRepository,
  DonationsRepository,
} from './repositories/alumni.repository';
import { CommunityDirectoryRepository } from './repositories/community-directory.repository';
import {
  TicketCommentsRepository,
  TicketsRepository,
} from './repositories/tickets.repository';
import {
  AppointmentsRepository,
  VisitorsRepository,
} from './repositories/visitors.repository';
import { AlumniEventsService } from './services/alumni-events.service';
import { AlumniService } from './services/alumni.service';
import { CommunityExportService } from './services/community-export.service';
import { CommunityNotificationsService } from './services/community-notifications.service';
import { CommunityPdfService } from './services/community-pdf.service';
import { CommunityReportsService } from './services/community-reports.service';
import { CommunitySettingsService } from './services/community-settings.service';
import { DonationPostingService } from './services/donation-posting.service';
import { DonationsService } from './services/donations.service';
import { TicketsService } from './services/tickets.service';
import { VisitorsService } from './services/visitors.service';

/**
 * Module 28 — Complaint, Visitor & Alumni Management: the complaints the
 * school receives, the people who walk through its gate, and the students
 * who left it.
 *
 * **The import list is short, and what is missing from it is the point.**
 * All three thirds of this module are *about* people the system already
 * knows — a guardian who complains, a teacher a visitor asks for, a
 * graduate claiming their place in the directory — and the naive reading
 * is that it must therefore import Student, Teacher, Staff and Enrollment.
 * It does not. What it needs from those four is a handful of columns, and
 * those come from a narrow `CommunityDirectoryRepository` over
 * PrismaService — the M12 `EmployeeDirectoryRepository` / M17
 * `AudienceRepository` / M18 `DashboardRepository` / M19
 * `PublicSiteRepository` / M22 policy-query / M23
 * `LibraryDirectoryRepository` / M24 `InventoryDirectoryRepository`
 * precedent, **eighth use**. As in M19, the SELECT list in that repository
 * IS the privacy policy: a complaint's requester resolves to a name and a
 * contact and nothing else.
 *
 * What it does import, and why each one:
 *   - `SchoolModule` — the `community.*` settings and the school row every
 *     numbered document is rendered against,
 *   - `SequenceModule` — three gap-free number series (ticket, gate pass,
 *     donation receipt), all claimed inside their write transaction,
 *   - `CommunicationModule` — every outbound message goes through
 *     `NotificationService.send()` (the M17 single-entry-point rule),
 *   - `AccountingModule` — a donation posts through
 *     `VoucherService.postAuto` with the new `VoucherSource.DONATION`,
 *     the sixth module to use M20's append-only door,
 *   - `RbacModule` — `ticket.sensitive.view` is checked in the *service*,
 *     not only at the route, because roadmap §8's restriction has to shape
 *     the query rather than gate the endpoint,
 *   - `StorageModule` — ticket attachments and visitor photographs.
 *
 * `RecaptchaService` is a **stateless re-provision** rather than an
 * AdmissionModule import — the M19 precedent, verbatim, for the same two
 * public forms' worth of reason.
 *
 * **Who imports this module back:** only `PortalModule`, itself a leaf, so
 * the graph stays acyclic. That edge is what finally closes M18's
 * contact-school stub — the portal form used to file into the M19 office
 * inbox and now opens a real ticket thread the family can follow, exactly
 * as M18's own module doc predicted.
 *
 * **Leaves no no-op hooks.**
 */
@Module({
  imports: [
    SchoolModule,
    RbacModule,
    SequenceModule,
    StorageModule,
    CommunicationModule,
    AccountingModule,
  ],
  controllers: [
    TicketsController,
    VisitorsController,
    AppointmentsController,
    AlumniController,
    AlumniEventsController,
    DonationsController,
    PublicCommunityController,
  ],
  providers: [
    CommunitySettingsService,
    TicketsService,
    VisitorsService,
    AlumniService,
    AlumniEventsService,
    DonationsService,
    DonationPostingService,
    CommunityNotificationsService,
    CommunityReportsService,
    CommunityExportService,
    CommunityPdfService,
    TicketsRepository,
    TicketCommentsRepository,
    VisitorsRepository,
    AppointmentsRepository,
    AlumniRepository,
    AlumniEventsRepository,
    AlumniEventRegistrationsRepository,
    DonationsRepository,
    CommunityDirectoryRepository,
    TicketSlaJob,
    VisitorAutoCheckoutJob,
    // Stateless re-provisions (PrismaService / config only) — the
    // M07/M19/M23/M27 convention.
    SchoolsRepository,
    RecaptchaService,
  ],
  // For M18's leaf `PortalModule`. A service a consumer injects but the
  // module does not export compiles cleanly and then fails to boot — the
  // M18 `NotificationsRepository` and M21 `HrSettingsService` lesson,
  // twice learned, and both were found by the e2e run rather than by tsc.
  exports: [
    TicketsService,
    CommunitySettingsService,
    // M29 — the complaint / visitor / donation report shapes. Additive,
    // exactly as M27 added `HostelClearanceService` to M26.
    CommunityReportsService,
  ],
})
export class CommunityModule {}
