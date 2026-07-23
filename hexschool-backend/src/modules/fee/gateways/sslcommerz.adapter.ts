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

const SANDBOX = 'https://sandbox.sslcommerz.com';
const LIVE = 'https://securepay.sslcommerz.com';

/**
 * SSLCommerz (roadmap M16 §4).
 *
 * Flow: POST the session request → get a `GatewayPageURL` and a
 * `sessionkey` → the payer pays → SSLCommerz calls our IPN and redirects
 * the browser with a `val_id` → we call `validationserverAPI` with that
 * `val_id` and believe **only** what it returns.
 *
 * The redirect parameters are not trusted for anything except telling us
 * which payment to validate — a forged redirect claiming VALID gets
 * validated against SSLCommerz and comes back FAILED.
 */
@Injectable()
export class SslcommerzAdapter implements PaymentGatewayAdapter {
  readonly name = 'SSLCOMMERZ';
  private readonly logger = new Logger(SslcommerzAdapter.name);

  isConfigured(credentials: GatewayCredentials): boolean {
    return Boolean(credentials.storeId && credentials.storePassword);
  }

  private base(credentials: GatewayCredentials): string {
    return credentials.sandbox ? SANDBOX : LIVE;
  }

  async init(
    input: InitPaymentInput,
    credentials: GatewayCredentials,
  ): Promise<InitPaymentResult> {
    const body = new URLSearchParams({
      store_id: credentials.storeId ?? '',
      store_passwd: credentials.storePassword ?? '',
      total_amount: input.amount.toFixed(2),
      currency: input.currency,
      tran_id: input.reference,
      success_url: input.successUrl,
      fail_url: input.failUrl,
      cancel_url: input.cancelUrl,
      ipn_url: input.ipnUrl,
      cus_name: input.customerName,
      cus_email: input.customerEmail ?? 'noreply@hexschool.local',
      cus_phone: input.customerPhone ?? '01700000000',
      // SSLCommerz rejects a session without these, though a school fee
      // is not a shipped product.
      shipping_method: 'NO',
      product_name: 'School fees',
      product_category: 'Education',
      product_profile: 'non-physical-goods',
    });

    const response = await fetch(`${this.base(credentials)}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await response.json()) as Record<string, unknown>;

    if (json.status !== 'SUCCESS' || typeof json.GatewayPageURL !== 'string') {
      throw new Error(
        `SSLCommerz refused the session: ${String(json.failedreason ?? json.status ?? 'unknown')}`,
      );
    }

    return {
      checkoutUrl: json.GatewayPageURL,
      gatewayRef: String(json.sessionkey ?? input.reference),
    };
  }

  parseCallback(body: Record<string, unknown>): CallbackHint {
    return {
      reference: str(body.tran_id),
      gatewayRef: str(body.sessionkey),
      // `val_id` is the handle we validate with — not proof of anything.
      transactionId: str(body.val_id),
      claimedStatus: str(body.status),
    };
  }

  async verify(
    hint: CallbackHint,
    credentials: GatewayCredentials,
  ): Promise<VerificationResult> {
    if (!hint.transactionId) {
      return { outcome: 'PENDING', raw: { reason: 'no val_id to validate' } };
    }

    const url = new URL(
      `${this.base(credentials)}/validator/api/validationserverAPI.php`,
    );
    url.searchParams.set('val_id', hint.transactionId);
    url.searchParams.set('store_id', credentials.storeId ?? '');
    url.searchParams.set('store_passwd', credentials.storePassword ?? '');
    url.searchParams.set('format', 'json');

    const response = await fetch(url);
    const raw = (await response.json()) as Record<string, unknown>;

    // VALID / VALIDATED are the only two SSLCommerz states that mean the
    // money moved.
    const status = String(raw.status ?? '');
    const outcome =
      status === 'VALID' || status === 'VALIDATED'
        ? 'SUCCESS'
        : status === 'PENDING'
          ? 'PENDING'
          : status === 'CANCELLED'
            ? 'CANCELLED'
            : 'FAILED';

    return {
      outcome,
      transactionId: str(raw.bank_tran_id) ?? hint.transactionId,
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
    const url = new URL(
      `${this.base(credentials)}/validator/api/merchantTransIDvalidationAPI.php`,
    );
    url.searchParams.set('bank_tran_id', transactionId);
    url.searchParams.set('refund_amount', amount.toFixed(2));
    url.searchParams.set('refund_remarks', reason);
    url.searchParams.set('store_id', credentials.storeId ?? '');
    url.searchParams.set('store_passwd', credentials.storePassword ?? '');
    url.searchParams.set('format', 'json');
    url.searchParams.set('v', '1');

    const response = await fetch(url);
    const raw = (await response.json()) as Record<string, unknown>;
    const status = String(raw.status ?? '');

    return {
      accepted: status === 'success' || status === 'SUCCESS',
      refundId: str(raw.refund_ref_id),
      message: str(raw.errorReason),
      raw,
    };
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
