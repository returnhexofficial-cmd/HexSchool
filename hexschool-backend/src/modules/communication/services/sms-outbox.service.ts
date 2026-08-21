import { Injectable } from '@nestjs/common';

/**
 * Dev-only SMS outbox — the SMS counterpart to Mailpit.
 *
 * `LogSmsAdapter` deliberately logs only the *length* of a message, never its
 * body, because the bodies are OTPs and temporary passwords. That is correct
 * for a log, and it makes every SMS-gated flow untestable in a browser: the
 * public admission wizard (M10) opens with a phone-OTP step, so QA could not
 * get past screen one, and the click-through was deferred with the note "once
 * SMS delivery is real (M17)".
 *
 * This captures the body in memory so a QA run can read it back, exactly as
 * Mailpit does for email. It is **off unless explicitly switched on**, and
 * cannot be switched on in production.
 *
 * Enable with `SMS_DEV_OUTBOX=true` (and `NODE_ENV` anything but `production`).
 */
@Injectable()
export class SmsOutboxService {
  /** Bounded so a long-running dev server cannot grow it without limit. */
  private static readonly MAX = 50;

  private readonly messages: SmsOutboxEntry[] = [];

  /**
   * Two independent conditions, both required. The env check means that even
   * if the flag leaks into a production environment file, the outbox stays
   * inert — the same shape as the AUTH_THROTTLE_ENABLED guard.
   */
  get enabled(): boolean {
    return (
      process.env.NODE_ENV !== 'production' &&
      process.env.SMS_DEV_OUTBOX === 'true'
    );
  }

  record(to: string, text: string): void {
    if (!this.enabled) return;
    this.messages.unshift({ to, text, at: new Date().toISOString() });
    if (this.messages.length > SmsOutboxService.MAX) {
      this.messages.length = SmsOutboxService.MAX;
    }
  }

  /** Newest first. Optionally filtered to one recipient. */
  list(to?: string): SmsOutboxEntry[] {
    if (!this.enabled) return [];
    return to ? this.messages.filter((m) => m.to === to) : [...this.messages];
  }

  clear(): void {
    this.messages.length = 0;
  }
}

export interface SmsOutboxEntry {
  to: string;
  text: string;
  at: string;
}
