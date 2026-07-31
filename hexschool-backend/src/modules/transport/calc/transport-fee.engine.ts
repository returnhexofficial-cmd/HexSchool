/**
 * The transport half of a monthly bill (roadmap M25 §4's "integration
 * contract with Module 16 … proration on mid-month start/end").
 *
 * Dependency-free and golden-tested (PROJECT_CONTEXT §4); it reuses only
 * M16's `money.util`, exactly as M20/M21/M23's engines do.
 *
 * **Everything here follows from one idea: a rider's assignment describes
 * a service WINDOW, and a month's charge is the part of that window
 * inside the month.** M16's own proration answers a different question —
 * how much of the month was the student *enrolled* — and the two must
 * never be multiplied together, because a child who joined the school on
 * the 10th and started taking the bus on the 10th owes 21/31 of the bus
 * fare, not (21/31)². That is why the line this engine produces is
 * handed to `buildInvoice` with `prorated: false`: it has already
 * prorated itself, against the dates that actually govern it.
 *
 * Dates are handled as **`YYYY-MM-DD` strings**, the M05 rule: these are
 * calendar days, and a `Date` would drag a timezone into arithmetic that
 * has none.
 */

import { money } from '../../fee/calc/money.util';

/** A half-open service window `[from, to)`, either end possibly open. */
export interface ServiceWindow {
  /** Inclusive `YYYY-MM-DD`. */
  from: string;
  /** Exclusive `YYYY-MM-DD`; `null` means the rider is still travelling. */
  to: string | null;
}

/** The shape `TransportFeeService` reads off a `transport_assignments` row. */
export interface AssignmentDates {
  startDate: string;
  endDate: string | null;
  suspendedAt: string | null;
  resumedAt: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'ENDED';
}

export interface MonthlyChargeInput {
  /** The stop's `monthly_fee`. */
  monthlyFee: number;
  /** `YYYY-MM` being billed. */
  month: string;
  window: ServiceWindow;
  /** `transport.prorate_enabled` — off means a full month or nothing. */
  prorate: boolean;
}

export interface MonthlyCharge {
  amount: number;
  /** Days of the month the rider was actually served. */
  servedDays: number;
  daysInMonth: number;
  /** True when the charge is less than a full month's fee. */
  prorated: boolean;
}

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** Days in the `YYYY-MM` month, or 0 when the string is not a month. */
export function daysInMonth(month: string): number {
  if (!/^\d{4}-\d{2}$/.test(month)) return 0;
  const year = Number(month.slice(0, 4));
  const monthNo = Number(month.slice(5, 7));
  if (monthNo < 1 || monthNo > 12) return 0;
  return new Date(Date.UTC(year, monthNo, 0)).getUTCDate();
}

/** `YYYY-MM-DD` for day `day` of `month`, unchecked (callers clamp). */
function dayOf(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, '0')}`;
}

/**
 * The window a rider is served over, derived from the four date columns.
 *
 * `from` is `resumed_at ?? start_date` and `to` is
 * `end_date ?? suspended_at ?? open`. The consequence worth stating
 * plainly, because it is a deliberate simplification: **a suspend and a
 * resume inside the same month bills only from the resume date**, so the
 * days before the suspension in that month are not charged. One row
 * cannot describe two windows, and rounding in the rider's favour is the
 * side a school would rather be wrong on. A second suspension in a
 * different month is exact.
 */
export function serviceWindow(assignment: AssignmentDates): ServiceWindow {
  const from =
    assignment.resumedAt && assignment.resumedAt > assignment.startDate
      ? assignment.resumedAt
      : assignment.startDate;

  // ENDED wins over a suspension: a rider who was suspended and then left
  // stopped travelling on the day they left.
  const to = assignment.endDate ?? assignment.suspendedAt ?? null;

  // A suspension recorded before the resume it was already lifted by is
  // history, not a boundary — otherwise a resumed rider would bill zero
  // days for ever.
  if (
    to !== null &&
    assignment.endDate === null &&
    assignment.resumedAt !== null &&
    assignment.resumedAt >= to
  ) {
    return { from, to: null };
  }
  return { from, to };
}

/** True when the `YYYY-MM-DD` day falls inside the half-open window. */
export function servesDay(window: ServiceWindow, day: string): boolean {
  if (!DATE_SHAPE.test(day)) return false;
  if (day < window.from) return false;
  if (window.to !== null && day >= window.to) return false;
  return true;
}

/**
 * How many days of `month` the window covers. Counted day by day rather
 * than by subtracting dates, because the window ends are inclusive on one
 * side and exclusive on the other and a subtraction gets that wrong
 * exactly once per boundary — which is a whole day of somebody's money.
 */
export function servedDaysInMonth(
  window: ServiceWindow,
  month: string,
): number {
  const total = daysInMonth(month);
  if (total === 0) return 0;
  let served = 0;
  for (let day = 1; day <= total; day++) {
    if (servesDay(window, dayOf(month, day))) served++;
  }
  return served;
}

/**
 * What a rider owes for one month.
 *
 * With proration off, any service at all in the month costs a full
 * month's fee — which is what a school that charges "per month started"
 * means, and is the setting's whole purpose.
 */
export function monthlyCharge(input: MonthlyChargeInput): MonthlyCharge {
  const total = daysInMonth(input.month);
  const fee = money(Math.max(0, input.monthlyFee));
  const served = servedDaysInMonth(input.window, input.month);

  if (total === 0 || served === 0) {
    return { amount: 0, servedDays: 0, daysInMonth: total, prorated: false };
  }
  if (!input.prorate || served === total) {
    return {
      amount: fee,
      servedDays: served,
      daysInMonth: total,
      prorated: false,
    };
  }
  return {
    amount: money((fee * served) / total),
    servedDays: served,
    daysInMonth: total,
    prorated: true,
  };
}

/**
 * The description printed on the invoice line. It names the route, the
 * stop and — when the charge is partial — how partial, because a parent
 * comparing two months has to be able to see why one is smaller without
 * ringing the office.
 */
export function chargeDescription(
  routeName: string,
  stopName: string,
  charge: MonthlyCharge,
): string {
  const base = `Transport — ${routeName} (${stopName})`;
  return charge.prorated
    ? `${base}, ${charge.servedDays}/${charge.daysInMonth} days`
    : base;
}

/**
 * What the fleet is expected to bring in over a month, for the
 * "collection vs assigned" report: every live rider at their stop's fee,
 * with no proration — the figure the office budgets against.
 */
export function expectedMonthlyRevenue(fees: number[]): number {
  return money(fees.reduce((sum, fee) => sum + money(Math.max(0, fee)), 0));
}
