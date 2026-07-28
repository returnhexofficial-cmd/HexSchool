/**
 * Fee domain events (roadmap M20 §4: "Auto-posting listeners:
 * `payment.success` → …; `payment.refunded` reversal").
 *
 * The direction matters. FeeModule *emits*; AccountingModule *listens*
 * — so the fee module never learns that accounting exists, and a school
 * running without the ledger loses nothing. It is the M08
 * `teacher.leave.approved` → M12 pattern, and it is why AccountingModule
 * can import FeeModule (for the invoice reads a voucher needs) without a
 * cycle.
 *
 * The payload carries only ids, like the M17 notification queue: the
 * listener re-reads the payment, so it can never act on a stale snapshot
 * and the event stays valid however the row is later enriched.
 */
export const FEE_EVENTS = {
  PAYMENT_SUCCESS: 'payment.success',
  PAYMENT_REFUNDED: 'payment.refunded',
} as const;

export interface PaymentSuccessEvent {
  schoolId: string;
  paymentId: string;
  /** Who took the money; null when a gateway callback concluded it. */
  actorId?: string | null;
}

export interface PaymentRefundedEvent {
  schoolId: string;
  paymentId: string;
  refundId: string;
  amount: number;
  actorId?: string | null;
}
