/**
 * Late fines (roadmap M16 §4) and the invoice status machine.
 *
 * Dependency-free. The two things worth stating:
 *
 *   - **The fine job must be idempotent per month.** It runs nightly, so
 *     without a guard a school that leaves an invoice unpaid for a week
 *     charges seven fines. `finedForMonth` is the stamp; this engine
 *     decides whether a charge is due, and the caller records it.
 *   - **Status is derived, never assigned by hand.** Every path that
 *     touches money recomputes it from the same function, so a partial
 *     refund and a partial payment cannot disagree about what PARTIAL
 *     means.
 */

import { InvoiceStatus } from '../../../common/constants';
import { clampMoney, money, percentOf } from './money.util';

export interface FineConfig {
  /** Days after the due date before a fine may be charged. */
  graceDays: number;
  /** Flat amount per overdue month (0 = off). */
  flatPerMonth: number;
  /** Percent of the payable per overdue month (0 = off). */
  percentPerMonth: number;
  /** Absolute ceiling on accumulated fine for one invoice (0 = uncapped). */
  cap: number;
}

export interface FineInput {
  payable: number;
  /** Fine already charged on this invoice. */
  fineSoFar: number;
  dueDate: string;
  today: string;
  /** First day of the month the fine job last charged, or null. */
  finedForMonth: string | null;
  /** The month being charged now, as `YYYY-MM-01`. */
  currentMonth: string;
}

export interface FineVerdict {
  /** Additional fine to add now (0 when nothing is due). */
  charge: number;
  reason:
    | 'CHARGED'
    | 'NOT_OVERDUE'
    | 'WITHIN_GRACE'
    | 'ALREADY_FINED_THIS_MONTH'
    | 'CAP_REACHED'
    | 'NOT_CONFIGURED';
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000);
}

/**
 * What (if anything) tonight's fine run should add to this invoice.
 *
 * Charges at most once per calendar month, which is what makes running
 * the job nightly safe.
 */
export function assessFine(
  input: FineInput,
  config: FineConfig,
): FineVerdict {
  if (config.flatPerMonth <= 0 && config.percentPerMonth <= 0) {
    return { charge: 0, reason: 'NOT_CONFIGURED' };
  }

  const overdueDays = daysBetween(input.dueDate, input.today);
  if (overdueDays <= 0) return { charge: 0, reason: 'NOT_OVERDUE' };
  if (overdueDays <= config.graceDays) {
    return { charge: 0, reason: 'WITHIN_GRACE' };
  }

  // The idempotency guard: one charge per calendar month, however many
  // times the job runs.
  if (input.finedForMonth === input.currentMonth) {
    return { charge: 0, reason: 'ALREADY_FINED_THIS_MONTH' };
  }

  const monthly = money(
    config.flatPerMonth + percentOf(input.payable, config.percentPerMonth),
  );
  if (monthly <= 0) return { charge: 0, reason: 'NOT_CONFIGURED' };

  if (config.cap > 0) {
    const headroom = money(config.cap - input.fineSoFar);
    if (headroom <= 0) return { charge: 0, reason: 'CAP_REACHED' };
    return { charge: clampMoney(monthly, headroom), reason: 'CHARGED' };
  }

  return { charge: monthly, reason: 'CHARGED' };
}

export interface StatusInput {
  payable: number;
  paidTotal: number;
  dueDate: string;
  today: string;
  cancelled: boolean;
  /** Every successful payment has been refunded. */
  fullyRefunded: boolean;
}

/**
 * The invoice's money state, derived. Precedence matters: an
 * administrative state (cancelled, refunded) outranks a computed one,
 * and PAID outranks OVERDUE — a bill settled late is paid, not overdue.
 */
export function deriveStatus(input: StatusInput): InvoiceStatus {
  if (input.cancelled) return InvoiceStatus.CANCELLED;
  if (input.fullyRefunded) return InvoiceStatus.REFUNDED;

  const payable = money(input.payable);
  const paid = money(input.paidTotal);

  if (paid >= payable && payable > 0) return InvoiceStatus.PAID;
  // A zero-payable invoice (fully waived) is settled by definition.
  if (payable <= 0) return InvoiceStatus.PAID;

  const overdue = daysBetween(input.dueDate, input.today) > 0;
  if (paid > 0) return overdue ? InvoiceStatus.OVERDUE : InvoiceStatus.PARTIAL;
  return overdue ? InvoiceStatus.OVERDUE : InvoiceStatus.UNPAID;
}

/** Aging bucket for the dues report (roadmap M16 §4). */
export function agingBucket(
  dueDate: string,
  today: string,
): '0-30' | '31-60' | '61-90' | '90+' | 'CURRENT' {
  const overdue = daysBetween(dueDate, today);
  if (overdue <= 0) return 'CURRENT';
  if (overdue <= 30) return '0-30';
  if (overdue <= 60) return '31-60';
  if (overdue <= 90) return '61-90';
  return '90+';
}
