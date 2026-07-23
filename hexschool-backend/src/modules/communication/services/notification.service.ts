import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  Notification,
  NotificationChannel,
  NotificationLanguage,
  NotificationRecipientType,
  Prisma,
} from '@prisma/client';
import type { Queue } from 'bullmq';
import { dhakaMinutesOfDay } from '../../../common/utils/clock.util';
import {
  NOTIFICATIONS_QUEUE,
  NotificationJob,
} from '../../../queues/queues.constants';
import { dedupeKey } from '../calc/dedupe.util';
import { delayUntilSendable } from '../calc/quiet-hours.util';
import { estimateSmsCost, segmentSms } from '../calc/sms-parts.util';
import { renderTemplate } from '../calc/template.engine';
import { notificationCode } from '../communication.constants';
import { NotificationTemplatesRepository } from '../repositories/notification-templates.repository';
import { NotificationsRepository } from '../repositories/notifications.repository';
import { CommunicationSettingsService } from './communication-settings.service';

export interface SendRecipient {
  type: NotificationRecipientType;
  id?: string | null;
  /** Phone (SMS) or email (EMAIL); NULL for IN_APP. */
  destination?: string | null;
}

export interface SendNotificationInput {
  schoolId: string;
  code: string;
  channel: NotificationChannel;
  recipient: SendRecipient;
  vars?: Record<string, unknown>;
  language?: NotificationLanguage;
  /** Bypass quiet hours + rate spreading (roadmap M17 §6). */
  emergency?: boolean;
  /** Collapse a repeat (destination, code) inside the dedupe window. */
  dedupe?: boolean;
  /** Idempotency key of the bulk composer session that produced this row. */
  batchKey?: string;
  createdBy?: string | null;
  /** Skip template lookup and use this body verbatim (raw/ad-hoc send). */
  rawBody?: string;
  rawSubject?: string;
  /** Extra queue delay for rate spreading a bulk chunk. */
  extraDelayMs?: number;
}

