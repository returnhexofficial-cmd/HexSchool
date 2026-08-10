import { Injectable, Logger } from '@nestjs/common';
import { Alumni, Appointment, Donation, Ticket } from '@prisma/client';
import {
  NotificationChannel,
  NotificationRecipientType,
} from '../../../common/constants';
import { NotificationService } from '../../communication/services/notification.service';
import { isAnonymous, isNotifiable } from '../calc/ticket.engine';
import { CommunityDirectoryRepository } from '../repositories/community-directory.repository';
import type { CommunityConfig } from './community-settings.service';

/** What a PUBLIC ticket stores instead of a person. */
interface TicketContact {
  name?: string;
  phone?: string;
  email?: string;
}

/**
 * Module 28's outbound messages, all through `NotificationService.send()`
 * — the M17 rule that there are no direct gateway calls anywhere.
 *
 * **`notifyRequester` is the most careful function in this module.** It is
 * the single place a complainant is contacted, and it refuses twice: once
 * on `isNotifiable`, which is false for every ANONYMOUS ticket whatever
 * the school has configured, and once because an anonymous row **has no
 * destination stored on it** — `chk_tickets_raiser` forbids one. Both
 * checks are deliberate. A school that offers an anonymous box and then
 * texts the complainant a status update has broken the promise in the
 * most public way available, and one guard between a promise and its
 * breach is not enough.
 *
 * Every send is wrapped: a school with an empty SMS balance must not make
 * *recording a complaint* fail (the M07 "delivery must never block the
 * mutation" rule, and the M25/M26 precedent verbatim).
 */
@Injectable()
export class CommunityNotificationsService {
  private readonly logger = new Logger(CommunityNotificationsService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly directory: CommunityDirectoryRepository,
  ) {}

  /** A new ticket reached the office. In-app to the admins. */
  async announceTicket(ticket: Ticket): Promise<number> {
    const admins = await this.directory.adminUserIds(ticket.schoolId);
    let sent = 0;

    for (const userId of admins) {
      const ok = await this.trySend({
        schoolId: ticket.schoolId,
        code: 'TICKET_RAISED',
        channel: NotificationChannel.IN_APP,
        recipient: { type: NotificationRecipientType.USER, id: userId },
        vars: {
          ticket_no: ticket.ticketNo,
          type: ticket.type,
          category: ticket.category,
          // The **subject only**, never the description, and never for a
          // sensitive ticket: an in-app alert lands on several desks, and
          // an allegation about a colleague must be read in the inbox by
          // somebody entitled to it — not previewed on a bell.
          subject: ticket.isSensitive
            ? '(restricted — open the inbox to read it)'
            : ticket.subject,
          priority: ticket.priority,
        },
      });
      if (ok) sent += 1;
    }
    return sent;
  }

  /**
   * Tell the requester their ticket moved. Returns `false` — quietly and
   * correctly — for every anonymous complaint.
   */
  async notifyRequester(
    ticket: Ticket,
    cfg: CommunityConfig,
    note: string,
  ): Promise<boolean> {
    if (!isNotifiable(ticket.raisedByType, cfg.ticketNotifyRequester)) {
      return false;
    }
    // Belt and braces: `isNotifiable` already refuses ANONYMOUS. This
    // second check exists because the cost of the first one being edited
    // carelessly one day is a whistle-blower's phone ringing.
    if (isAnonymous(ticket.raisedByType)) return false;

    const target = await this.resolveDestination(ticket);
    if (!target) return false;

    const vars = {
      ticket_no: ticket.ticketNo,
      subject: ticket.subject,
      status: ticket.status,
      note,
    };

    if (target.userId) {
      return this.trySend({
        schoolId: ticket.schoolId,
        code: 'TICKET_UPDATE',
        channel: NotificationChannel.IN_APP,
        recipient: { type: NotificationRecipientType.USER, id: target.userId },
        vars,
      });
    }

    if (target.phone) {
      return this.trySend({
        schoolId: ticket.schoolId,
        code: 'TICKET_UPDATE',
        channel: NotificationChannel.SMS,
        recipient: {
          type: NotificationRecipientType.RAW,
          destination: target.phone,
        },
        vars,
      });
    }
    return false;
  }

