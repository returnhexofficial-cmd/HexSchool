import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RecaptchaService } from '../admission/services/recaptcha.service';
import { CERTIFICATE_VERIFIER } from '../document/document.constants';
import { CertificateVerifierService } from '../document/services/certificate-verifier.service';
import { CommunicationModule } from '../communication/communication.module';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { StorageModule } from '../storage/storage.module';
import { CmsController } from './controllers/cms.controller';
import { PublicSiteController } from './controllers/public-site.controller';
import {
  CareerApplicationsRepository,
  CareersRepository,
  CmsPagesRepository,
  CommitteeMembersRepository,
  ContactMessagesRepository,
  DownloadsRepository,
  FaqsRepository,
  GalleriesRepository,
  GalleryItemsRepository,
  NewsPostsRepository,
} from './repositories/cms-content.repository';
import { PublicSiteRepository } from './repositories/public-site.repository';
import { CareerService } from './services/career.service';
import { CmsPageService } from './services/cms-page.service';
import { ContactService } from './services/contact.service';
import { DownloadService } from './services/download.service';
import { GalleryService } from './services/gallery.service';
import { NewsService } from './services/news.service';
import { PreviewTokenService } from './services/preview-token.service';
import { PublicSiteService } from './services/public-site.service';
import { SiteContentService } from './services/site-content.service';
import { SitemapService } from './services/sitemap.service';
import { WebsiteCacheService } from './services/website-cache.service';
import { WebsiteSettingsService } from './services/website-settings.service';

/**
 * Module 19 — Website CMS. The school's public face: CMS pages, news,
 * galleries, downloads, careers, FAQs, the committee, the contact inbox,
 * and the `@Public()` read API the Next.js site renders from — plus
 * sitemap/robots/RSS and the student-verification endpoint.
 *
 * **Graph shape.** Like `PortalModule` (M18) this is close to a leaf: it
 * imports `SchoolModule` (SettingsService), `CommunicationModule` (the
 * single send entry point, for the contact-form and career alerts) and
 * `StorageModule` (download files and CVs), and nothing imports it back.
 * What it does NOT do is import the five feature modules whose data the
 * public site shows — Academic, Teacher, Student, Enrollment,
 * Communication's notices. Every one of those reads is privacy-shaped
 * (the SELECT list *is* the policy), so they live in the narrow
 * `PublicSiteRepository` instead, the `AudienceRepository` (M17) /
 * `DashboardRepository` (M18) precedent.
 *
 * `RecaptchaService` and `SchoolsRepository` are stateless re-provisions
 * (ConfigService / PrismaService only) — the M17 convention for reusing
 * another module's un-exported provider without an import edge.
 *
 * `ContactService` is the one export: M18's portal "Contact School" form
 * lands in the same office inbox rather than inventing a second one, so
 * PortalModule (a leaf) imports this module. The edge points one way.
 *
 * **Closed by Module 27:** `GET /public/verify/certificate` answered
 * `{ available: false, reason }` from M19 (the M09 self-describing-stub
 * pattern) and now performs a real lookup. The verifier is bound HERE
 * behind `CERTIFICATE_VERIFIER` rather than imported:
 * `CertificateVerifierService` depends on PrismaService alone, so
 * providing it a second time costs nothing, while importing DocumentModule
 * would pull Student, Enrollment, Result, Attendance and Fee into the
 * public site's graph for one lookup — and would reverse an edge the leaf
 * PortalModule already relies on. Same shape as M13's
 * `RoutineConflictChecker` and M23's `LIBRARY_CLEARANCE`; the token is
 * **always bound**, never conditional (the M08/M14 lesson).
 */
@Module({
  imports: [
    SchoolModule,
    CommunicationModule,
    StorageModule,
    // Preview tokens are signed with the access secret, like M10's public
    // phone tokens; the module registers its own JwtModule for that.
    JwtModule.register({}),
  ],
  controllers: [CmsController, PublicSiteController],
  providers: [
    CmsPageService,
    NewsService,
    GalleryService,
    DownloadService,
    CareerService,
    SiteContentService,
    ContactService,
    PublicSiteService,
    SitemapService,
    WebsiteSettingsService,
    WebsiteCacheService,
    PreviewTokenService,
    CmsPagesRepository,
    NewsPostsRepository,
    GalleriesRepository,
    GalleryItemsRepository,
    DownloadsRepository,
    CareersRepository,
    CareerApplicationsRepository,
    FaqsRepository,
    CommitteeMembersRepository,
    ContactMessagesRepository,
    PublicSiteRepository,
    // Stateless re-provisions (see the class doc).
    RecaptchaService,
    SchoolsRepository,
    { provide: CERTIFICATE_VERIFIER, useClass: CertificateVerifierService },
  ],
  exports: [ContactService],
})
export class WebsiteModule {}
