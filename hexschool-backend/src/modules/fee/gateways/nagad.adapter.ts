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

const SANDBOX = 'https://sandbox.mynagad.com:10060';
const LIVE = 'https://api.mynagad.com';

/**
 * Nagad (roadmap M16 §4).
 *
 * Flow: `check-out/initialize/{merchantId}/{orderId}` → `complete` →
 * the payer authorises → we verify with
 * `verify/payment/{paymentRefId}`.
 *
 * **A caveat worth stating plainly:** Nagad's production API signs every
 * request with an RSA key pair the merchant is issued, and this adapter
 * does not implement that signing — it posts the unsigned sandbox shape.
 * That is enough to exercise the flow end to end against sandbox, and
 * `verify` remains the only thing that can declare SUCCESS, so the
 * security model is intact. Wiring the RSA signature is the remaining
 * work before a school takes real Nagad money, and it is recorded as a
 * known limitation rather than hidden behind a plausible-looking
 * implementation.
 */
@Injectable()
export class NagadAdapter implements PaymentGatewayAdapter {
  readonly name = 'NAGAD';
  private readonly logger = new Logger(NagadAdapter.name);

  isConfigured(credentials: GatewayCredentials): boolean {
    return Boolean(credentials.merchantId);
  }

  private base(credentials: GatewayCredentials): string {
    return credentials.sandbox ? SANDBOX : LIVE;
  }

  async init(
    input: InitPaymentInput,
    credentials: GatewayCredentials,
  ): Promise<InitPaymentResult> {
    const merchantId = credentials.merchantId ?? '';
    const initialize = await fetch(
      `${this.base(credentials)}/api/dfs/check-out/initialize/${merchantId}/${input.reference}`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          accountNumber: merchantId,
          dateTime: nagadTimestamp(),
          sensitiveData: '',
          signature: '',
        }),
      },
    );
    const session = (await initialize.json()) as Record<string, unknown>;

    const complete = await fetch(
      `${this.base(credentials)}/api/dfs/check-out/complete/${String(session.paymentReferenceId ?? '')}`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          sensitiveData: '',
          signature: '',
          merchantCallbackURL: input.successUrl,
          additionalMerchantInfo: { invoice: input.reference },
        }),
      },
    );
    const json = (await complete.json()) as Record<string, unknown>;

    if (typeof json.callBackUrl !== 'string') {
      throw new Error(
        `Nagad refused the payment: ${String(json.message ?? json.reason ?? 'unknown')}`,
      );
    }

    return {
      checkoutUrl: json.callBackUrl,
      gatewayRef: String(session.paymentReferenceId ?? input.reference),
    };
  }

  parseCallback(body: Record<string, unknown>): CallbackHint {
    return {
      reference: str(body.order_id) ?? str(body.merchantOrderId),
      gatewayRef: str(body.payment_ref_id) ?? str(body.paymentRefId),
      transactionId: str(body.issuer_payment_ref) ?? str(body.paymentRefId),
      claimedStatus: str(body.status),
    };
  }

  async verify(
    hint: CallbackHint,
    credentials: GatewayCredentials,
  ): Promise<VerificationResult> {
    if (!hint.gatewayRef) {
      return { outcome: 'PENDING', raw: { reason: 'no paymentRefId' } };
    }

    const response = await fetch(
      `${this.base(credentials)}/api/dfs/verify/payment/${hint.gatewayRef}`,
      { headers: this.headers() },
    );
    const raw = (await response.json()) as Record<string, unknown>;

    const status = String(raw.status ?? '');
    const outcome =
      status === 'Success'
        ? 'SUCCESS'
        : status === 'Pending' || status === 'Initiated'
          ? 'PENDING'
          : status === 'Aborted' || status === 'Cancelled'
            ? 'CANCELLED'
            : 'FAILED';

    return {
      outcome,
      transactionId: str(raw.issuerPaymentRefNo) ?? hint.gatewayRef,
      amount: raw.amount === undefined ? undefined : Number(raw.amount),
      raw,
    };
  }

  refund(
    transactionId: string,
    amount: number,
    reason: string,
  ): Promise<RefundResult> {
    // Nagad's merchant refund API is not open to all merchant tiers;
    // refusing loudly beats pretending a refund went through.
    return Promise.resolve({
      accepted: false,
      message:
        'Nagad refunds are not available through the merchant API — refund manually via the Nagad portal and record it here',
      raw: { transactionId, amount, reason },
    });
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-KM-Api-Version': 'v-0.2.0',
      'X-KM-IP-V4': '127.0.0.1',
      'X-KM-Client-Type': 'PC_WEB',
    };
  }
}

function nagadTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
