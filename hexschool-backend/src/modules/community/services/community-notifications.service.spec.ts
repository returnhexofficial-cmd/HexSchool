import { Ticket } from '@prisma/client';
import { CommunityNotificationsService } from './community-notifications.service';
import type { CommunityConfig } from './community-settings.service';
import type { NotificationService } from '../../communication/services/notification.service';
import type { CommunityDirectoryRepository } from '../repositories/community-directory.repository';

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 't1',
    schoolId: 'school-1',
    ticketNo: 'CMP-26-00001',
    type: 'COMPLAINT',
    category: 'FACILITY',
    subject: 'The tap in the west block is broken',
    description: 'It has been dripping for a week.',
    attachments: [],
    raisedByType: 'GUARDIAN',
    raisedById: 'g1',
    contact: null,
    assignedTo: null,
    priority: 'MEDIUM',
    status: 'OPEN',
    isSensitive: false,
    resolution: null,
    resolvedAt: null,
    closedAt: null,
    reopenedAt: null,
    satisfactionRating: null,
    firstResponseAt: null,
    escalatedAt: null,
    ip: null,
    createdAt: new Date('2026-08-09T09:00:00.000Z'),
    updatedAt: new Date('2026-08-09T09:00:00.000Z'),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    ...over,
  };
}

const CONFIG = {
  ticketNotifyRequester: true,
  appointmentNotify: true,
  alumniNotifyOnApproval: true,
  donationThankYou: true,
} as CommunityConfig;

