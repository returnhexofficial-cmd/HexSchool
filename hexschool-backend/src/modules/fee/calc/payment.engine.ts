/**
 * Payment allocation and refund rules (roadmap M16 §6).
 *
 * Dependency-free. The collection desk takes one sum of money against a
 * basket of invoices — a guardian paying for two siblings, or three
 * months at once — so something has to decide which bill each taka
 * settles. Getting it wrong is not cosmetic: it decides which invoice
 * goes on accruing a fine.
 *
 * **Oldest due date first.** The invoice that has been outstanding
 * longest is settled first, which is what stops a partial payment
 * leaving the oldest bill accruing while a newer one is cleared.
 */

import { money } from './money.util';

export interface PayableInvoice {
  invoiceId: string;
  invoiceNo: string;
  dueDate: string;
  payable: number;
  paidTotal: number;
}

export interface Allocation {
  invoiceId: string;
  invoiceNo: string;
  amount: number;
  /** Outstanding on this invoice after the allocation. */
  remaining: number;
}

export interface AllocationResult {
  allocations: Allocation[];
  /** Money that found no invoice to settle — refused by the service. */
  unallocated: number;
  totalAllocated: number;
}

/** Outstanding on one invoice. */
export function outstanding(invoice: PayableInvoice): number {
  return Math.max(0, money(invoice.payable - invoice.paidTotal));
}

/**
 * Spread `amount` across `invoices`, oldest due date first.
 *
 * Never allocates more than an invoice's outstanding balance —
 * overpayment is a deliberate, permission-gated act elsewhere, not
 * something that happens by accident because someone rounded up.
 */
export function allocatePayment(
  amount: number,
  invoices: PayableInvoice[],
): AllocationResult {
  let remaining = money(amount);
  const allocations: Allocation[] = [];

  const ordered = [...invoices].sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      a.invoiceNo.localeCompare(b.invoiceNo),
  );

  for (const invoice of ordered) {
    if (remaining <= 0) break;
    const due = outstanding(invoice);
    if (due <= 0) continue;

    const applied = money(Math.min(due, remaining));
    remaining = money(remaining - applied);
    allocations.push({
      invoiceId: invoice.invoiceId,
      invoiceNo: invoice.invoiceNo,
      amount: applied,
      remaining: money(due - applied),
    });
  }

  return {
    allocations,
    unallocated: remaining,
    totalAllocated: money(amount - remaining),
  };
}

export interface RefundInput {
  paymentAmount: number;
  /** Already refunded against this payment. */
  refundedSoFar: number;
  requested: number;
  isRefundable: boolean;
}

export type RefundRefusal =
  | 'NOT_REFUNDABLE'
  | 'EXCEEDS_PAYMENT'
  | 'NON_POSITIVE'
  | null;

/**
 * Whether a refund may proceed. A payment can be refunded in parts, but
 * never beyond what was taken — and a head marked non-refundable (an
 * admission fee, typically) refuses outright.
 */
export function refundRefusal(input: RefundInput): RefundRefusal {
  if (!input.isRefundable) return 'NOT_REFUNDABLE';
  if (money(input.requested) <= 0) return 'NON_POSITIVE';
  const headroom = money(input.paymentAmount - input.refundedSoFar);
  if (money(input.requested) > headroom) return 'EXCEEDS_PAYMENT';
  return null;
}

/** Human text for a refusal — surfaced verbatim in the 409. */
export function refundRefusalMessage(
  refusal: Exclude<RefundRefusal, null>,
  input: RefundInput,
): string {
  switch (refusal) {
    case 'NOT_REFUNDABLE':
      return 'This payment covers a non-refundable fee head';
    case 'NON_POSITIVE':
      return 'Refund amount must be greater than zero';
    case 'EXCEEDS_PAYMENT':
      return `Refund exceeds what is left of this payment (${money(
        input.paymentAmount - input.refundedSoFar,
      )} available)`;
  }
}