/**
 * THE single entry point every module calls to send a message (roadmap
 * M17 §4/§6 "all module-originated messages must go through
 * NotificationService — no direct gateway calls"). It renders the
 * template, applies quiet hours and dedupe, records a `notifications` row
 * and enqueues the work; the queue worker (`NotificationDispatchService`)
 * does the actual delivery.
 *
 * IN_APP is stored, not queued — the row *is* the message a portal bell
 * reads, so it is written SENT immediately.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly templates: NotificationTemplatesRepository,
    private readonly notifications: NotificationsRepository,
    private readonly config: CommunicationSettingsService,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly queue: Queue<NotificationJob>,
  ) {}

  async send(input: SendNotificationInput): Promise<Notification | null> {
    const cfg = await this.config.load(input.schoolId);
    const language = input.language ?? cfg.defaultLanguage;
    const vars = input.vars ?? {};

    const resolved = await this.resolveBody(input, language);
    if (resolved === null) {
      this.logger.warn(
        `No template or default body for code ${input.code}/${input.channel} — nothing sent`,
      );
      return null;
    }
    const bodyRendered = renderTemplate(resolved.body, vars);
    const subjectRendered = resolved.subject
      ? renderTemplate(resolved.subject, vars)
      : null;

    // ── IN_APP: stored, not dispatched ──────────────────────────────────
    if (input.channel === NotificationChannel.IN_APP) {
      return this.notifications.createRow({
        schoolId: input.schoolId,
        channel: NotificationChannel.IN_APP,
        recipientType: input.recipient.type,
        recipientId: input.recipient.id ?? undefined,
        templateCode: input.code,
        payload: vars as Prisma.InputJsonValue,
        subject: subjectRendered ?? undefined,
        bodyRendered,
        status: 'SENT',
        isEmergency: input.emergency ?? false,
        batchKey: input.batchKey ?? undefined,
        sentAt: new Date(),
        createdBy: input.createdBy ?? undefined,
      });
    }

    // ── SMS / EMAIL: queued for delivery ────────────────────────────────
    const destination = input.recipient.destination?.trim();
    if (!destination) {
      this.logger.warn(
        `No ${input.channel} destination for code ${input.code} — nothing sent`,
      );
      return null;
    }

    let segments: number | undefined;
    let cost: number | undefined;
    if (input.channel === NotificationChannel.SMS) {
      segments = segmentSms(bodyRendered).segments;
      cost = estimateSmsCost(
        bodyRendered,
        cfg.smsRatePerPart,
        cfg.smsUnicodeRatePerPart,
      );
    }

    const key = input.dedupe
      ? dedupeKey(destination, input.code, cfg.dedupeWindowMinutes, Date.now())
      : undefined;

    // Quiet hours only hold SMS; email is not intrusive at night.
    let delayMs = input.extraDelayMs ?? 0;
    if (
      input.channel === NotificationChannel.SMS &&
      cfg.quietHoursEnabled &&
      !input.emergency
    ) {
      const quietDelayMin = delayUntilSendable(
        dhakaMinutesOfDay(),
        cfg.quietStartMin,
        cfg.quietEndMin,
      );
      delayMs += quietDelayMin * 60_000;
    }

    let row: Notification;
    try {
      row = await this.notifications.createRow({
        schoolId: input.schoolId,
        channel: input.channel,
        recipientType: input.recipient.type,
        recipientId: input.recipient.id ?? undefined,
        destination,
        templateCode: input.code,
        payload: vars as Prisma.InputJsonValue,
        subject: subjectRendered ?? undefined,
        bodyRendered,
        status: 'QUEUED',
        isEmergency: input.emergency ?? false,
        segments,
        cost,
        dedupeKey: key,
        batchKey: input.batchKey ?? undefined,
        createdBy: input.createdBy ?? undefined,
      });
    } catch (error) {
      // The dedupe partial unique refused a repeat inside the window.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.debug(
          `Deduped ${input.code} to ${destination} (already queued this window)`,
        );
        return null;
      }
      throw error;
    }

    await this.queue
      .add(
        'notification',
        {
          type: 'notification',
          notificationId: row.id,
          schoolId: input.schoolId,
        },
        delayMs > 0 ? { delay: delayMs } : undefined,
      )
      .catch((err: Error) => {
        // Fire-and-forget enqueue (the M07 rule: delivery never blocks a
        // mutation). The row is QUEUED and the reconcile-style retry path
        // can re-drive it; log loudly.
        this.logger.error(
          `Failed to enqueue notification ${row.id}: ${err.message}`,
        );
      });

    return row;
  }

  /** Re-enqueue a FAILED notification for another delivery attempt. */
  async requeue(row: Notification): Promise<void> {
    await this.notifications.markStatus(row.id, {
      status: 'QUEUED',
      error: null,
    });
    await this.queue.add('notification', {
      type: 'notification',
      notificationId: row.id,
      schoolId: row.schoolId,
    });
  }

  private async resolveBody(
    input: SendNotificationInput,
    language: NotificationLanguage,
  ): Promise<{ body: string; subject: string | null } | null> {
    if (input.rawBody) {
      return { body: input.rawBody, subject: input.rawSubject ?? null };
    }
    const template =
      (await this.templates.findActive(
        input.schoolId,
        input.code,
        input.channel,
        language,
      )) ??
      // Fall back to EN when a BN template is not authored yet.
      (language !== 'EN'
        ? await this.templates.findActive(
            input.schoolId,
            input.code,
            input.channel,
            'EN',
          )
        : null);
    if (template) {
      return { body: template.body, subject: template.subject ?? null };
    }
    // Before a school seeds templates, fall back to the registry default
    // so the system talks on day one.
    const def = notificationCode(input.code);
    if (def)
      return { body: def.defaultBody, subject: def.defaultSubject ?? null };
    return null;
  }
}
