import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/**
 * Google reCAPTCHA v2/v3 server-side verification for the public
 * admission endpoints (roadmap M10 §4). Disabled when
 * RECAPTCHA_SECRET_KEY is empty (dev/test) — production sets both keys.
 */
@Injectable()
export class RecaptchaService {
  private readonly logger = new Logger(RecaptchaService.name);
  private readonly secretKey: string;

  constructor(config: ConfigService) {
    this.secretKey = config.get<string>('recaptcha.secretKey') ?? '';
  }

  get enabled(): boolean {
    return this.secretKey.length > 0;
  }

  /** Throws 400 when verification is enabled and the token is missing
   *  or rejected by Google. Network failures fail OPEN with a log —
   *  admissions must not go down with Google. */
  async assertValid(token: string | undefined, ip?: string): Promise<void> {
    if (!this.enabled) return;
    if (!token) {
      throw new BadRequestException('reCAPTCHA verification is required');
    }

    let ok: boolean;
    try {
      const params = new URLSearchParams({
        secret: this.secretKey,
        response: token,
      });
      if (ip) params.set('remoteip', ip);
      const res = await fetch(VERIFY_URL, { method: 'POST', body: params });
      const body = (await res.json()) as { success?: boolean };
      ok = body.success === true;
    } catch (err) {
      this.logger.error(
        `reCAPTCHA verification unreachable — failing open: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    if (!ok) {
      throw new BadRequestException('reCAPTCHA verification failed');
    }
  }
}
