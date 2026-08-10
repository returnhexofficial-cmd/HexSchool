import { BadRequestException, Injectable } from '@nestjs/common';
import { TicketRaiserType } from '@prisma/client';
import { NotificationRecipientType } from '../../../common/constants';
import { NotificationsRepository } from '../../communication/repositories/notifications.repository';
import { TicketsService } from '../../community/services/tickets.service';
import { PortalResolverService } from './portal-resolver.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import type { PortalContactDto, PortalTicketReplyDto } from '../dto';

/** How far back the portal's message history reaches. */
const HISTORY_TAKE = 50;

/**
 * The two message-shaped corners of the portal (roadmap M18 §5): the SMS /
 * email history a parent can audit, and the "Contact School" form.
 *
 * Both are **self-scoped by construction**. The history is keyed on the
 * guardian or student row the `PortalResolverService` resolved from the
 * token — there is no id parameter to tamper with, so the IDOR question
 * never arises. The contact form takes the sender from that same profile
 * rather than the request body, so a signed-in sender cannot write to the
 * school under someone else's name.
 *
 * **Closed by M28.** The form used to file into the M19 office inbox,
 * which had a UI and a NEW/READ/REPLIED flow but no way for the family to
 * see what happened next. It now opens a real **ticket**: the parent gets
 * a reference number, a status they can watch, a thread they can reply on
 * and a satisfaction prompt when it is resolved — exactly what M18's own
 * module doc said M28 would replace it with.
 *
 * The one thing that did **not** change is where the sender comes from.
 */
@Injectable()
export class PortalMessagesService {
  constructor(
    private readonly resolver: PortalResolverService,
    private readonly notifications: NotificationsRepository,
    private readonly tickets: TicketsService,
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

  /** Portal "Contact School" → an M28 ticket the family can follow. */
  async contactSchool(actor: AccessTokenPayload, dto: PortalContactDto) {
    const sender = await this.senderKey(actor);
    return this.tickets.submitFromPortal(actor.schoolId, sender, {
      type: dto.type ?? 'COMPLAINT',
      category: dto.category ?? 'OTHER',
      subject: dto.subject ?? 'Message from the portal',
      description: dto.body,
    });
  }

  /** The family's own list of tickets, with the visible half of each thread. */
  async myTickets(actor: AccessTokenPayload) {
    const sender = await this.senderKey(actor);
    return this.tickets.mine(
      actor.schoolId,
      sender.raiserType,
      sender.raiserId,
    );
  }

  /** A reply on their own ticket. Ownership is checked in the service. */
  async replyToTicket(
    actor: AccessTokenPayload,
    ticketId: string,
    dto: PortalTicketReplyDto,
  ) {
    const sender = await this.senderKey(actor);
    const identity = await this.resolver.senderIdentity(actor);
    return this.tickets.replyFromPortal(
      ticketId,
      actor.schoolId,
      { ...sender, name: identity.name },
      dto.body,
    );
  }

  /** Roadmap M28 §4's satisfaction prompt, answered by the person who asked. */
  async rateTicket(
    actor: AccessTokenPayload,
    ticketId: string,
    dto: { rating: number; comment?: string },
  ) {
    const sender = await this.senderKey(actor);
    const identity = await this.resolver.senderIdentity(actor);
    return this.tickets.rateFromPortal(
      ticketId,
      actor.schoolId,
      { ...sender, name: identity.name },
      dto,
    );
  }

  /**
   * The requester key a ticket is filed under, resolved from the token
   * and never from a request body — the M18 rule this service was built
   * on, unchanged by M28.
   *
   * A **teacher** using the portal has no guardian or student row, so
   * there is nothing to file a ticket against: staff raise complaints
   * through the admin inbox, which is where the office already works.
   */
  private async senderKey(
    actor: AccessTokenPayload,
  ): Promise<{ raiserType: TicketRaiserType; raiserId: string }> {
    const principal = await this.resolver.principal(actor);
    if (principal.guardianId) {
      return {
        raiserType: TicketRaiserType.GUARDIAN,
        raiserId: principal.guardianId,
      };
    }
    if (principal.studentId) {
      return {
        raiserType: TicketRaiserType.STUDENT,
        raiserId: principal.studentId,
      };
    }
    throw new BadRequestException(
      'Only a student or a guardian may raise a ticket from the portal — staff use the office inbox',
    );
  }
}
