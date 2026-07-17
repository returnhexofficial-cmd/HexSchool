import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { GuardianRelation, UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { GuardiansService } from './guardians.service';

const actor: AccessTokenPayload = {
  sub: 'actor-1',
  schoolId: 'school-1',
  userType: UserType.ADMIN,
};

describe('GuardiansService', () => {
  let guardians: Record<string, jest.Mock>;
  let links: Record<string, jest.Mock>;
  let students: Record<string, jest.Mock>;
  let users: Record<string, jest.Mock>;
  let service: GuardiansService;

  beforeEach(() => {
    guardians = {
      paginateList: jest.fn(),
      findDetail: jest.fn().mockResolvedValue({ id: 'guardian-1' }),
      findByIdOrFail: jest.fn().mockResolvedValue({
        id: 'guardian-1',
        name: 'Karim',
        phone: '01712345678',
        userId: null,
      }),
      findByPhone: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation((data: object) =>
          Promise.resolve({ id: 'guardian-1', ...data }),
        ),
      update: jest
        .fn()
        .mockImplementation((id: string, data: object) =>
          Promise.resolve({ id, ...data }),
        ),
      withTransaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
          fn({ tx: true }),
        ),
    };
    links = {
      find: jest.fn().mockResolvedValue(null),
      findPrimary: jest.fn(),
      link: jest.fn(),
      update: jest.fn(),
      unlink: jest.fn(),
      demotePrimary: jest.fn(),
      countForStudent: jest.fn().mockResolvedValue(0),
      countForGuardian: jest.fn().mockResolvedValue(0),
      listForStudent: jest.fn().mockResolvedValue([]),
      withTransaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
          fn({ tx: true }),
        ),
    };
    students = {
      findByIdOrFail: jest.fn().mockResolvedValue({ id: 'student-1' }),
    };
    users = { update: jest.fn() };

    service = new GuardiansService(
      guardians as never,
      links as never,
      students as never,
      users as never,
      { set: jest.fn() } as never,
    );
  });

  describe('create / update', () => {
    it('409s when the phone already belongs to a guardian', async () => {
      guardians.findByPhone.mockResolvedValue({
        id: 'other',
        name: 'Existing',
      });

      await expect(
        service.create({ name: 'New', phone: '01712345678' }, actor),
      ).rejects.toThrow(ConflictException);
    });

    it('syncs the portal user phone when the guardian phone changes', async () => {
      guardians.findByIdOrFail.mockResolvedValue({
        id: 'guardian-1',
        name: 'Karim',
        phone: '01712345678',
        userId: 'user-7',
      });

      await service.update('guardian-1', { phone: '01898765432' }, actor);
      expect(users.update).toHaveBeenCalledWith('user-7', {
        phone: '01898765432',
        updatedBy: 'actor-1',
      });
    });
  });

  describe('remove', () => {
    it('blocks deletion while children are linked', async () => {
      links.countForGuardian.mockResolvedValue(2);
      await expect(service.remove('guardian-1', actor)).rejects.toThrow(
        'linked to 2 student(s)',
      );
    });

    it('soft-deletes guardian and portal user when unlinked', async () => {
      guardians.findByIdOrFail.mockResolvedValue({
        id: 'guardian-1',
        name: 'Karim',
        phone: '01712345678',
        userId: 'user-7',
      });

      await service.remove('guardian-1', actor);
      expect(guardians.update).toHaveBeenCalledWith(
        'guardian-1',
        expect.objectContaining({ deletedAt: expect.any(Date) as Date }),
        { tx: true },
      );
      expect(users.update).toHaveBeenCalledWith(
        'user-7',
        expect.objectContaining({ deletedAt: expect.any(Date) as Date }),
        { tx: true },
      );
    });
  });

  describe('link', () => {
    it('the first linked guardian becomes primary automatically', async () => {
      links.countForStudent.mockResolvedValue(0);

      await service.link(
        'student-1',
        { guardianId: 'guardian-1', relation: GuardianRelation.FATHER },
        actor,
      );
      expect(links.link).toHaveBeenCalledWith(
        expect.objectContaining({ isPrimary: true }),
        { tx: true },
      );
    });

    it('promoting a new primary demotes the old one first (single tx)', async () => {
      links.countForStudent.mockResolvedValue(1);

      await service.link(
        'student-1',
        {
          guardianId: 'guardian-1',
          relation: GuardianRelation.MOTHER,
          isPrimary: true,
        },
        actor,
      );
      expect(links.demotePrimary).toHaveBeenCalledWith('student-1', {
        tx: true,
      });
      expect(links.link).toHaveBeenCalledWith(
        expect.objectContaining({ isPrimary: true }),
        { tx: true },
      );
    });

    it('an additional guardian defaults to non-primary', async () => {
      links.countForStudent.mockResolvedValue(1);

      await service.link(
        'student-1',
        { guardianId: 'guardian-1', relation: GuardianRelation.UNCLE },
        actor,
      );
      expect(links.demotePrimary).not.toHaveBeenCalled();
      expect(links.link).toHaveBeenCalledWith(
        expect.objectContaining({ isPrimary: false }),
        { tx: true },
      );
    });

    it('409s when the guardian is already linked', async () => {
      links.find.mockResolvedValue({ studentId: 'student-1' });
      await expect(
        service.link(
          'student-1',
          { guardianId: 'guardian-1', relation: GuardianRelation.FATHER },
          actor,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateLink / unlink', () => {
    it('refuses to demote the primary directly', async () => {
      links.find.mockResolvedValue({ isPrimary: true });
      await expect(
        service.updateLink(
          'student-1',
          'guardian-1',
          { isPrimary: false },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks unlinking the primary while other guardians remain', async () => {
      links.find.mockResolvedValue({ isPrimary: true });
      links.countForStudent.mockResolvedValue(2);

      await expect(
        service.unlink('student-1', 'guardian-1', actor),
      ).rejects.toThrow('promote another guardian first');
    });

    it('allows unlinking the last guardian', async () => {
      links.find.mockResolvedValue({
        isPrimary: true,
        relation: GuardianRelation.FATHER,
      });
      links.countForStudent.mockResolvedValue(1);

      await service.unlink('student-1', 'guardian-1', actor);
      expect(links.unlink).toHaveBeenCalledWith('student-1', 'guardian-1');
    });

    it('404s on a missing link', async () => {
      links.find.mockResolvedValue(null);
      await expect(
        service.unlink('student-1', 'guardian-1', actor),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
