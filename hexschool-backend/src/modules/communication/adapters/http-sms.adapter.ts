import { Injectable, Logger } from '@nestjs/common';
import {
  SmsAdapter,
  SmsCredentials,
  SmsSendInput,
  SmsSendResult,
} from './sms.adapter';

/**
 * The one concrete BD SMS gateway adapter (roadmap M17 §4). Most
 * Bangladeshi providers (BulkSMSBD, Mimsms, Reve, …) expose the same
 * shape: a GET/POST with `api_key`, `senderid`, `number`, `message`, and a
 * `type` flag for unicode. The endpoint is a school setting, so a new
 * provider is a config change, not a code change.
 *
 * A masked sender id is passed through verbatim; the numeric vs branded
 * distinction is the provider account's, we only forward the configured id
 * and the masking flag for providers that want it echoed.
 */
@Injectable()
export class HttpSmsAdapter implements SmsAdapter {
  readonly name = 'HTTP';
  private readonly logger = new Logger(HttpSmsAdapter.name);

  isConfigured(c: SmsCredentials): boolean {
    return Boolean(c.enabled && c.apiUrl && c.apiKey && c.senderId);
  }

  async send(input: SmsSendInput, c: SmsCredentials): Promise<SmsSendResult> {
    const params = new URLSearchParams({
      api_key: c.apiKey,
      senderid: c.senderId,
      number: input.to,
      message: input.text,
      type: input.unicode ? 'unicode' : 'text',
      masking: c.masking ? '1' : '0',
    });

    const url = c.apiUrl.includes('?')
      ? `${c.apiUrl}&${params.toString()}`
      : `${c.apiUrl}?${params.toString()}`;

    try {
      const response = await fetch(url, { method: 'GET' });
      const bodyText = await response.text();
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(bodyText) as Record<string, unknown>;
      } catch {
        raw = { body: bodyText };
      }

      if (!response.ok) {
        return {
          accepted: false,
          error: `Gateway HTTP ${response.status}`,
          raw,
        };
      }

      // Providers signal success differently; treat a non-error HTTP 200
      // as accepted and surface whatever id/label the body carries.
      const providerMsgId =
        (raw.message_id as string | undefined) ??
        (raw.messageId as string | undefined) ??
        (raw.smsid as string | undefined);

      return { accepted: true, providerMsgId, raw };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`SMS gateway call failed: ${message}`);
      // A network failure is retryable — the dispatcher lets BullMQ retry.
      throw error;
    }
  }
}
