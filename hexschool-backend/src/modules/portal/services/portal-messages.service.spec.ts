import { NotificationRecipientType, UserType } from '../../../common/constants';
import { PortalMessagesService } from './portal-messages.service';
import type { PortalResolverService } from './portal-resolver.service';
import type { NotificationsRepository } from '../../communication/repositories/notifications.repository';
import type { ContactService } from '../../website/services/contact.service';
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
  let contact: { submitFromPortal: jest.Mock };
  let service: PortalMessagesService;

  beforeEach(() => {
    resolver = {
      principal: jest.fn(),
      senderIdentity: jest.fn(),
    };
    notifications = { sentHistoryFor: jest.fn().mockResolvedValue([]) };
    contact = {
      submitFromPortal: jest.fn().mockResolvedValue({ message: 'ok' }),
    };
    service = new PortalMessagesService(
      resolver as unknown as PortalResolverService,
      notifications as unknown as NotificationsRepository,
      contact as unknown as ContactService,
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

  it('takes the contact sender from the account, never the request body', async () => {
    resolver.senderIdentity.mockResolvedValue({
      name: 'Real Guardian',
      phone: '01711111111',
      email: null,
    });

    await service.contactSchool(actor, {
      subject: 'Question',
      body: 'Is there class on Sunday?',
    });

    expect(resolver.senderIdentity).toHaveBeenCalledWith(actor);
    expect(contact.submitFromPortal).toHaveBeenCalledWith(
      'school-1',
      { name: 'Real Guardian', phone: '01711111111', email: null },
      { subject: 'Question', body: 'Is there class on Sunday?' },
    );
  });
});
