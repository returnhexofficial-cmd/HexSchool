import { BadRequestException, ConflictException } from '@nestjs/common';
import { UserStatus, UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { UsersAdminService } from './users-admin.service';

const actor: AccessTokenPayload = {
  sub: 'admin-1',
  schoolId: 'school-1',
  userType: UserType.ADMIN,
};

describe('UsersAdminService', () => {
  let users: Record<string, jest.Mock>;
  let refreshTokens: Record<string, jest.Mock>;
  let passwords: Record<string, jest.Mock>;
  let queue: { add: jest.Mock };
  let service: UsersAdminService;

  beforeEach(() => {
    users = {
      paginateAdminList: jest.fn(),
      findByIdOrFail: jest.fn(),
      update: jest.fn(),
      setTempPassword: jest.fn(),
      countOtherActiveSuperAdmins: jest.fn().mockResolvedValue(1),
    };
    refreshTokens = { revokeAllForUser: jest.fn() };
    passwords = { hash: jest.fn().mockResolvedValue('hashed') };
    queue = { add: jest.fn().mockResolvedValue(undefined) };

    service = new UsersAdminService(
      users as never,
      refreshTokens as never,
      passwords as never,
      { set: jest.fn() } as never,
      queue as never,
    );
  });

  describe('updateStatus', () => {
    it('refuses to change your own status', async () => {
      users.findByIdOrFail.mockResolvedValue({
        id: 'admin-1',
        status: UserStatus.ACTIVE,
        userType: UserType.ADMIN,
      });
      await expect(
        service.updateStatus('admin-1', { status: UserStatus.INACTIVE }, actor),
      ).rejects.toThrow(BadRequestException);
    });

    it('protects the last active Super Admin', async () => {
      users.findByIdOrFail.mockResolvedValue({
        id: 'sa-1',
        status: UserStatus.ACTIVE,
        userType: UserType.SUPER_ADMIN,
      });
      users.countOtherActiveSuperAdmins.mockResolvedValue(0);
      await expect(
        service.updateStatus('sa-1', { status: UserStatus.SUSPENDED }, actor),
      ).rejects.toThrow(ConflictException);
    });

    it('deactivation revokes every session immediately', async () => {
      users.findByIdOrFail.mockResolvedValue({
        id: 'user-2',
        status: UserStatus.ACTIVE,
        userType: UserType.STAFF,
      });
      await service.updateStatus(
        'user-2',
        { status: UserStatus.INACTIVE, reason: 'left' },
        actor,
      );
      expect(users.update).toHaveBeenCalledWith(
        'user-2',
        expect.objectContaining({ status: UserStatus.INACTIVE }),
      );
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('user-2');
    });

    it('re-activation does NOT revoke sessions', async () => {
      users.findByIdOrFail.mockResolvedValue({
        id: 'user-2',
        status: UserStatus.INACTIVE,
        userType: UserType.STAFF,
      });
      await service.updateStatus(
        'user-2',
        { status: UserStatus.ACTIVE },
        actor,
      );
      expect(refreshTokens.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('issues a temp password, revokes sessions, and notifies by SMS', async () => {
      users.findByIdOrFail.mockResolvedValue({
        id: 'user-2',
        phone: '01712345678',
        email: null,
      });
      const { tempPassword } = await service.resetPassword('user-2', actor);

      expect(tempPassword.length).toBeGreaterThanOrEqual(8);
      expect(passwords.hash).toHaveBeenCalledWith(tempPassword);
      expect(users.setTempPassword).toHaveBeenCalledWith('user-2', 'hashed');
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('user-2');
      expect(queue.add).toHaveBeenCalledWith(
        'sms',
        expect.objectContaining({ type: 'sms', to: '01712345678' }),
      );
    });

    it('falls back to email when the user has no phone', async () => {
      users.findByIdOrFail.mockResolvedValue({
        id: 'user-3',
        phone: null,
        email: 'user@test.local',
      });
      await service.resetPassword('user-3', actor);
      expect(queue.add).toHaveBeenCalledWith(
        'email',
        expect.objectContaining({ type: 'email', to: 'user@test.local' }),
      );
    });

    it('still succeeds when the queue is down (admin has the password)', async () => {
      users.findByIdOrFail.mockResolvedValue({
        id: 'user-2',
        phone: '01712345678',
        email: null,
      });
      queue.add.mockRejectedValue(new Error('redis down'));
      const { tempPassword } = await service.resetPassword('user-2', actor);
      expect(tempPassword).toBeTruthy();
    });
  });
});
