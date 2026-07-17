import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RefreshToken, User } from '@prisma/client';
import { LoginEvent, OtpPurpose, UserStatus } from '../../../common/constants';
import { normalizeIdentifier } from '../../../common/utils/identifier.util';
import {
  ChangePasswordDto,
  LoginDto,
  LogoutDto,
  ResetPasswordDto,
} from '../dto';
import { AuditContextService } from '../../audit/services/audit-context.service';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { AUTH_EVENTS, AuthActivityEvent } from '../events/auth.events';
import { DeviceInfo } from '../interfaces/device-info.interface';
import { RefreshTokensRepository } from '../repositories/refresh-tokens.repository';
import { UsersRepository } from '../repositories/users.repository';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
/** In-flight race tolerance for concurrent refresh from two tabs (M02 §8). */
export const ROTATION_GRACE_MS = 5_000;

export interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface SafeUser {
  id: string;
  schoolId: string;
  email: string | null;
  phone: string | null;
  userType: User['userType'];
  status: User['status'];
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
}

/**
 * Login, token rotation w/ reuse detection, lockout, OTP-backed reset —
 * roadmap Module 02. Error messages stay generic ("Invalid credentials")
 * so responses never reveal which field failed or whether an account
 * exists (M02 §5 + forgot-password anti-enumeration).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly permissions: PermissionsService,
    private readonly auditContext: AuditContextService,
    private readonly events: EventEmitter2,
  ) {}

  // ── Login / logout ────────────────────────────────────────────────

  async login(
    dto: LoginDto,
    ctx: RequestContext,
  ): Promise<{ user: SafeUser; tokens: AuthTokens }> {
    const invalid = new UnauthorizedException('Invalid credentials');

    const identifier = normalizeIdentifier(dto.identifier);
    // One contact may back one account per user type since M09 (guardian
    // who is also staff) — verify the password against every candidate;
    // the (unique) account it matches is the one logging in.
    const candidates = await this.users.findAllByIdentifier(identifier);
    if (candidates.length === 0) throw invalid;

    const unlocked = candidates.filter(
      (c) => !(c.lockedUntil && c.lockedUntil.getTime() > Date.now()),
    );
    if (unlocked.length === 0) {
      throw new HttpException(
        'Account temporarily locked. Try again later.',
        HttpStatus.LOCKED,
      );
    }

    let user: (typeof candidates)[number] | null = null;
    for (const candidate of unlocked) {
      if (await this.passwords.verify(candidate.passwordHash, dto.password)) {
        user = candidate;
        break;
      }
    }
    if (!user) {
      // A failed attempt counts against every unlocked candidate — the
      // attacker targeted the identifier, not one account.
      await Promise.all(unlocked.map((c) => this.handleFailedLogin(c, ctx)));
      throw invalid;
    }

    // Suspended/inactive users can authenticate nothing (M02 §6) — but
    // only after password verification, so status isn't probeable.
    if (user.status !== UserStatus.ACTIVE) throw invalid;

    await this.users.resetLoginCounters(user.id);
    const tokens = await this.issueTokenPair(
      user,
      {
        ip: ctx.ip ?? undefined,
        userAgent: ctx.userAgent ?? undefined,
        deviceName: dto.deviceName,
      },
      dto.rememberMe,
    );

    this.emitActivity(AUTH_EVENTS.LOGGED_IN, {
      userId: user.id,
      event: LoginEvent.LOGIN_SUCCESS,
      ...ctx,
    });
    // Login is @Public (request.user unset) — attribute the audit entry.
    this.auditContext.set({
      userId: user.id,
      schoolId: user.schoolId,
      entityId: user.id,
    });

    return { user: this.toSafeUser(user), tokens };
  }

  async logout(
    userId: string,
    presentedToken: string | undefined,
    dto: LogoutDto,
    ctx: RequestContext,
  ): Promise<void> {
    if (dto.allDevices) {
      await this.refreshTokens.revokeAllForUser(userId);
    } else if (presentedToken) {
      const record = await this.refreshTokens.findByHash(
        this.tokens.hashRefreshToken(presentedToken),
      );
      if (record && record.userId === userId) {
        await this.refreshTokens.revoke(record.id);
      }
    }
    this.emitActivity(AUTH_EVENTS.LOGGED_OUT, {
      userId,
      event: LoginEvent.LOGOUT,
      ...ctx,
    });
  }

  // ── Refresh rotation with reuse detection ─────────────────────────

  async refresh(
    presentedToken: string,
    ctx: RequestContext,
  ): Promise<{ user: SafeUser; tokens: AuthTokens }> {
    const invalid = new UnauthorizedException('Invalid refresh token');

    const record = await this.refreshTokens.findByHash(
      this.tokens.hashRefreshToken(presentedToken),
    );
    if (!record) throw invalid;

    const user = await this.users.findById(record.userId);
    // Guard re-checks user status on refresh (M02 §8) — 15 min worst case.
    if (!user || user.status !== UserStatus.ACTIVE) throw invalid;

    if (record.revokedAt) {
      const withinGrace =
        record.replacedById !== null &&
        Date.now() - record.revokedAt.getTime() < ROTATION_GRACE_MS;
      if (!withinGrace) {
        // Reuse of a rotated/revoked token ⇒ treat as theft: revoke every
        // session of this user and alert them (M02 §6).
        await this.refreshTokens.revokeAllForUser(user.id);
        this.emitActivity(AUTH_EVENTS.TOKEN_REUSE, {
          userId: user.id,
          event: LoginEvent.TOKEN_REUSE,
          alertPhone: user.phone,
          ...ctx,
        });
        throw invalid;
      }
      // else: two-tab race — tolerate one in-flight rotation.
    } else if (record.expiresAt.getTime() <= Date.now()) {
      throw invalid;
    }

    const deviceInfo = (record.deviceInfo ?? {}) as DeviceInfo;
    const tokens = await this.rotate(user, record, deviceInfo);

    this.emitActivity(AUTH_EVENTS.REFRESHED, {
      userId: user.id,
      event: LoginEvent.REFRESH,
      ...ctx,
    });

    return { user: this.toSafeUser(user), tokens };
  }

  // ── Password reset (forgot → OTP → reset) ─────────────────────────

  /** Always resolves without revealing whether the account exists. */
  async forgotPassword(rawIdentifier: string): Promise<void> {
    let identifier: ReturnType<typeof normalizeIdentifier>;
    try {
      identifier = normalizeIdentifier(rawIdentifier);
    } catch {
      return; // silently ignore malformed identifiers too
    }
    const user = await this.users.findByIdentifier(identifier);
    if (!user || user.status !== UserStatus.ACTIVE) return;

    await this.otp.issue(
      identifier.email ?? identifier.phone ?? '',
      OtpPurpose.PASSWORD_RESET,
      user.id,
    );
  }

  /** Consumes the OTP and mints the short-lived reset token. */
  async verifyOtp(
    rawIdentifier: string,
    code: string,
  ): Promise<{ resetToken: string }> {
    const identifier = normalizeIdentifier(rawIdentifier);
    const target = identifier.email ?? identifier.phone ?? '';
    const { userId } = await this.otp.verify(
      target,
      OtpPurpose.PASSWORD_RESET,
      code,
    );
    if (!userId) throw new BadRequestException('Invalid or expired code');
    return { resetToken: this.tokens.signResetToken(userId) };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const { sub } = this.tokens.verifyResetToken(dto.resetToken);
    const user = await this.users.findById(sub);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    await this.passwords.assertAcceptable(dto.newPassword, user.passwordHash);
    await this.users.setPassword(
      user.id,
      await this.passwords.hash(dto.newPassword),
    );
    // A reset proves the previous credential may be compromised.
    await this.refreshTokens.revokeAllForUser(user.id);

    this.emitActivity(AUTH_EVENTS.PASSWORD_CHANGED, {
      userId: user.id,
      event: LoginEvent.PASSWORD_CHANGED,
    });
    // reset-password is @Public — attribute the audit entry.
    this.auditContext.set({
      userId: user.id,
      schoolId: user.schoolId,
      entityId: user.id,
    });
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    presentedRefreshToken: string | undefined,
    ctx: RequestContext,
  ): Promise<void> {
    const user = await this.users.findByIdOrFail(userId);

    if (
      !(await this.passwords.verify(user.passwordHash, dto.currentPassword))
    ) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.passwords.assertAcceptable(dto.newPassword, user.passwordHash);
    await this.users.setPassword(
      userId,
      await this.passwords.hash(dto.newPassword),
    );

    // Revoke every OTHER session; the current device stays signed in.
    const currentHash = presentedRefreshToken
      ? this.tokens.hashRefreshToken(presentedRefreshToken)
      : null;
    const sessions = await this.refreshTokens.listActiveForUser(userId);
    await Promise.all(
      sessions
        .filter((s) => s.tokenHash !== currentHash)
        .map((s) => this.refreshTokens.revoke(s.id)),
    );

    this.emitActivity(AUTH_EVENTS.PASSWORD_CHANGED, {
      userId,
      event: LoginEvent.PASSWORD_CHANGED,
      ...ctx,
    });
  }

  // ── Profile & sessions ────────────────────────────────────────────

  async me(userId: string): Promise<{ user: SafeUser; permissions: string[] }> {
    const user = await this.users.findByIdOrFail(userId);
    // RBAC (M03): Redis-cached role→permission resolution; Super Admins
    // get the full catalog (they bypass the guard anyway).
    const permissions = await this.permissions.getEffectivePermissionCodes(
      user.id,
      user.userType,
    );
    return { user: this.toSafeUser(user), permissions };
  }

  async listSessions(
    userId: string,
    presentedToken?: string,
  ): Promise<
    Array<{
      id: string;
      deviceInfo: DeviceInfo;
      createdAt: Date;
      expiresAt: Date;
      isCurrent: boolean;
    }>
  > {
    const currentHash = presentedToken
      ? this.tokens.hashRefreshToken(presentedToken)
      : null;
    const sessions = await this.refreshTokens.listActiveForUser(userId);
    return sessions.map((s) => ({
      id: s.id,
      deviceInfo: (s.deviceInfo ?? {}) as DeviceInfo,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      isCurrent: s.tokenHash === currentHash,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.refreshTokens.findActiveById(sessionId, userId);
    if (!session) throw new NotFoundException('Session not found');
    await this.refreshTokens.revoke(session.id);
  }

  // ── internals ─────────────────────────────────────────────────────

  private async handleFailedLogin(
    user: User,
    ctx: RequestContext,
  ): Promise<void> {
    const attempts = await this.users.incrementFailedAttempts(user.id);

    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const until = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
      await this.users.lock(user.id, until);
      this.emitActivity(AUTH_EVENTS.LOCKED, {
        userId: user.id,
        event: LoginEvent.LOCKED,
        alertPhone: user.phone,
        ...ctx,
      });
      return;
    }
    this.emitActivity(AUTH_EVENTS.LOGIN_FAILED, {
      userId: user.id,
      event: LoginEvent.LOGIN_FAILED,
      ...ctx,
    });
  }

  private async issueTokenPair(
    user: User,
    deviceInfo: DeviceInfo,
    rememberMe?: boolean,
  ): Promise<AuthTokens> {
    const refresh = this.tokens.generateRefreshToken(rememberMe);
    await this.refreshTokens.issue({
      userId: user.id,
      tokenHash: refresh.tokenHash,
      deviceInfo,
      expiresAt: refresh.expiresAt,
    });
    return {
      accessToken: this.tokens.signAccessToken(user),
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
    };
  }

  /** Issue replacement, then chain old → new (skips chaining on grace re-issue). */
  private async rotate(
    user: User,
    oldRecord: RefreshToken,
    deviceInfo: DeviceInfo,
  ): Promise<AuthTokens> {
    // Preserve the original session window: the replacement expires when
    // the presented token would have.
    const token = this.tokens.generateRefreshToken();
    const issued = await this.refreshTokens.issue({
      userId: user.id,
      tokenHash: token.tokenHash,
      deviceInfo,
      expiresAt: oldRecord.expiresAt,
    });
    if (!oldRecord.revokedAt) {
      await this.refreshTokens.markReplaced(oldRecord.id, issued.id);
    }
    return {
      accessToken: this.tokens.signAccessToken(user),
      refreshToken: token.token,
      refreshExpiresAt: oldRecord.expiresAt,
    };
  }

  private toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      schoolId: user.schoolId,
      email: user.email,
      phone: user.phone,
      userType: user.userType,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt,
    };
  }

  private emitActivity(name: string, payload: AuthActivityEvent): void {
    this.events.emit(name, payload);
  }
}
