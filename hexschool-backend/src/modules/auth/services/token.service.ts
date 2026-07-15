import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { User } from '@prisma/client';
import {
  AccessTokenPayload,
  ResetTokenPayload,
} from '../interfaces/token-payload.interface';

export const ACCESS_TOKEN_TTL = '15m';
export const RESET_TOKEN_TTL = '10m';
export const REFRESH_TTL_DAYS = 7;
export const REFRESH_TTL_DAYS_REMEMBERED = 30;
/** JWT clock-skew leeway (roadmap M02 §8). */
export const CLOCK_TOLERANCE_SEC = 30;

/**
 * Token minting/verification only — session bookkeeping (rotation, reuse
 * detection) lives in AuthService. Refresh tokens are opaque random
 * strings, NOT JWTs: revocability requires a DB row anyway, so a
 * signature adds nothing.
 */
@Injectable()
export class TokenService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.accessSecret = config.getOrThrow<string>('jwt.accessSecret');
    this.refreshSecret = config.getOrThrow<string>('jwt.refreshSecret');
  }

  signAccessToken(user: User): string {
    const payload: AccessTokenPayload = {
      sub: user.id,
      schoolId: user.schoolId,
      userType: user.userType,
    };
    return this.jwt.sign(payload, {
      secret: this.accessSecret,
      expiresIn: ACCESS_TOKEN_TTL,
    });
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      return this.jwt.verify<AccessTokenPayload>(token, {
        secret: this.accessSecret,
        clockTolerance: CLOCK_TOLERANCE_SEC,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  /** Opaque refresh token + its SHA-256 hash (only the hash is stored). */
  generateRefreshToken(rememberMe = false): {
    token: string;
    tokenHash: string;
    expiresAt: Date;
  } {
    const token = randomBytes(48).toString('base64url');
    const days = rememberMe ? REFRESH_TTL_DAYS_REMEMBERED : REFRESH_TTL_DAYS;
    return {
      token,
      tokenHash: this.hashRefreshToken(token),
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Reset tokens bridge verify-otp → reset-password. Signed with the
   * refresh secret so a leaked access token can never reset a password.
   */
  signResetToken(userId: string): string {
    const payload: ResetTokenPayload = {
      sub: userId,
      purpose: 'PASSWORD_RESET',
    };
    return this.jwt.sign(payload, {
      secret: this.refreshSecret,
      expiresIn: RESET_TOKEN_TTL,
    });
  }

  verifyResetToken(token: string): ResetTokenPayload {
    try {
      const payload = this.jwt.verify<ResetTokenPayload>(token, {
        secret: this.refreshSecret,
        clockTolerance: CLOCK_TOLERANCE_SEC,
      });
      if (payload.purpose !== 'PASSWORD_RESET') {
        throw new Error('wrong purpose');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
  }
}
