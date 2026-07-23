import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SmsAdapter, SmsSendInput, SmsSendResult } from './sms.adapter';

/**
 * Log-only SMS fallback — the M02 interim behaviour, kept as the explicit
 * fallback when a school has not configured a gateway (or in dev/e2e). It
 * completes the pipeline deterministically: the notification still becomes
 * SENT with a synthetic provider id and the credit ledger still moves, so
 * the whole flow is testable without a live gateway.
 *
 * The message body is intentionally NOT logged in full at info level once
 * real codes flow (OTPs, temp passwords) — only its length.
 */
@Injectable()
export class LogSmsAdapter implements SmsAdapter {
  readonly name = 'LOG';
  private readonly logger = new Logger(LogSmsAdapter.name);

  isConfigured(): boolean {
    return true;
  }

  send(input: SmsSendInput): Promise<SmsSendResult> {
    this.logger.log(
      `[SMS:log-only] to=${input.to} len=${input.text.length} unicode=${input.unicode}`,
    );
    return Promise.resolve({
      accepted: true,
      providerMsgId: `LOG-${randomUUID()}`,
      raw: { logOnly: true },
    });
  }
}
