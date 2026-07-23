import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { DEFAULT_SCHOOL_ID } from '../../../common/constants';
import { NotificationsRepository } from '../repositories/notifications.repository';
import { CommunicationSettingsService } from './communication-settings.service';

/**
 * SMS delivery-report webhook handler (roadmap M17 §4 "delivery-report
 * webhook", §8 "DLR arrives before send-ack recorded → upsert-safe").
 *
 * The provider POSTs the outcome for a message id it was given. We
 * authenticate with a shared secret (a public route otherwise), match the
 * `provider_msg_id` we stored at send, and move the row to DELIVERED or
 * FAILED. A DLR for an unknown id is acknowledged and ignored rather than
 * erroring — providers retry a 4xx and would loop.
 *
 * Multi-tenant public routing is an M31 concern, so the webhook resolves
 * the default school (the M10/M16 public-endpoint precedent).
 */
@Injectable()
export class DlrService {
  private readonly logger = new Logger(DlrService.name);

  constructor(
    private readonly notifications: NotificationsRepository,
    private readonly config: CommunicationSettingsService,
  ) {}

  async handle(
    secret: string | undefined,
    body: Record<string, unknown>,
  ): Promise<{ matched: boolean }> {
    const cfg = await this.config.load(DEFAULT_SCHOOL_ID);
    // When a secret is configured it must match; when none is set the
    // route is effectively disabled to avoid an open status-mutation hole.
    if (!cfg.dlrWebhookSecret || cfg.dlrWebhookSecret !== secret) {
      throw new ForbiddenException('Invalid delivery-report secret');
    }

    const providerMsgId =
      (body.message_id as string | undefined) ??
      (body.messageId as string | undefined) ??
      (body.smsid as string | undefined);
    const statusRaw = body.status ?? body.delivery_status;
    const rawStatus = (
      typeof statusRaw === 'string' || typeof statusRaw === 'number'
        ? String(statusRaw)
        : ''
    ).toUpperCase();
    if (!providerMsgId) return { matched: false };

    const row = await this.notifications.findByProviderMsgId(
      DEFAULT_SCHOOL_ID,
      providerMsgId,
    );
    if (!row) {
      this.logger.debug(
        `DLR for unknown message id ${providerMsgId} — ignored`,
      );
      return { matched: false };
    }

    const delivered = ['DELIVERED', 'DELIVRD', 'SUCCESS', 'SENT'].includes(
      rawStatus,
    );
    if (delivered) {
      await this.notifications.markStatus(row.id, {
        status: 'DELIVERED',
        deliveredAt: new Date(),
        // Ensure the SENT-evidence CHECK holds even if the DLR beat the ack.
        sentAt: row.sentAt ?? new Date(),
      });
    } else {
      await this.notifications.markStatus(row.id, {
        status: 'FAILED',
        error: `Provider reported ${rawStatus || 'FAILED'}`.slice(0, 500),
      });
    }
    return { matched: true };
  }
}
