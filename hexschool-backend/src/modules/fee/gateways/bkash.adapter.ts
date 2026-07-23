import { Injectable, Logger } from '@nestjs/common';
import {
  CallbackHint,
  GatewayCredentials,
  InitPaymentInput,
  InitPaymentResult,
  PaymentGatewayAdapter,
  RefundResult,
  VerificationResult,
} from './gateway.interface';

const SANDBOX = 'https://tokenized.sandbox.bka.sh/v1.2.0-beta';
const LIVE = 'https://tokenized.pay.bka.sh/v1.2.0-beta';

/**
 * bKash Tokenized Checkout (roadmap M16 §4).
 *
 * Flow: grant a token → `create` a payment (returns `paymentID` and
 * `bkashURL`) → the payer authorises in the app → we `execute` it, and
 * `execute` is the call that actually moves the money.
 *
 * Two bKash-specific facts shape this adapter:
 *   - **The token is short-lived** (~1 hour), so it is fetched per
 *     operation rather than cached. A school takes a handful of online
 *     payments an hour; the extra round trip is cheaper than a stale
 *     token failing a live payment.
 *   - **`execute` is not idempotent-safe to guess at.** If the payer
 *     closed the app, `execute` fails and the payment stays PENDING —
 *     which is exactly what the reconciliation job is for, and why
 *     `verify` falls back to `payment/status`.
 */
@Injectable()
export class BkashAdapter implements PaymentGatewayAdapter {
  readonly name = 'BKASH';
  private readonly logger = new Logger(BkashAdapter.name);

  isConfigured(credentials: GatewayCredentials): boolean {
    return Boolean(
      credentials.appKey && credentials.appSecret && credentials.storeId,
    );
  }

  private base(credentials: GatewayCredentials): string {
    return credentials.sandbox ? SANDBOX : LIVE;
  }

  /** bKash tokens expire in about an hour — fetch one per operation. */
  private async token(credentials: GatewayCredentials): Promise<string> {
    const response = await fetch(`${this.base(credentials)}/tokenized/checkout/token/grant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        username: credentials.storeId ?? '',
        password: credentials.storePassword ?? '',
      },
      body: JSON.stringify({
        app_key: credentials.appKey,
        app_secret: credentials.appSecret,
      }),
    });
    const json = (await response.json()) as Record<string, unknown>;
    const token = json.id_token;
    if (typeof token !== 'string') {
      throw new Error(
        `bKash refused a token: ${String(json.statusMessage ?? 'unknown')}`,
      );
    }
    return token;
  }

  private headers(token: string, credentials: GatewayCredentials) {
    return {
      'Content-Type': 'application/json',
      Authorization: token,
      'X-APP-Key': credentials.appKey ?? '',
    };
  }

  async init(
    input: InitPaymentInput,
    credentials: GatewayCredentials,
  ): Promise<InitPaymentResult> {
    const token = await this.token(credentials);
    const response = await fetch(
      `${this.base(credentials)}/tokenized/checkout/create`,
      {
        method: 'POST',
        headers: this.headers(token, credentials),
        body: JSON.stringify({
          mode: '0011',
          payerReference: input.customerPhone ?? input.reference,
          callbackURL: input.successUrl,
          amount: input.amount.toFixed(2),
          currency: input.currency,
          intent: 'sale',
          merchantInvoiceNumber: input.reference,
        }),
      },
    );
    const json = (await response.json()) as Record<string, unknown>;

    if (typeof json.bkashURL !== 'string' || typeof json.paymentID !== 'string') {
      throw new Error(
        `bKash refused the payment: ${String(json.statusMessage ?? 'unknown')}`,
      );
    }

    return { checkoutUrl: json.bkashURL, gatewayRef: json.paymentID };
  }

  parseCallback(body: Record<string, unknown>): CallbackHint {
    return {
      reference: str(body.merchantInvoiceNumber),
      gatewayRef: str(body.paymentID),
      transactionId: str(body.trxID),
      claimedStatus: str(body.status),
    };
  }

  /**
   * Execute the payment, falling back to a status query. `execute` both
   * verifies and completes with bKash, so a payment the payer abandoned
   * comes back as anything but Completed and stays PENDING.
   */
  async verify(
    hint: CallbackHint,
    credentials: GatewayCredentials,
  ): Promise<VerificationResult> {
    if (!hint.gatewayRef) {
      return { outcome: 'PENDING', raw: { reason: 'no paymentID' } };
    }

    // The payer explicitly cancelled — no point calling execute.
    if (hint.claimedStatus === 'cancel') {
      return { outcome: 'CANCELLED', raw: { claimed: hint.claimedStatus } };
    }
    if (hint.claimedStatus === 'failure') {
      return { outcome: 'FAILED', raw: { claimed: hint.claimedStatus } };
    }

    const token = await this.token(credentials);
    let raw = await this.post(
      `${this.base(credentials)}/tokenized/checkout/execute`,
      token,
      credentials,
      { paymentID: hint.gatewayRef },
    );

    // An already-executed payment errors on execute; ask its status.
    if (str(raw.transactionStatus) === undefined) {
      raw = await this.post(
        `${this.base(credentials)}/tokenized/checkout/payment/status`,
        token,
        credentials,
        { paymentID: hint.gatewayRef },
      );
    }

    const status = String(raw.transactionStatus ?? '');
    const outcome =
      status === 'Completed'
        ? 'SUCCESS'
        : status === 'Initiated'
          ? 'PENDING'
          : status === 'Cancelled'
            ? 'CANCELLED'
            : 'FAILED';

    return {
      outcome,
      transactionId: str(raw.trxID),
      amount: raw.amount === undefined ? undefined : Number(raw.amount),
      raw,
    };
  }

  async refund(
    transactionId: string,
    amount: number,
    reason: string,
    credentials: GatewayCredentials,
  ): Promise<RefundResult> {
    const token = await this.token(credentials);
    const raw = await this.post(
      `${this.base(credentials)}/tokenized/checkout/payment/refund`,
      token,
      credentials,
      {
        paymentID: transactionId,
        amount: amount.toFixed(2),
        trxID: transactionId,
        sku: 'fees',
        reason,
      },
    );

    return {
      accepted: String(raw.transactionStatus ?? '') === 'Completed',
      refundId: str(raw.refundTrxID),
      message: str(raw.statusMessage),
      raw,
    };
  }

  private async post(
    url: string,
    token: string,
    credentials: GatewayCredentials,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers(token, credentials),
      body: JSON.stringify(body),
    });
    return (await response.json()) as Record<string, unknown>;
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
