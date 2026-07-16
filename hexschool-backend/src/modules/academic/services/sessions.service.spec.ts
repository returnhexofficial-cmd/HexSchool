import { BadRequestException, ConflictException } from '@nestjs/common';
import { SessionStatus, UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SessionsService } from './sessions.service';

describe('SessionsService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };

  const session2026 = {
    id: 'sess-2026',
    schoolId: 'school-1',
    name: '2026',
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    status: SessionStatus.ACTIVE,
    isCurrent: true,
  };

  let repo: Record<string, jest.Mock>;
  let auditContext: { set: jest.Mock };
  let service: SessionsService;

  beforeEach(() => {
    repo = {
      paginate: jest.fn(),
      findByIdOrFail: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      findOverlapping: jest.fn().mockResolvedValue([]),
      findCurrent: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation((data: object) =>
          Promise.resolve({ id: 'sess-new', isCurrent: false, ...data }),
        ),
      update: jest
        .fn()
        .mockImplementation((_id: string, data: object) =>
          Promise.resolve({ ...session2026, ...data }),
        ),
      activate: jest
        .fn()
        .mockResolvedValue({ ...session2026, id: 'sess-2027', name: '2027' }),
      softDelete: jest.fn(),
      countAttachments: jest.fn().mockResolvedValue({ holidays: 0, events: 0 }),
      countAttachmentsOutsideRange: jest.fn().mockResolvedValue(0),
    };
    auditContext = { set: jest.fn() };
    service = new SessionsService(repo as never, auditContext as never);
  });

  it('rejects start >= end', async () => {
    await expect(
      service.create(
        { name: '2027', startDate: '2027-12-31', endDate: '2027-01-01' },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a duplicate name with 409', async () => {
    repo.findOne.mockResolvedValue(session2026);
    await expect(
      service.create(
        { name: '2026', startDate: '2027-01-01', endDate: '2027-12-31' },
        actor,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects overlapping date ranges (single-school invariant)', async () => {
    repo.findOverlapping.mockResolvedValue([session2026]);
    await expect(
      service.create(
        { name: '2026B', startDate: '2026-06-01', endDate: '2027-05-31' },
        actor,
      ),
    ).rejects.toThrow(/overlap/i);
  });

  it('activate delegates to the transactional repo switch', async () => {
    repo.findByIdOrFail.mockResolvedValue({ ...session2026, isCurrent: false });
    repo.findCurrent.mockResolvedValue(session2026);
    await service.activate('sess-2027', actor);
    expect(repo.activate).toHaveBeenCalledWith('sess-2027', 'school-1');
  });

  it('activate on the already-current session is a no-op', async () => {
    repo.findByIdOrFail.mockResolvedValue(session2026);
    await service.activate(session2026.id, actor);
    expect(repo.activate).not.toHaveBeenCalled();
  });

  it('the current session cannot be deleted', async () => {
    repo.findByIdOrFail.mockResolvedValue(session2026);
    await expect(service.remove(session2026.id, actor)).rejects.toThrow(
      ConflictException,
    );
  });

  it('a session with holidays/events cannot be deleted (archive instead)', async () => {
    repo.findByIdOrFail.mockResolvedValue({ ...session2026, isCurrent: false });
    repo.countAttachments.mockResolvedValue({ holidays: 3, events: 1 });
    await expect(service.remove(session2026.id, actor)).rejects.toThrow(
      /archive/i,
    );
  });

  it('an empty non-current session soft-deletes', async () => {
    repo.findByIdOrFail.mockResolvedValue({ ...session2026, isCurrent: false });
    await service.remove(session2026.id, actor);
    expect(repo.softDelete).toHaveBeenCalledWith(session2026.id);
  });

  it('date shrink is blocked while holidays/events fall outside', async () => {
    repo.findByIdOrFail.mockResolvedValue(session2026);
    repo.countAttachmentsOutsideRange.mockResolvedValue(2);
    await expect(
      service.update(session2026.id, { endDate: '2026-06-30' }, actor),
    ).rejects.toThrow(/outside the new dates/);
  });

  it('date correction passes when everything stays inside', async () => {
    repo.findByIdOrFail.mockResolvedValue(session2026);
    await expect(
      service.update(session2026.id, { endDate: '2026-11-30' }, actor),
    ).resolves.toBeDefined();
    expect(repo.update).toHaveBeenCalled();
  });
});
