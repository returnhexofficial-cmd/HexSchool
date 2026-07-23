import { Injectable, Logger } from '@nestjs/common';
import { Notification, NotificationChannel, Prisma } from '@prisma/client';
import { DEFAULT_SCHOOL_ID } from '../../../common/constants';
import { dhakaToday } from '../../../common/utils/clock.util';
import { segmentSms } from '../calc/sms-parts.util';
import { EmailAdapter } from '../adapters/email.adapter';
import { HttpSmsAdapter } from '../adapters/http-sms.adapter';
import { LogSmsAdapter } from '../adapters/log-sms.adapter';
import { SmsAdapter } from '../adapters/sms.adapter';
import { AudienceRepository } from '../repositories/audience.repository';
import { NotificationsRepository } from '../repositories/notifications.repository';
import { CommunicationSettingsService } from './communication-settings.service';
import { SmsCreditService } from './sms-credit.service';

/**
 * The delivery worker's brain (roadmap M17 §4). Loads a QUEUED
 * `notifications` row, sends it through the configured gateway, and
 * records the outcome + SMS cost + credit consumption. Kept out of the
 * BullMQ processor class so it is unit-testable without a queue.
 *
 * Credit rule: a metered school's send is refused before it goes out when
 * the balance cannot cover its parts (FAILED, not silently dropped); the
 * consume is recorded only after the gateway accepts it.
 *
 * A thrown adapter error (network) propagates so BullMQ retries; a
 * definitive `accepted:false` marks FAILED without a retry.
 */
@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(
    private readonly notifications: NotificationsRepository,
    private readonly config: CommunicationSettingsService,
    private readonly credits: SmsCreditService,
    private readonly httpSms: HttpSmsAdapter,
    private readonly logSms: LogSmsAdapter,
    private readonly email: EmailAdapter,
    private readonly audience: AudienceRepository,
  ) {}

  /**
   * Deliver a stored notification. Idempotent: a row already SENT/
   * DELIVERED/CANCELLED is skipped (a DLR or a duplicate job may have
   * moved it).
   */
  async dispatch(notificationId: string): Promise<void> {
    const row = await this.notifications.findById(notificationId);
    if (!row) {
      this.logger.warn(
        `Notification ${notificationId} vanished before dispatch`,
      );
      return;
    }
    if (row.status !== 'QUEUED') return; // already handled

    if (row.channel === NotificationChannel.SMS) return this.dispatchSms(row);
    if (row.channel === NotificationChannel.EMAIL)
      return this.dispatchEmail(row);
    // IN_APP is never queued; if one slips through, it is already delivered.
  }

  /**
   * Legacy raw jobs (M02 OTP, M07 welcome/reset credentials still push
   * `{type:'sms'|'email'}`). Record a RAW delivery row scoped to the
   * default school and send it through the same pipeline, so those
   * messages are now real *and* logged — not the old log-only stub.
   */
  async dispatchRaw(
    channel: NotificationChannel,
    to: string,
    text: string,
    subject?: string,
  ): Promise<void> {
    const row = await this.notifications.createRow({
      schoolId: DEFAULT_SCHOOL_ID,
      channel,
      recipientType: 'RAW',
      destination: to,
      subject,
      bodyRendered: text,
      status: 'QUEUED',
    });
    await this.dispatch(row.id);
  }

  private async dispatchSms(row: Notification): Promise<void> {
    const cfg = await this.config.load(row.schoolId);
    const parts = row.segments ?? segmentSms(row.bodyRendered).segments;

    // Credit gate — refuse before sending on a metered, empty account.
    const metered = await this.credits.isMetered(row.schoolId);
    if (metered) {
      const balance = await this.credits.balance(row.schoolId);
      if (balance < parts) {
        await this.fail(row, 'Insufficient SMS credit');
        await this.lowCreditAlert(
          row.schoolId,
          balance,
          cfg.lowCreditThreshold,
        );
        return;
      }
    }

    const adapter: SmsAdapter = this.httpSms.isConfigured(cfg.sms)
      ? this.httpSms
      : this.logSms;

    const result = await adapter.send(
      {
        to: row.destination ?? '',
        text: row.bodyRendered,
        unicode: segmentSms(row.bodyRendered).unicode,
      },
      cfg.sms,
    );

    if (!result.accepted) {
      await this.fail(row, result.error ?? 'Gateway rejected the message');
      return;
    }

    // Consume before flipping the row SENT (bill for what the gateway
    // accepted). Consuming first makes a SENT row a guarantee the ledger
    // already moved — no window where the message is sent but unbilled.
    let lowBalance: number | null = null;
    if (metered) {
      const consumed = await this.credits.consume(
        row.schoolId,
        parts,
        `SMS ${row.id}`,
      );
      if (consumed.balance <= cfg.lowCreditThreshold) lowBalance = consumed.balance;
    }

    await this.notifications.markStatus(row.id, {
      status: 'SENT',
      sentAt: new Date(),
      providerMsgId: result.providerMsgId ?? undefined,
      error: null,
    });

    if (lowBalance !== null) {
      await this.lowCreditAlert(row.schoolId, lowBalance, cfg.lowCreditThreshold);
    }
  }

  private async dispatchEmail(row: Notification): Promise<void> {
    const cfg = await this.config.load(row.schoolId);
    const result = await this.email.send(
      {
        to: row.destination ?? '',
        subject: row.subject ?? 'Notification',
        text: row.bodyRendered,
      },
      cfg.email,
    );
    if (!result.accepted) {
      await this.fail(row, result.error ?? 'SMTP rejected the message');
      return;
    }
    await this.notifications.markStatus(row.id, {
      status: 'SENT',
      sentAt: new Date(),
      providerMsgId: result.providerMsgId ?? undefined,
      error: null,
    });
  }

  private async fail(row: Notification, error: string): Promise<void> {
    await this.notifications.markStatus(row.id, {
      status: 'FAILED',
      error: error.slice(0, 500),
    });
  }

  /** Force a still-QUEUED row to FAILED after the last retry is exhausted. */
  async forceFail(notificationId: string, error: string): Promise<void> {
    const row = await this.notifications.findById(notificationId);
    if (!row || row.status !== 'QUEUED') return;
    await this.fail(row, error || 'Delivery failed after retries');
  }

  /**
   * In-app low-credit alert (roadmap M17 §4). One IN_APP row per admin
   * user, deduped per calendar day (so a busy day out of credit does not
   * bury the bell). It never sends an SMS — impossible when out of credit
   * — and never consumes credit, so there is no recursion.
   */
  private async lowCreditAlert(
    schoolId: string,
    balance: number,
    threshold: number,
  ): Promise<void> {
    if (balance > threshold) return;
    const admins = await this.audience.adminUserIds(schoolId);
    const today = dhakaToday();
    const body = `SMS credit is low: ${balance} parts left (threshold ${threshold}). Top up to keep alerts flowing.`;
    for (const userId of admins) {
      try {
        await this.notifications.createRow({
          schoolId,
          channel: 'IN_APP',
          recipientType: 'USER',
          recipientId: userId,
          templateCode: 'LOW_SMS_CREDIT',
          bodyRendered: body,
          status: 'SENT',
          isEmergency: false,
          dedupeKey: `lowcredit|${userId}|${today}`,
          sentAt: new Date(),
        });
      } catch (error) {
        // Already alerted this admin today (dedupe unique) — fine.
        if (!(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )) {
          this.logger.warn(
            `Could not write low-credit alert: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
  }
}