  /**
   * The SLA sweep's chase. **One summary per school per run**, not one
   * message per ticket: a backlog of thirty overdue complaints must not
   * arrive as thirty bells, or the sweep is switched off within a week
   * (the M24 low-stock reasoning).
   *
   * It names ticket **numbers**, never subjects — the list includes the
   * sensitive ones by design, because a complaint about a teacher going
   * unanswered for four days is exactly what the head must be told about,
   * and a number is enough to act on.
   */
  async escalate(schoolId: string, ticketNos: string[]): Promise<number> {
    if (ticketNos.length === 0) return 0;
    const admins = await this.directory.adminUserIds(schoolId);
    let sent = 0;

    const shown = ticketNos.slice(0, 10);
    const list =
      shown.join(', ') +
      (ticketNos.length > shown.length
        ? ` and ${ticketNos.length - shown.length} more`
        : '');

    for (const userId of admins) {
      const ok = await this.trySend({
        schoolId,
        code: 'TICKET_ESCALATED',
        channel: NotificationChannel.IN_APP,
        recipient: { type: NotificationRecipientType.USER, id: userId },
        vars: { count: String(ticketNos.length), tickets: list },
      });
      if (ok) sent += 1;
    }
    return sent;
  }

  /**
   * Roadmap §4's "appointment request → approve (SMS confirm)". SMS
   * rather than in-app, unlike the rest of this module: the recipient is
   * outside the school with no portal and no bell, and the whole point is
   * that they know before they travel.
   */
  async announceAppointmentDecision(
    appointment: Appointment,
    cfg: CommunityConfig,
  ): Promise<boolean> {
    if (!cfg.appointmentNotify) return false;

    const host = await this.directory.host(
      appointment.schoolId,
      appointment.hostType,
      appointment.hostId,
    );

    return this.trySend({
      schoolId: appointment.schoolId,
      code: 'APPOINTMENT_DECISION',
      channel: NotificationChannel.SMS,
      recipient: {
        type: NotificationRecipientType.RAW,
        destination: appointment.phone,
      },
      vars: {
        visitor_name: appointment.visitorName,
        host: host?.name ?? 'the school',
        scheduled_at: appointment.scheduledAt
          .toISOString()
          .slice(0, 16)
          .replace('T', ' '),
        status: appointment.status,
        note: appointment.decidedNote ?? '',
      },
    });
  }

  async announceAlumniApproved(
    alumni: Alumni,
    cfg: CommunityConfig,
  ): Promise<boolean> {
    if (!cfg.alumniNotifyOnApproval) return false;

    const vars = {
      name: alumni.name,
      batch_year: String(alumni.batchYear),
    };

    if (alumni.phone) {
      return this.trySend({
        schoolId: alumni.schoolId,
        code: 'ALUMNI_APPROVED',
        channel: NotificationChannel.SMS,
        recipient: {
          type: NotificationRecipientType.RAW,
          destination: alumni.phone,
        },
        vars,
      });
    }
    if (alumni.email) {
      return this.trySend({
        schoolId: alumni.schoolId,
        code: 'ALUMNI_APPROVED',
        channel: NotificationChannel.EMAIL,
        recipient: {
          type: NotificationRecipientType.RAW,
          destination: alumni.email,
        },
        vars,
      });
    }
    return false;
  }

  /** The thank-you, carrying the receipt number the donor will quote. */
  async thankDonor(donation: Donation, cfg: CommunityConfig): Promise<boolean> {
    if (!cfg.donationThankYou || !donation.donorPhone) return false;

    return this.trySend({
      schoolId: donation.schoolId,
      code: 'DONATION_RECEIVED',
      channel: NotificationChannel.SMS,
      recipient: {
        type: NotificationRecipientType.RAW,
        destination: donation.donorPhone,
      },
      vars: {
        donor_name: donation.donorName,
        amount: donation.amount.toString(),
        receipt_no: donation.receiptNo,
        purpose: donation.purpose ?? 'the school',
      },
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  private async resolveDestination(
    ticket: Ticket,
  ): Promise<{ userId: string | null; phone: string | null } | null> {
    if (ticket.raisedByType === 'PUBLIC') {
      const contact = (ticket.contact ?? {}) as TicketContact;
      return contact.phone ? { userId: null, phone: contact.phone } : null;
    }
    if (!ticket.raisedById) return null;

    const person = await this.directory.requester(
      ticket.schoolId,
      ticket.raisedByType as 'GUARDIAN' | 'STUDENT' | 'STAFF',
      ticket.raisedById,
    );
    return person ? { userId: person.userId, phone: person.phone } : null;
  }

  private async trySend(input: Parameters<NotificationService['send']>[0]) {
    try {
      await this.notifications.send(input);
      return true;
    } catch (error) {
      this.logger.warn(`${input.code} not sent: ${(error as Error).message}`);
      return false;
    }
  }
}
