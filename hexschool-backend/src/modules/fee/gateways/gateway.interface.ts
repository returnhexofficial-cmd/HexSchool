/**
 * The payment-gateway contract (roadmap M16 §4, adapter pattern).
 *
 * Three Bangladeshi gateways with three different APIs, reduced to the
 * four operations this module actually needs. The single rule every
 * adapter obeys:
 *
 *   **`verify()` is the only thing that may say SUCCESS.** A gateway's
 *   redirect back to the browser carries parameters anyone can forge, so
 *   the callback handler treats them as a *hint* about which payment to
 *   look at and then asks the gateway's own API what really happened
 *   (roadmap M16 §6). No adapter's `parseCallback` returns a verdict.
 */

export interface GatewayCredentials {
  sandbox: boolean;
  storeId?: string;
  storePassword?: string;
  appKey?: string;
  appSecret?: string;
  merchantId?: string;
}

export interface InitPaymentInput {
  /** Our own reference, echoed back by the gateway. */
  reference: string;
  amount: number;
  currency: 'BDT';
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  /** Where the gateway returns the payer. */
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  /** Server-to-server notification endpoint. */
  ipnUrl: string;
}

export interface InitPaymentResult {
  /** Where to send the payer's browser. */
  checkoutUrl: string;
  /** The gateway's own handle for this session — stored on the payment. */
  gatewayRef: string;
}

/** What a callback body tells us — a hint, never a verdict. */
export interface CallbackHint {
  /** Our reference, if the gateway echoed it. */
  reference?: string;
  /** The gateway's session handle. */
  gatewayRef?: string;
  /** The gateway's transaction id, once it exists. */
  transactionId?: string;
  /** The gateway's own claim about the outcome — informational only. */
  claimedStatus?: string;
}

export type VerifiedOutcome = 'SUCCESS' | 'FAILED' | 'PENDING' | 'CANCELLED';

export interface VerificationResult {
  outcome: VerifiedOutcome;
  /** The gateway's transaction id, present once money moved. */
  transactionId?: string;
  /** What the gateway says was actually charged — checked against ours. */
  amount?: number;
  /** The raw response, stored on the payment for reconciliation. */
  raw: Record<string, unknown>;
}

export interface RefundResult {
  accepted: boolean;
  refundId?: string;
  message?: string;
  raw: Record<string, unknown>;
}

export interface PaymentGatewayAdapter {
  /** `SSLCOMMERZ` | `BKASH` | `NAGAD`. */
  readonly name: string;

  /** Are this school's credentials complete enough to transact? */
  isConfigured(credentials: GatewayCredentials): boolean;

  /** Open a checkout session and return where to send the payer. */
  init(
    input: InitPaymentInput,
    credentials: GatewayCredentials,
  ): Promise<InitPaymentResult>;

  /**
   * Read a callback body. Returns only *which payment this is about* —
   * never whether it succeeded.
   */
  parseCallback(body: Record<string, unknown>): CallbackHint;

  /**
   * Ask the gateway what really happened. **The only source of truth.**
   * Also used by the reconciliation job for payments left PENDING.
   */
  verify(
    hint: CallbackHint,
    credentials: GatewayCredentials,
  ): Promise<VerificationResult>;

  refund(
    transactionId: string,
    amount: number,
    reason: string,
    credentials: GatewayCredentials,
  ): Promise<RefundResult>;
}

/** DI token for the adapter registry. */
export const PAYMENT_GATEWAYS = Symbol('PAYMENT_GATEWAYS');
