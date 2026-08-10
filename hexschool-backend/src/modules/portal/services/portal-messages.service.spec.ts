import { NotificationRecipientType, UserType } from '../../../common/constants';
import { PortalMessagesService } from './portal-messages.service';
import type { PortalResolverService } from './portal-resolver.service';
import type { NotificationsRepository } from '../../communication/repositories/notifications.repository';
import type { TicketsService } from '../../community/services/tickets.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';

describe('PortalMessagesService', () => {
  const actor: AccessTokenPayload = {
    sub: 'u1',
    schoolId: 'school-1',
    userType: UserType.PARENT,
  };

  let resolver: {
    principal: jest.Mock;
    senderIdentity: jest.Mock;
  };
  let notifications: { sentHistoryFor: jest.Mock };
  let tickets: {
    submitFromPortal: jest.Mock;
    mine: jest.Mock;
    replyFromPortal: jest.Mock;
    rateFromPortal: jest.Mock;
  };
  let service: PortalMessagesService;

  beforeEach(() => {
    resolver = {
      principal: jest.fn(),
      senderIdentity: jest.fn(),
    };
    notifications = { sentHistoryFor: jest.fn().mockResolvedValue([]) };
    tickets = {
      submitFromPortal: jest.fn().mockResolvedValue({
        message: 'ok',
        ticketNo: 'CMP-26-00001',
        id: 't1',
      }),
      mine: jest.fn().mockResolvedValue([]),
      replyFromPortal: jest.fn().mockResolvedValue({ id: 'c1' }),
      rateFromPortal: jest.fn().mockResolvedValue({ id: 't1' }),
    };
    service = new PortalMessagesService(
      resolver as unknown as PortalResolverService,
      notifications as unknown as NotificationsRepository,
      tickets as unknown as TicketsService,
    );
  });

  it('keys a parent’s history on their guardian row', async () => {
    resolver.principal.mockResolvedValue({
      guardianId: 'g1',
      studentId: null,
      children: [],
    });

    await service.history(actor);

    expect(notifications.sentHistoryFor).toHaveBeenCalledWith(
      'school-1',
      NotificationRecipientType.GUARDIAN,
      'g1',
      expect.any(Number),
    );
  });

  it('keys a student’s history on their student row', async () => {
    resolver.principal.mockResolvedValue({
      guardianId: null,
      studentId: 's1',
      children: [],
    });

    await service.history(actor);

    expect(notifications.sentHistoryFor).toHaveBeenCalledWith(
      'school-1',
      NotificationRecipientType.STUDENT,
      's1',
      expect.any(Number),
    );
  });

  it('returns an empty history for an account with no profile, not a query', async () => {
    resolver.principal.mockResolvedValue({
      guardianId: null,
      studentId: null,
      children: [],
    });

    await expect(service.history(actor)).resolves.toEqual({ items: [] });
    expect(notifications.sentHistoryFor).not.toHaveBeenCalled();
  });

  it('drops in-app rows by asking the repository for sent history only', async () => {
    resolver.principal.mockResolvedValue({
      guardianId: 'g1',
      studentId: null,
      children: [],
    });
    notifications.sentHistoryFor.mockResolvedValue([
      {
        id: 'n1',
        channel: 'SMS',
        destination: '01700000000',
        templateCode: 'FEE_RECEIPT',
        bodyRendered: 'Received 500',
        status: 'DELIVERED',
        sentAt: new Date('2026-05-01'),
        createdAt: new Date('2026-05-01'),
      },
    ]);

    const out = await service.history(actor);

    expect(out.items).toHaveLength(1);
    expect(out.items[0].body).toBe('Received 500');
    // The rendered body is exposed, never the raw payload/vars.
    expect(out.items[0]).not.toHaveProperty('payload');
  });

  // ── M28: the contact form now opens a ticket ────────────────────────

  it('files a parent’s message as a GUARDIAN ticket, keyed on their own row', async () => {
    resolver.principal.mockResolvedValue({
      guardianId: 'g1',
      studentId: null,
      children: [],
    });

    const out = await service.contactSchool(actor, {
      subject: 'Question',
      body: 'Is there class on Sunday?',
    });

    expect(tickets.submitFromPortal).toHaveBeenCalledWith(
      'school-1',
      { raiserType: 'GUARDIAN', raiserId: 'g1' },
      expect.objectContaining({
        subject: 'Question',
        description: 'Is there class on Sunday?',
      }),
    );
    // The family now gets a reference to quote — the whole point of
    // replacing the M18 inbox stub with a thread.
    expect(out.ticketNo).toBe('CMP-26-00001');
  });

  it('takes the requester from the account, never the request body', async () => {
    resolver.principal.mockResolvedValue({
      guardianId: 'g1',
      studentId: 's-someone-else',
      children: [],
    });

    await service.contactSchool(actor, { body: 'Hello there' });

    // A guardian id wins, and neither id came from the caller.
    expect(tickets.submitFromPortal).toHaveBeenCalledWith(
      'school-1',
      { raiserType: 'GUARDIAN', raiserId: 'g1' },
      expect.anything(),
    );
  });

  it('files a student’s message as a STUDENT ticket', async () => {
    resolver.principal.mockResolvedValue({
      guardianId: null,
      studentId: 's1',
      children: [],
    });

    await service.contactSchool(actor, { body: 'The fan in 9B is broken' });

    expect(tickets.submitFromPortal).toHaveBeenCalledWith(
      'school-1',
      { raiserType: 'STUDENT', raiserId: 's1' },
      expect.anything(),
    );
  });

  it('refuses a teacher — staff raise complaints through the office inbox', async () => {
    resolver.principal.mockResolvedValue({
      guardianId: null,
      studentId: null,
      teacherId: 't1',
      children: [],
    });

    await expect(
      service.contactSchool(actor, { body: 'Anything' }),
    ).rejects.toThrow(/student or a guardian/i);
    expect(tickets.submitFromPortal).not.toHaveBeenCalled();
  });

  it('defaults an unclassified message to a COMPLAINT in OTHER', async () => {
    resolver.principal.mockResolvedValue({
      guardianId: 'g1',
      studentId: null,
      children: [],
    });

    await service.contactSchool(actor, { body: 'Something happened' });

    expect(tickets.submitFromPortal).toHaveBeenCalledWith(
      'school-1',
      expect.anything(),
      expect.objectContaining({ type: 'COMPLAINT', category: 'OTHER' }),
    );
  });

  it('scopes "my tickets" to the resolved requester', async () => {
    resolver.principal.mockResolvedValue({
      guardianId: 'g1',
      studentId: null,
      children: [],
    });

    await service.myTickets(actor);

    expect(tickets.mine).toHaveBeenCalledWith('school-1', 'GUARDIAN', 'g1');
  });

  it('passes the account’s own name onto a reply', async () => {
    resolver.principal.mockResolvedValue({
      guardianId: 'g1',
      studentId: null,
      children: [],
    });
    resolver.senderIdentity.mockResolvedValue({
      name: 'Real Guardian',
      phone: '01711111111',
      email: null,
    });

    await service.replyToTicket(actor, 't1', { body: 'Any update?' });

    expect(tickets.replyFromPortal).toHaveBeenCalledWith(
      't1',
      'school-1',
      { raiserType: 'GUARDIAN', raiserId: 'g1', name: 'Real Guardian' },
      'Any update?',
    );
  });
});