describe('CommunityNotificationsService', () => {
  let notifications: { send: jest.Mock };
  let directory: {
    adminUserIds: jest.Mock;
    requester: jest.Mock;
    host: jest.Mock;
  };
  let service: CommunityNotificationsService;

  /** The nth `send()` payload, typed — `jest.Mock.mock.calls` is `any[][]`. */
  const sentCall = (n: number): { vars: Record<string, string> } =>
    (
      notifications.send.mock.calls as Array<[{ vars: Record<string, string> }]>
    )[n][0];

  beforeEach(() => {
    notifications = { send: jest.fn().mockResolvedValue(undefined) };
    directory = {
      adminUserIds: jest.fn().mockResolvedValue(['admin-1']),
      requester: jest.fn().mockResolvedValue({
        name: 'A Guardian',
        phone: '01711111111',
        email: null,
        userId: 'u-guardian',
      }),
      host: jest
        .fn()
        .mockResolvedValue({ name: 'Mr Karim', designation: null }),
    };
    service = new CommunityNotificationsService(
      notifications as unknown as NotificationService,
      directory as unknown as CommunityDirectoryRepository,
    );
  });

  /**
   * The module's central promise, asserted from four directions. A school
   * that offers an anonymous box and then texts the complainant has broken
   * it in the most public way available.
   */
  describe('an anonymous complaint is never contacted', () => {
    const anonymous = ticket({
      raisedByType: 'ANONYMOUS',
      raisedById: null,
      contact: null,
    });

    it('returns false and sends nothing, even with notifications on', async () => {
      await expect(
        service.notifyRequester(anonymous, CONFIG, 'Resolved'),
      ).resolves.toBe(false);
      expect(notifications.send).not.toHaveBeenCalled();
    });

    it('does not even LOOK the requester up — there is nothing to look up', async () => {
      await service.notifyRequester(anonymous, CONFIG, 'Resolved');
      expect(directory.requester).not.toHaveBeenCalled();
    });

    it('stays silent if a stray contact block somehow got onto the row', async () => {
      // The DB CHECK forbids this shape; the guard does not depend on it.
      const tampered = ticket({
        raisedByType: 'ANONYMOUS',
        raisedById: null,
        contact: { name: 'Leaked', phone: '01799999999' } as never,
      });
      await expect(
        service.notifyRequester(tampered, CONFIG, 'Resolved'),
      ).resolves.toBe(false);
      expect(notifications.send).not.toHaveBeenCalled();
    });
  });

  it('does notify a named requester, in-app when they have an account', async () => {
    await expect(
      service.notifyRequester(ticket(), CONFIG, 'Plumber booked'),
    ).resolves.toBe(true);

    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'TICKET_UPDATE',
        channel: 'IN_APP',
        recipient: { type: 'USER', id: 'u-guardian' },
      }),
    );
  });

  it('falls back to SMS for a public submitter with no account', async () => {
    const publicTicket = ticket({
      raisedByType: 'PUBLIC',
      raisedById: null,
      contact: { name: 'A Neighbour', phone: '01722222222' } as never,
    });

    await expect(
      service.notifyRequester(publicTicket, CONFIG, 'Looked into'),
    ).resolves.toBe(true);
    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'SMS',
        recipient: { type: 'RAW', destination: '01722222222' },
      }),
    );
  });

  it('respects a school that has turned requester notifications off', async () => {
    await expect(
      service.notifyRequester(
        ticket(),
        { ...CONFIG, ticketNotifyRequester: false },
        'Resolved',
      ),
    ).resolves.toBe(false);
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('never lets a failed send take the mutation down', async () => {
    notifications.send.mockRejectedValue(new Error('SMS balance exhausted'));
    await expect(
      service.notifyRequester(ticket(), CONFIG, 'Resolved'),
    ).resolves.toBe(false);
  });

  describe('the office alert', () => {
    it('carries the subject of an ordinary complaint', async () => {
      await service.announceTicket(ticket());
      expect(sentCall(0).vars.subject).toBe(
        'The tap in the west block is broken',
      );
    });

    /**
     * Roadmap §8. An in-app alert lands on several desks at once, so a
     * complaint naming a colleague must be read in the inbox by somebody
     * entitled to it — not previewed on everybody's bell.
     */
    it('withholds the subject of a sensitive one', async () => {
      await service.announceTicket(ticket({ isSensitive: true }));
      const call = sentCall(0);
      expect(call.vars.subject).not.toContain('tap');
      expect(call.vars.subject).toMatch(/restricted/i);
      // The number still goes out — the ticket has to be actionable.
      expect(call.vars.ticket_no).toBe('CMP-26-00001');
    });
  });

  describe('the SLA escalation', () => {
    it('sends ONE summary per admin, not one message per ticket', async () => {
      directory.adminUserIds.mockResolvedValue(['a1', 'a2']);
      await service.escalate('school-1', ['CMP-1', 'CMP-2', 'CMP-3']);
      expect(notifications.send).toHaveBeenCalledTimes(2);
    });

    it('names ticket numbers and never subjects', async () => {
      await service.escalate('school-1', ['CMP-1', 'CMP-2']);
      const call = sentCall(0);
      expect(call.vars.count).toBe('2');
      expect(call.vars.tickets).toBe('CMP-1, CMP-2');
    });

    it('truncates a long list rather than sending an unreadable wall', async () => {
      const many = Array.from({ length: 14 }, (_, i) => `CMP-${i + 1}`);
      await service.escalate('school-1', many);
      const call = sentCall(0);
      expect(call.vars.tickets).toContain('and 4 more');
    });

    it('sends nothing when nothing has breached', async () => {
      await expect(service.escalate('school-1', [])).resolves.toBe(0);
      expect(notifications.send).not.toHaveBeenCalled();
    });
  });

  it('SMSes an appointment decision — the visitor has no portal and no bell', async () => {
    await service.announceAppointmentDecision(
      {
        id: 'a1',
        schoolId: 'school-1',
        visitorName: 'A Vendor',
        phone: '01733333333',
        hostType: 'STAFF',
        hostId: 'st1',
        scheduledAt: new Date('2026-08-12T04:00:00.000Z'),
        status: 'APPROVED',
        decidedNote: 'Come to the front office.',
      } as never,
      CONFIG,
    );

    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'APPOINTMENT_DECISION',
        channel: 'SMS',
        recipient: { type: 'RAW', destination: '01733333333' },
      }),
    );
    expect(sentCall(0).vars.host).toBe('Mr Karim');
    expect(sentCall(0).vars.status).toBe('APPROVED');
  });

  it('thanks a donor only when there is a number to thank them on', async () => {
    const donation = {
      schoolId: 'school-1',
      donorName: 'Karim Traders',
      donorPhone: null,
      amount: { toString: () => '5000.00' },
      receiptNo: 'DON-26-00001',
      purpose: 'Library fund',
    };

    await expect(service.thankDonor(donation as never, CONFIG)).resolves.toBe(
      false,
    );
    await expect(
      service.thankDonor(
        { ...donation, donorPhone: '01744444444' } as never,
        CONFIG,
      ),
    ).resolves.toBe(true);
  });
});
