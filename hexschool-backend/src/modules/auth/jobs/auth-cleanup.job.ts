import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OtpCodesRepository } from '../repositories/otp-codes.repository';
import { RefreshTokensRepository } from '../repositories/refresh-tokens.repository';

/** Retention window for expired tokens / old OTP rows (roadmap M02 §Jobs). */
const PURGE_AFTER_DAYS = 30;

@Injectable()
export class AuthCleanupJob {
  private readonly logger = new Logger(AuthCleanupJob.name);

  constructor(
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly otpCodes: OtpCodesRepository,
  ) {}

  /** Nightly at 03:00 (server runs UTC; timing is not business-critical). */
  @Cron('0 3 * * *')
  async purge(): Promise<void> {
    const tokens = await this.refreshTokens.purgeExpired(PURGE_AFTER_DAYS);
    const otps = await this.otpCodes.purgeOld(PURGE_AFTER_DAYS);
    this.logger.log(
      `Auth cleanup: purged ${tokens} expired refresh tokens, ${otps} old OTP codes`,
    );
  }
}
