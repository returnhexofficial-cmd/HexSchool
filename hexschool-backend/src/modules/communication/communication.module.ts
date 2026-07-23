import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NOTIFICATIONS_QUEUE } from '../../queues/queues.constants';
import { RbacModule } from '../rbac/rbac.module';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { EmailAdapter } from './adapters/email.adapter';
import { HttpSmsAdapter } from './adapters/http-sms.adapter';
import { LogSmsAdapter } from './adapters/log-sms.adapter';
import { NotificationTemplatesController } from './controllers/notification-templates.controller';
import { NotificationsController } from './controllers/notifications.controller';
import { NoticesController } from './controllers/notices.controller';
import { SmsCreditsController } from './controllers/sms-credits.controller';
import { WebhooksController } from './controllers/webhooks.controller';
import { BirthdayWishJob } from './jobs/birthday-wish.job';
import { ScheduledNoticeJob } from './jobs/scheduled-notice.job';
import { NotificationsProcessor } from './processors/notification.processor';
import { AudienceRepository } from './repositories/audience.repository';
import { NoticesRepository } from './repositories/notices.repository';
import { NotificationTemplatesRepository } from './repositories/notification-templates.repository';
import { NotificationsRepository } from './repositories/notifications.repository';
import { SmsCreditsRepository } from './repositories/sms-credits.repository';
import { BulkService } from './services/bulk.service';
import { CommunicationSettingsService } from './services/communication-settings.service';
import { DlrService } from './services/dlr.service';
import { InboxService } from './services/inbox.service';
import { NoticeService } from './services/notice.service';
import { NotificationDispatchService } from './services/notification-dispatch.service';
import { NotificationLogService } from './services/notification-log.service';
import { NotificationService } from './services/notification.service';
import { SmsCreditService } from './services/sms-credit.service';
import { TemplateService } from './services/template.service';

/**
 * Module 17 — Communication & Notifications. The single `Notification
 * Service.send()` entry point every module calls, the BD SMS gateway +
 * SMTP adapters, templates, the in-app inbox, the bulk composer, notices,
 * SMS-credit accounting, and the real BullMQ worker that replaces M02's
 * log-only stub.
 *
 * `SchoolModule` supplies SettingsService (gateway config + the
 * `communication.*` knobs); `RbacModule` the runtime permission check
 * behind the large-blast gate. The audience/school repositories are
 * stateless re-provisions (the M07/M16 convention), so this module owns no
 * import edge back from the producer modules that import IT — the graph
 * stays acyclic (Attendance/Result/Fee/Admission import this module to
 * send; it never imports them).
 */
@Module({
  imports: [
    SchoolModule,
    RbacModule,
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  controllers: [
    NotificationTemplatesController,
    NotificationsController,
    NoticesController,
    SmsCreditsController,
    WebhooksController,
  ],
  providers: [
    NotificationService,
    NotificationDispatchService,
    TemplateService,
    NoticeService,
    BulkService,
    InboxService,
    NotificationLogService,
    SmsCreditService,
    DlrService,
    CommunicationSettingsService,
    NotificationsProcessor,
    BirthdayWishJob,
    ScheduledNoticeJob,
    HttpSmsAdapter,
    LogSmsAdapter,
    EmailAdapter,
    NotificationTemplatesRepository,
    NotificationsRepository,
    NoticesRepository,
    SmsCreditsRepository,
    AudienceRepository,
    // Stateless re-provision (only needs PrismaService).
    SchoolsRepository,
  ],
  // Exported for the producer modules (M10/12/15/16) that retro-wire their
  // queued events through the single entry point.
  exports: [NotificationService],
})
export class CommunicationModule {}
