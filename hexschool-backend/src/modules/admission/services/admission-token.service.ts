import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

export const PHONE_TOKEN_TTL = '30m';
const PHONE_TOKEN_PURPOSE = 'admission-phone';

interface PhoneTokenPayload {
  phone: string;
  purpose: typeof PHONE_TOKEN_PURPOSE;
}

/**
 * Short-lived proof that a public applicant verified their phone via OTP
 * (roadmap M10 §4). Verify-otp mints it; apply/photo-upload require it.
 * Signed with the access secret — no DB row needed, expiry bounds abuse.
 */
@Injectable()
export class AdmissionTokenService {
  private readonly secret: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('jwt.accessSecret');
  }

  signPhoneToken(phone: string): string {
    const payload: PhoneTokenPayload = {
      phone,
      purpose: PHONE_TOKEN_PURPOSE,
    };
    return this.jwt.sign(payload, {
      secret: this.secret,
      expiresIn: PHONE_TOKEN_TTL,
    });
  }

  /** Returns the verified phone; throws 401 on any mismatch. */
  verifyPhoneToken(token: string): string {
    try {
      const payload = this.jwt.verify<PhoneTokenPayload>(token, {
        secret: this.secret,
        clockTolerance: 30,
      });
      if (payload.purpose !== PHONE_TOKEN_PURPOSE) throw new Error('purpose');
      return payload.phone;
    } catch {
      throw new UnauthorizedException(
        'Phone verification expired — verify your number again',
      );
    }
  }
}
