import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { createHash, randomInt } from 'crypto';
import type { Queue } from 'bullmq';
import { OtpPurpose } from '../../../common/constants';
import {
  NOTIFICATIONS_QUEUE,
  NotificationJob,
} from '../../../queues/queues.constants';
import { OtpCodesRepository } from '../repositories/otp-codes.repository';

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 3;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * 6-digit one-time codes: hash-stored, 5 min expiry, max 3 verify
 * attempts, 60 s resend cooldown. Dispatch goes through the notifications
 * queue — "code sent" is only reported after enqueue succeeds (M02 §8).
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly otpCodes: OtpCodesRepository,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notifications: Queue<NotificationJob>,
  ) {}

  /**
   * Generates, stores (hashed), and dispatches a code to `identifier`
   * (normalized email or phone). Supersedes any outstanding code.
   */
  async issue(
    identifier: string,
    purpose: OtpPurpose,
    userId: string | null,
  ): Promise<void> {
    const latest = await this.otpCodes.findLatestActive(identifier, purpose);
    if (
      latest &&
      Date.now() - latest.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS
    ) {
      throw new HttpException(
        'Please wait a minute before requesting another code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    await this.otpCodes.consumeActive(identifier, purpose);
    await this.otpCodes.createCode({
      userId,
      identifier,
      codeHash: this.hashCode(identifier, code),
      purpose,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });

    const isEmail = identifier.includes('@');
    const text =
      `Your HexSchool verification code is ${code}. ` +
      'It expires in 5 minutes. Never share this code.';
    await this.notifications.add(
      isEmail ? 'email' : 'sms',
      isEmail
        ? {
            type: 'email',
            to: identifier,
            subject: 'Your HexSchool verification code',
            text,
          }
        : { type: 'sms', to: identifier, text },
    );
  }

  /**
   * Validates a submitted code; consumes it on success. Rejects when
   * expired, already consumed, over the attempt limit, or wrong.
   */
  async verify(
    identifier: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<{ userId: string | null }> {
    const otp = await this.otpCodes.findLatestActive(identifier, purpose);
    const invalid = new BadRequestException('Invalid or expired code');

    if (!otp) throw invalid;
    if (otp.expiresAt.getTime() < Date.now()) throw invalid;
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw invalid;

    if (otp.codeHash !== this.hashCode(identifier, code)) {
      const attempts = await this.otpCodes.incrementAttempts(otp.id);
      if (attempts >= OTP_MAX_ATTEMPTS) {
        await this.otpCodes.markConsumed(otp.id);
      }
      throw invalid;
    }

    await this.otpCodes.markConsumed(otp.id);
    return { userId: otp.userId };
  }

  /** SHA-256 over identifier+code so equal codes hash differently per target. */
  private hashCode(identifier: string, code: string): string {
    return createHash('sha256').update(`${identifier}:${code}`).digest('hex');
  }
}
