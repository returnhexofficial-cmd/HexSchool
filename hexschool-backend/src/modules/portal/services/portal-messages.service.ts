import { Injectable } from '@nestjs/common';
import { NotificationRecipientType } from '../../../common/constants';
import { NotificationsRepository } from '../../communication/repositories/notifications.repository';
import { ContactService } from '../../website/services/contact.service';
import { PortalResolverService } from './portal-resolver.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import type { PortalContactDto } from '../dto';

/** How far back the portal's message history reaches. */
const HISTORY_TAKE = 50;

/**
 * The two message-shaped corners of the portal (roadmap M18 §5): the SMS /
 * email history a parent can audit, and the "Contact School" form.
 *
 * Both are **self-scoped by construction**. The history is keyed on the
 * guardian or student row the `PortalResolverService` resolved from the
 * token — there is no id parameter to tamper with, so the IDOR question
 * never arises. The contact form takes the sender's name and phone from
 * that same profile rather than the request body, so a signed-in sender
 * cannot write to the office inbox under someone else's name.
 *
 * The form lands in the **M19 contact inbox** rather than a second table:
 * the office already has a UI, a NEW/READ/REPLIED flow and an in-app alert
 * for it. Module 28's ticket system is what finally replaces this.
 */
@Injectable()
export class PortalMessagesService {
  constructor(
    private readonly resolver: PortalResolverService,
    private readonly notifications: NotificationsRepository,
    private readonly contact: ContactService,
  ) {}

  /**
   * What the school has sent this account — SMS and email, newest first.
   * A parent is keyed as GUARDIAN, a student as STUDENT, which is exactly
   * how the M17 producers recorded the rows.
   */
  async history(actor: AccessTokenPayload) {
    const principal = await this.resolver.principal(actor);
    const target = principal.guardianId
      ? {
          type: NotificationRecipientType.GUARDIAN,
          id: principal.guardianId,
        }
      : principal.studentId
        ? { type: NotificationRecipientType.STUDENT, id: principal.studentId }
        : null;

    if (!target) return { items: [] };

    const rows = await this.notifications.sentHistoryFor(
      actor.schoolId,
      target.type,
      target.id,
      HISTORY_TAKE,
    );
    return {
      items: rows.map((n) => ({
        id: n.id,
        channel: n.channel,
        destination: n.destination,
        templateCode: n.templateCode,
        body: n.bodyRendered,
        status: n.status,
        sentAt: n.sentAt,
        createdAt: n.createdAt,
      })),
    };
  }

  /** Portal "Contact School" → the M19 office inbox. */
  async contactSchool(actor: AccessTokenPayload, dto: PortalContactDto) {
    const sender = await this.resolver.senderIdentity(actor);
    return this.contact.submitFromPortal(actor.schoolId, sender, {
      subject: dto.subject,
      body: dto.body,
    });
  }
}
