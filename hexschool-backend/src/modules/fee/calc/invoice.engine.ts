/**
 * Invoice building (roadmap M16 §4/§6): fee structures + per-student
 * overrides + proration → the lines of one bill.
 *
 * Dependency-free and golden-tested (PROJECT_CONTEXT §4). Three rules
 * carry the domain, and each is a place a naive implementation quietly
 * overcharges someone:
 *
 *   1. **Discounts stack percent-first, then flat, capped at the line.**
 *      Order matters: 10 % then ৳100 off ৳1,000 is ৳800; ৳100 then 10 %
 *      is ৳810. The roadmap fixes the order (§9) so two students with
 *      the same concessions are never billed differently.
 *   2. **A WAIVER wins outright.** It is not a 100 % discount competing
 *      with the others — it zeroes the line and stops.
 *   3. **Proration is by day, not by half-month.** A student joining on
 *      the 20th of a 31-day month owes 12/31, and the school's setting
 *      decides whether the joining day itself counts.
 */

import { FeeOverrideType } from '../../../common/constants';
import { clampMoney, money, percentOf, sumMoney } from './money.util';

/** A billable line before concessions — one fee structure row. */
export interface BillableHead {
  feeHeadId: string;
  feeHeadName: string;
  amount: number;
  /** RECURRING_MONTHLY heads prorate; the others never do. */
  prorated: boolean;
}

/** A concession in force for this candidate and head. */
export interface Concession {
  feeHeadId: string;
  type: FeeOverrideType;
  value: number;
  reason: string;
}

export interface InvoiceLine {
  feeHeadId: string;
  description: string;
  /** Gross, after proration but before concessions. */
  amount: number;
  discount: number;
  /** Why the line is reduced — printed on the receipt. */
  note: string | null;
}

export interface BuiltInvoice {
  lines: InvoiceLine[];
  subtotal: number;
  discountTotal: number;
  /** subtotal - discountTotal (fines are added later, by the fine job). */
  payable: number;
}

export interface ProrationInput {
  /** Days in the billed month. */
  daysInMonth: number;
  /** 1-based day of the month the student became billable. */
  billableFromDay: number;
  /** Count the joining day itself as billable (`fees.prorate_include_join_day`). */
  includeJoinDay: boolean;
}

/**
 * The fraction of a month a mid-month joiner owes. Returns 1 for anyone
 * present from the 1st, so the caller never branches.
 */
export function prorationFactor(input: ProrationInput): number {
  const { daysInMonth, billableFromDay, includeJoinDay } = input;
  if (daysInMonth <= 0) return 1;
  if (billableFromDay <= 1) return 1;
  if (billableFromDay > daysInMonth) return 0;

  const firstBilledDay = includeJoinDay ? billableFromDay : billableFromDay + 1;
  const billedDays = daysInMonth - firstBilledDay + 1;
  if (billedDays <= 0) return 0;
  return billedDays / daysInMonth;
}

/**
 * Concessions in force for one head, reduced to a single discount.
 *
 * Multiple overrides on the same head are additive within their kind and
 * ordered across kinds — a scholarship and a percentage discount both
 * apply, because a school that granted both meant both.
 */
export function discountFor(
  amount: number,
  concessions: Concession[],
): { discount: number; note: string | null } {
  const gross = money(amount);
  if (gross <= 0 || concessions.length === 0) {
    return { discount: 0, note: null };
  }

  // A waiver is absolute — it is not a competing percentage.
  const waiver = concessions.find((c) => c.type === FeeOverrideType.WAIVER);
  if (waiver) {
    return { discount: gross, note: `Waived — ${waiver.reason}` };
  }

  const percent = sumMoney(
    concessions
      .filter((c) => c.type === FeeOverrideType.DISCOUNT_PERCENT)
      .map((c) => c.value),
  );
  const flat = sumMoney(
    concessions
      .filter(
        (c) =>
          c.type === FeeOverrideType.DISCOUNT_FLAT ||
          c.type === FeeOverrideType.SCHOLARSHIP,
      )
      .map((c) => c.value),
  );

  // Percent first, then flat, capped at the line (roadmap §9).
  const afterPercent = percentOf(gross, Math.min(percent, 100));
  const discount = clampMoney(afterPercent + flat, gross);

  const parts: string[] = [];
  if (percent > 0) parts.push(`${percent}%`);
  if (flat > 0) parts.push(`flat ${flat}`);
  const labels = concessions.map((c) => c.reason).join('; ');

  return {
    discount,
    note: parts.length > 0 ? `${parts.join(' + ')} — ${labels}` : labels,
  };
}

/**
 * Build one invoice's lines. `proration` is applied only to heads marked
 * `prorated` — a one-off admission fee is not halved because the student
 * joined mid-month.
 */
export function buildInvoice(
  heads: BillableHead[],
  concessions: Concession[],
  proration = 1,
): BuiltInvoice {
  const byHead = new Map<string, Concession[]>();
  for (const concession of concessions) {
    byHead.set(concession.feeHeadId, [
      ...(byHead.get(concession.feeHeadId) ?? []),
      concession,
    ]);
  }

  const lines: InvoiceLine[] = [];
  for (const head of heads) {
    const factor = head.prorated ? proration : 1;
    const amount = money(head.amount * factor);
    // A fully prorated-away line is dropped rather than billed at zero —
    // a ৳0 row on a receipt reads as a mistake.
    if (amount <= 0) continue;

    const { discount, note } = discountFor(
      amount,
      byHead.get(head.feeHeadId) ?? [],
    );

    const prorationNote =
      factor < 1 ? `Prorated ${Math.round(factor * 100)}%` : null;

    lines.push({
      feeHeadId: head.feeHeadId,
      description: head.feeHeadName,
      amount,
      discount,
      note: [prorationNote, note].filter(Boolean).join(' · ') || null,
    });
  }

  const subtotal = sumMoney(lines.map((l) => l.amount));
  const discountTotal = sumMoney(lines.map((l) => l.discount));

  return {
    lines,
    subtotal,
    discountTotal,
    payable: money(subtotal - discountTotal),
  };
}
