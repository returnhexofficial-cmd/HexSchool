import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SettingsService } from './settings.service';

export interface TestResult {
  ok: boolean;
  detail: string;
}

/**
 * "Send test" endpoints (roadmap M04 §4): exercise the SAVED gateway
 * config — not the global env SMTP — and surface the provider error
 * verbatim so admins can fix credentials (M04 §8). Saving invalid
 * credentials is allowed; these endpoints are how they get verified.
 */
@Injectable()
export class SettingsTestService {
  private readonly logger = new Logger(SettingsTestService.name);

  constructor(private readonly settings: SettingsService) {}

  async testEmail(actor: AccessTokenPayload, to?: string): Promise<TestResult> {
    const schoolId = actor.schoolId;
    const [host, port, user, pass, fromName, fromEmail] = await Promise.all([
      this.settings.getValue<string>(schoolId, 'email.smtp_host'),
      this.settings.getValue<number>(schoolId, 'email.smtp_port'),
      this.settings.getValue<string>(schoolId, 'email.smtp_user'),
      this.settings.getValue<string>(schoolId, 'email.smtp_pass'),
      this.settings.getValue<string>(schoolId, 'email.from_name'),
      this.settings.getValue<string>(schoolId, 'email.from_email'),
    ]);
    if (!host || !fromEmail) {
      throw new BadRequestException(
        'Configure email.smtp_host and email.from_email first',
      );
    }

    const transport = createTransport({
      host,
      port,
      secure: port === 465,
      auth: user ? { user, pass } : undefined,
      connectionTimeout: 10_000,
    });
    try {
      await transport.sendMail({
        from: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
        to: to ?? fromEmail,
        subject: 'HexSchool SMIS — test email',
        text: 'Your email gateway settings work. — HexSchool SMIS',
      });
      return { ok: true, detail: `Test email sent to ${to ?? fromEmail}` };
    } catch (err) {
      // Surface the provider error; the config stays saved (unverified).
      return {
        ok: false,
        detail: err instanceof Error ? err.message : 'SMTP send failed',
      };
    } finally {
      transport.close();
    }
  }

  async testSms(actor: AccessTokenPayload, to?: string): Promise<TestResult> {
    const provider = await this.settings.getValue<string>(
      actor.schoolId,
      'sms.provider',
    );
    const target = to ?? 'saved-sender';
    // Real BD gateway adapter lands in Module 17 — log-only until then,
    // consistent with the notifications queue behavior.
    this.logger.log(
      `[SMS:test:log-only] school=${actor.schoolId} provider="${provider}" to=${target}`,
    );
    return {
      ok: true,
      detail:
        'SMS gateway integration arrives in Module 17 — test was logged only',
    };
  }
}
