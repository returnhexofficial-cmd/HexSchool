/**
 * How long a boarder lived here, expressed as a **window** — the piece of
 * arithmetic every other number in this module is built on.
 *
 * Dependency-free and golden-tested (PROJECT_CONTEXT §4); it reuses only
 * M16's `money.util`, exactly as M20/M21/M23/M25's engines do.
 *
 * **The whole design is M25's, applied to a bed.** An allocation is not a
 * flag that is on or off; it is `[resumed_at ?? start_date,
 * end_date ?? suspended_at ?? ∞)`, and suspending, resuming and vacating
 * each write a *date*. The reason is the one M21 paid a migration to
 * learn: a status change with no date cannot answer "how much of March
 * does this boarder owe", and the seat rent is a monthly charge that has
 * to be prorated against something.
 *
 * Dates are `YYYY-MM-DD` **strings**, the M05 rule: these are calendar
 * days, and a `Date` would drag a timezone into arithmetic that has none.
 */

import { money } from '../../fee/calc/money.util';
import {
  DATE_SHAPE,
  dayOf,
  daysInMonth,
  type IsoDate,
  type IsoMonth,
  type ResidencyStatus,
} from './types';

/** A half-open residency window `[from, to)`, either end possibly open. */
export interface ResidencyWindow {
  /** Inclusive `YYYY-MM-DD`. */
  from: IsoDate;
  /** Exclusive `YYYY-MM-DD`; `null` means the boarder is still here. */
  to: IsoDate | null;
}

/** The shape read off a `hostel_allocations` row. */
export interface AllocationDates {
  startDate: IsoDate;
  endDate: IsoDate | null;
  suspendedAt: IsoDate | null;
  resumedAt: IsoDate | null;
  status: ResidencyStatus;
}

export interface MonthlyRentInput {
  /** The room's `monthly_fee`. */
  monthlyFee: number;
  /** `YYYY-MM` being billed. */
  month: IsoMonth;
  window: ResidencyWindow;
  /** `hostel.prorate_enabled` — off means a full month or nothing. */
  prorate: boolean;
}

export interface MonthlyRent {
  amount: number;
  /** Days of the month the bed was actually held. */
  residentDays: number;
  daysInMonth: number;
  /** True when the charge is less than a full month's rent. */
  prorated: boolean;
}

/**
 * The window a boarder occupies their bed over, derived from the four
 * date columns.
 *
 * The consequence worth stating plainly, because it is the same
 * deliberate simplification M25 documented: **a suspend and a resume
 * inside the same month bills only from the resume date**, so the days
 * before the suspension in that month are not charged. One row cannot
 * describe two windows, and rounding in the boarder's favour is the side
 * a school would rather be wrong on. A second suspension in a different
 * month is exact.
 */
export function residencyWindow(allocation: AllocationDates): ResidencyWindow {
  const from =
    allocation.resumedAt && allocation.resumedAt > allocation.startDate
      ? allocation.resumedAt
      : allocation.startDate;

  // VACATED wins over a suspension: a boarder who was suspended and then
  // left, left on the day they left.
  const to = allocation.endDate ?? allocation.suspendedAt ?? null;

  // A suspension recorded before the resume that already lifted it is
  // history, not a boundary — otherwise a resumed boarder would bill zero
  // days for ever.
  if (
    to !== null &&
    allocation.endDate === null &&
    allocation.resumedAt !== null &&
    allocation.resumedAt >= to
  ) {
    return { from, to: null };
  }
  return { from, to };
}

/** True when the `YYYY-MM-DD` day falls inside the half-open window. */
export function occupiesDay(window: ResidencyWindow, day: IsoDate): boolean {
  if (!DATE_SHAPE.test(day)) return false;
  if (day < window.from) return false;
  if (window.to !== null && day >= window.to) return false;
  return true;
}

/**
 * How many days of `month` the window covers. Counted day by day rather
 * than by subtracting dates, because the ends are inclusive on one side
 * and exclusive on the other and a subtraction gets that wrong exactly
 * once per boundary — which is a whole day of somebody's money.
 */
export function residentDaysInMonth(
  window: ResidencyWindow,
  month: IsoMonth,
): number {
  const total = daysInMonth(month);
  if (total === 0) return 0;
  let days = 0;
  for (let day = 1; day <= total; day++) {
    if (occupiesDay(window, dayOf(month, day))) days++;
  }
  return days;
}

/**
 * The intersection of two windows — a mess enrolment inside a residency.
 * Roadmap §8 fixes the precedence: **the allocation window first, then
 * everything inside it.** A boarder cannot eat in a hostel they have left,
 * so a mess enrolment somebody forgot to close is bounded by the vacate
 * date rather than billing on for ever.
 */
export function intersect(
  outer: ResidencyWindow,
  inner: ResidencyWindow,
): ResidencyWindow | null {
  const from = inner.from > outer.from ? inner.from : outer.from;
  const to =
    outer.to === null
      ? inner.to
      : inner.to === null
        ? outer.to
        : inner.to < outer.to
          ? inner.to
          : outer.to;

  if (to !== null && to <= from) return null;
  return { from, to };
}

/**
 * What a boarder owes in seat rent for one month.
 *
 * With proration off, any residency at all in the month costs a full
 * month — which is what a school charging "per month started" means, and
 * is the setting's whole purpose.
 */
export function monthlyRent(input: MonthlyRentInput): MonthlyRent {
  const total = daysInMonth(input.month);
  const fee = money(Math.max(0, input.monthlyFee));
  const days = residentDaysInMonth(input.window, input.month);

  if (total === 0 || days === 0) {
    return { amount: 0, residentDays: 0, daysInMonth: total, prorated: false };
  }
  if (!input.prorate || days === total) {
    return {
      amount: fee,
      residentDays: days,
      daysInMonth: total,
      prorated: false,
    };
  }
  return {
    amount: money((fee * days) / total),
    residentDays: days,
    daysInMonth: total,
    prorated: true,
  };
}

/**
 * The description printed on the invoice line. It names the building, the
 * room and — when the charge is partial — how partial, because a parent
 * comparing two months has to be able to see why one is smaller without
 * ringing the office (the M25 line-description rule).
 */
export function rentDescription(
  hostelName: string,
  roomNo: string,
  rent: MonthlyRent,
): string {
  const base = `Hostel — ${hostelName} (Room ${roomNo})`;
  return rent.prorated
    ? `${base}, ${rent.residentDays}/${rent.daysInMonth} days`
    : base;
}
