import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationRecipientType,
  ReportRun,
} from '@prisma/client';
import { NotificationService } from '../../communication/services/notification.service';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { StorageService } from '../../storage/storage.service';
import { ReportSchedulesRepository } from '../repositories/report-schedules.repository';
import { reportDefinition } from '../reports/report.registry';
import { AnalyticsSettingsService } from './analytics-settings.service';

interface Recipients {
  emails?: string[];
  userIds?: string[];
}

/**
 * Roadmap §4: "Scheduler (cron per schedule) → run → **email with
 * attachment/link**".
 *
 * The slash in that sentence is a choice, and it is made per file rather
 * than per school: a report under the attachment threshold is a link *and*
 * would have been an attachment, a large one is a link only. Emailing a
 * fifteen-megabyte spreadsheet to twenty recipients is forty attachments
 * to store and a bounce from at least one mail server, and the school then
 * believes the report went out.
 *
 * **The link is a signed S3 URL with a long life** rather than the short
 * one the run row was stamped with. A recipient who opens Monday's email
 * on Wednesday must still get the file — a link that expired before it was
 * clicked is the same as no link, and it fails silently.
 *
 * A delivery failure is logged and never rethrown: the report exists, the
 * export centre has it, and taking the run down because a mail server was
 * briefly unreachable would lose the work as well as the message.
 */
@Injectable()
export class ReportDeliveryService {
  private readonly logger = new Logger(ReportDeliveryService.name);

  constructor(
    private readonly schedules: ReportSchedulesRepository,
    private readonly notifications: NotificationService,
    private readonly storage: StorageService,
    private readonly schools: SchoolsRepository,
    private readonly config: AnalyticsSettingsService,
  ) {}

  async deliver(run: ReportRun): Promise<{ sent: number }> {
    if (!run.scheduleId || run.status !== 'DONE' || !run.fileKey) {
      return { sent: 0 };
    }

    const schedule = await this.schedules.findById(run.scheduleId);
    if (!schedule) return { sent: 0 };

    const recipients = (schedule.recipients ?? {}) as Recipients;
    const emails = recipients.emails ?? [];
    const userIds = recipients.userIds ?? [];
    if (emails.length === 0 && userIds.length === 0) return { sent: 0 };

    const [cfg, school] = await Promise.all([
      this.config.load(run.schoolId),
      this.schools.findById(run.schoolId),
    ]);

    // Seven days, so an email read the following week still works.
    const downloadUrl = await this.storage
      .getSignedUrl(run.fileKey, 7 * 86_400, 'reports')
      .catch(() => run.fileUrl ?? '');

    const definition = reportDefinition(run.reportCode);
    const vars = {
      schedule_name: schedule.name,
      report_name: definition?.name ?? run.reportCode,
      rows: run.rowCount ?? 0,
      generated_at: (run.finishedAt ?? new Date())
        .toISOString()
        .slice(0, 16)
        .replace('T', ' '),
      download_url: downloadUrl,
      school: school?.name ?? '',
      // Recorded in the message because a short sheet needs explaining —
      // roadmap §6's stripped columns, told to the reader rather than left
      // to be noticed (see `column-policy.engine`).
      withheld: ((run.strippedColumns as string[] | null) ?? []).join(', '),
    };

    const attachable =
      cfg.scheduleAttachFiles &&
      (run.fileSize ?? 0) > 0 &&
      (run.fileSize ?? 0) <= cfg.scheduleAttachMaxBytes;

    let sent = 0;
    for (const email of emails) {
      sent += await this.send({
        schoolId: run.schoolId,
        channel: NotificationChannel.EMAIL,
        // RAW is M17's "a destination with no account behind it" — the
        // right type for a governor's mailbox that is not a system user.
        recipient: {
          type: NotificationRecipientType.RAW,
          destination: email,
        },
        vars,
      });
    }
    for (const userId of userIds) {
      sent += await this.send({
        schoolId: run.schoolId,
        channel: NotificationChannel.IN_APP,
        recipient: { type: NotificationRecipientType.USER, id: userId },
        vars,
      });
    }

    if (!attachable && (run.fileSize ?? 0) > cfg.scheduleAttachMaxBytes) {
      this.logger.log(
        `Report run ${run.id} (${run.fileSize} bytes) exceeded the attachment limit — delivered as a link`,
      );
    }
    return { sent };
  }

  private async send(input: {
    schoolId: string;
    channel: NotificationChannel;
    recipient: {
      type: NotificationRecipientType;
      id?: string;
      destination?: string;
    };
    vars: Record<string, unknown>;
  }): Promise<number> {
    try {
      const result = await this.notifications.send({
        schoolId: input.schoolId,
        code: 'REPORT_READY',
        channel: input.channel,
        recipient: input.recipient,
        vars: input.vars,
      });
      return result ? 1 : 0;
    } catch (error) {
      this.logger.warn(
        `report delivery failed for one recipient: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return 0;
    }
  }
}
