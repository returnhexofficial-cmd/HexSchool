import { HttpException, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LoginEvent, UserStatus, UserType } from '../../../common/constants';
import { AuthService, ROTATION_GRACE_MS } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/**
 * Unit tests for the M02 business rules: lockout counter, refresh
 * rotation, and reuse detection. Repositories are mocked; Password/Token
 * services are real (argon2 + crypto are fast enough and higher-fidelity).
 */
describe('AuthService', () => {
  const passwordService = new PasswordService();
  const tokenService = new TokenService(new JwtService(), {
    getOrThrow: (key: string) =>
      key === 'jwt.accessSecret' ? 'a'.repeat(32) : 'r'.repeat(32),
  } as unknown as ConfigService);

  let events: { emit: jest.Mock };
  let users: Record<string, jest.Mock>;
  let refreshTokens: Record<string, jest.Mock>;
  let service: AuthService;

  const baseUser = {
    id: 'user-1',
    schoolId: 'school-1',
    email: 'user@test.local',
    phone: '01712345678',
    userType: UserType.ADMIN,
    status: UserStatus.ACTIVE,
    failedLoginAttempts: 0,
    lockedUntil: null as Date | null,
    mustChangePassword: false,
    lastLoginAt: null as Date | null,
  };

  beforeEach(() => {
    events = { emit: jest.fn() };
    users = {
      findByIdentifier: jest.fn(),
      findById: jest.fn(),
      findByIdOrFail: jest.fn(),
      incrementFailedAttempts: jest.fn(),
      resetLoginCounters: jest.fn(),
      lock: jest.fn(),
      setPassword: jest.fn(),
    };
    refreshTokens = {
      issue: jest.fn().mockResolvedValue({ id: 'new-rt-id' }),
      findByHash: jest.fn(),
      findActiveById: jest.fn(),
      markReplaced: jest.fn(),
      revoke: jest.fn(),
      revokeAllForUser: jest.fn(),
      listActiveForUser: jest.fn().mockResolvedValue([]),
    };
    service = new AuthService(
      users as never,
      refreshTokens as never,
      passwordService,
      tokenService,
      { issue: jest.fn(), verify: jest.fn() } as never,
      // PermissionsService (M03) — only me() touches it in these tests.
      { getEffectivePermissionCodes: jest.fn().mockResolvedValue([]) } as never,
      // AuditContextService (M03) — set() is a no-op outside a request.
      { set: jest.fn() } as never,
      events as unknown as EventEmitter2,
    );
  });

  const withPassword = async (password: string) => ({
    ...baseUser,
    passwordHash: await passwordService.hash(password),
  });

  describe('login & lockout', () => {
    it('happy path: returns user + token pair, resets counters', async () => {
      users.findByIdentifier.mockResolvedValue(await withPassword('Good1234'));

      const result = await service.login(
        { identifier: 'user@test.local', password: 'Good1234' },
        { ip: '1.2.3.4' },
      );

      expect(result.tokens.accessToken).toBeTruthy();
      expect(result.tokens.refreshToken).toBeTruthy();
      expect(users.resetLoginCounters).toHaveBeenCalledWith('user-1');
      expect(refreshTokens.issue).toHaveBeenCalled();
      expect(events.emit).toHaveBeenCalledWith(
        'user.logged_in',
        expect.objectContaining({ event: LoginEvent.LOGIN_SUCCESS }),
      );
    });

    it('wrong password increments the counter and stays generic', async () => {
      users.findByIdentifier.mockResolvedValue(await withPassword('Good1234'));
      users.incrementFailedAttempts.mockResolvedValue(2);

      await expect(
        service.login(
          { identifier: 'user@test.local', password: 'Bad12345' },
          {},
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(users.incrementFailedAttempts).toHaveBeenCalledWith('user-1');
      expect(users.lock).not.toHaveBeenCalled();
    });

    it('5th failure locks for 15 minutes and emits user.locked', async () => {
      users.findByIdentifier.mockResolvedValue(await withPassword('Good1234'));
      users.incrementFailedAttempts.mockResolvedValue(5);

      await expect(
        service.login(
          { identifier: 'user@test.local', password: 'Bad12345' },
          {},
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(users.lock).toHaveBeenCalledWith('user-1', expect.any(Date));
      const until = (users.lock.mock.calls[0] as [string, Date])[1];
      expect(until.getTime() - Date.now()).toBeGreaterThan(14 * 60 * 1000);
      expect(events.emit).toHaveBeenCalledWith(
        'user.locked',
        expect.objectContaining({ event: LoginEvent.LOCKED }),
      );
    });

    it('locked account → 423 even with the right password', async () => {
      users.findByIdentifier.mockResolvedValue({
        ...(await withPassword('Good1234')),
        lockedUntil: new Date(Date.now() + 60_000),
      });

      await expect(
        service.login(
          { identifier: 'user@test.local', password: 'Good1234' },
          {},
        ),
      ).rejects.toMatchObject({ status: 423 } as Partial<HttpException>);
    });

    it('suspended user cannot log in even with correct password', async () => {
      users.findByIdentifier.mockResolvedValue({
        ...(await withPassword('Good1234')),
        status: UserStatus.SUSPENDED,
      });

      await expect(
        service.login(
          { identifier: 'user@test.local', password: 'Good1234' },
          {},
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh rotation & reuse detection', () => {
    const activeRecord = (token: string, extra: object = {}) => ({
      id: 'rt-1',
      userId: 'user-1',
      tokenHash: tokenService.hashRefreshToken(token),
      deviceInfo: {},
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      replacedById: null,
      createdAt: new Date(),
      ...extra,
    });

    it('valid token rotates: new token issued, old chained', async () => {
      users.findById.mockResolvedValue(await withPassword('Good1234'));
      refreshTokens.findByHash.mockResolvedValue(activeRecord('tok-1'));

      const result = await service.refresh('tok-1', {});

      expect(result.tokens.refreshToken).not.toBe('tok-1');
      expect(refreshTokens.issue).toHaveBeenCalled();
      expect(refreshTokens.markReplaced).toHaveBeenCalledWith(
        'rt-1',
        'new-rt-id',
      );
    });

    it('reuse outside grace ⇒ revokes ALL sessions and emits token_reuse', async () => {
      users.findById.mockResolvedValue(await withPassword('Good1234'));
      refreshTokens.findByHash.mockResolvedValue(
        activeRecord('tok-1', {
          revokedAt: new Date(Date.now() - ROTATION_GRACE_MS - 1000),
          replacedById: 'rt-2',
        }),
      );

      await expect(service.refresh('tok-1', {})).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
      expect(events.emit).toHaveBeenCalledWith(
        'user.token_reuse',
        expect.objectContaining({ event: LoginEvent.TOKEN_REUSE }),
      );
    });

    it('reuse INSIDE grace (two-tab race) still rotates without theft response', async () => {
      users.findById.mockResolvedValue(await withPassword('Good1234'));
      refreshTokens.findByHash.mockResolvedValue(
        activeRecord('tok-1', {
          revokedAt: new Date(Date.now() - 1000),
          replacedById: 'rt-2',
        }),
      );

      const result = await service.refresh('tok-1', {});
      expect(result.tokens.refreshToken).toBeTruthy();
      expect(refreshTokens.revokeAllForUser).not.toHaveBeenCalled();
      // Already chained — grace re-issue must not re-chain.
      expect(refreshTokens.markReplaced).not.toHaveBeenCalled();
    });

    it('expired token → 401', async () => {
      users.findById.mockResolvedValue(await withPassword('Good1234'));
      refreshTokens.findByHash.mockResolvedValue(
        activeRecord('tok-1', { expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.refresh('tok-1', {})).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('suspended user cannot refresh', async () => {
      users.findById.mockResolvedValue({
        ...(await withPassword('Good1234')),
        status: UserStatus.SUSPENDED,
      });
      refreshTokens.findByHash.mockResolvedValue(activeRecord('tok-1'));

      await expect(service.refresh('tok-1', {})).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
