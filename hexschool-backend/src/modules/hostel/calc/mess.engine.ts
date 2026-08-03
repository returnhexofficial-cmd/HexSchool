/**
 * The mess: what the kitchen charges, and what it gives back when a
 * boarder goes home.
 *
 * Dependency-free and golden-tested; it reuses M16's `money.util` and
 * this module's `residency.engine`.
 *
 * **The day rate is the load-bearing decision.** Roadmap §3 says the
 * charge adjustment happens "per day-rate setting", and there are two
 * honest answers to what a day of food costs:
 *
 *   * the plan's monthly charge divided by the days in **that** month —
 *     which makes a full month of meal-offs credit exactly one month's
 *     charge, and never more;
 *   * a flat figure the school sets, because a school that buys rice by
 *     the sack knows what a day costs and it is not `charge / 31`.
 *
 * `hostel.mess_day_rate` picks: zero (the default) means derive, anything
 * above zero is the flat rate. The derived form is the safe default
 * precisely because it cannot over-credit; a flat rate can, which is why
 * the credit is **capped at the month's mess charge**. Handing a family
 * more back than they were ever billed is not a discount, it is a hole.
 */

import { money } from '../../fee/calc/money.util';
import {
  intersect,
  monthlyRent,
  residentDaysInMonth,
  type ResidencyWindow,
} from './residency.engine';
import {
  daysInMonth,
  inclusiveDays,
  type IsoDate,
  type IsoMonth,
  type MealOffState,
} from './types';

export interface MealOffRange {
  fromDate: IsoDate;
  toDate: IsoDate;
  status: MealOffState;
}

export interface MealOffVerdict {
  ok: boolean;
  days: number;
  reason: string | null;
}

/** Whole days a boarder is away, both ends inclusive. */
export function mealOffDays(from: IsoDate, to: IsoDate): number {
  return inclusiveDays(from, to);
}

/**
 * Roadmap §6's "meal-off min duration setting (e.g., ≥ 3 days)", plus the
 * two shape rules a range has to satisfy before anybody can approve it.
 *
 * The minimum exists because the kitchen buys for the week: telling the
 * cook on Tuesday that one boy is out on Wednesday saves nothing, and a
 * school that credited it would be paying for the privilege of being
 * told. A school that disagrees sets the minimum to 1.
 */
export function checkMealOff(input: {
  fromDate: IsoDate;
  toDate: IsoDate;
  minDays: number;
  /** The residency window; a boarder cannot skip meals they were not here for. */
  residency: ResidencyWindow;
}): MealOffVerdict {
  const days = mealOffDays(input.fromDate, input.toDate);
  if (days <= 0) {
    return { ok: false, days: 0, reason: 'The last day is before the first.' };
  }
  const minimum = Math.max(1, Math.trunc(input.minDays));
  if (days < minimum) {
    return {
      ok: false,
      days,
      reason: `A meal-off has to cover at least ${minimum} day(s); this one covers ${days}. The kitchen buys ahead.`,
    };
  }

  // The range must sit inside the residency. A meal-off after somebody
  // vacated is a credit against a bill that will never be raised.
  const covered = intersect(input.residency, {
    from: input.fromDate,
    to: nextDay(input.toDate),
  });
  if (covered === null) {
    return {
      ok: false,
      days,
      reason:
        'Those dates fall outside the time this student is living in the hostel.',
    };
  }
  return { ok: true, days, reason: null };
}

/**
 * Do two ranges share a day? Used to refuse a second meal-off over dates
 * already claimed by a live one — otherwise a boarder who asked twice for
 * the same week is credited for it twice, and the second request looks
 * exactly like a legitimate one.
 *
 * Deliberately does **not** de-duplicate by id: comparing ids to skip
 * "the same row" is the M14 bug that dropped half of all clashes because
 * UUIDs sort arbitrarily. Callers exclude the row they are editing before
 * they get here.
 */
export function rangesOverlap(
  a: { fromDate: IsoDate; toDate: IsoDate },
  b: { fromDate: IsoDate; toDate: IsoDate },
): boolean {
  return a.fromDate <= b.toDate && b.fromDate <= a.toDate;
}

/** The statuses that still hold a claim on their dates. */
export function isLiveMealOff(status: MealOffState): boolean {
  return status === 'PENDING' || status === 'APPROVED';
}

// ── the money ────────────────────────────────────────────────────────

export interface MessChargeInput {
  /** The plan's `monthly_charge`. */
  monthlyCharge: number;
  month: IsoMonth;
  /** Residency ∩ mess enrolment — roadmap §8's precedence, already applied. */
  window: ResidencyWindow;
  prorate: boolean;
}

export interface MessCharge {
  amount: number;
  messDays: number;
  daysInMonth: number;
  prorated: boolean;
}

/** What a boarder owes the kitchen for one month, before any credit. */
export function messCharge(input: MessChargeInput): MessCharge {
  const rent = monthlyRent({
    monthlyFee: input.monthlyCharge,
    month: input.month,
    window: input.window,
    prorate: input.prorate,
  });
  return {
    amount: rent.amount,
    messDays: rent.residentDays,
    daysInMonth: rent.daysInMonth,
    prorated: rent.prorated,
  };
}

/**
 * What one day of a plan costs. `flatRate` above zero wins; otherwise the
 * monthly charge is spread over the days of the month the meal-off falls
 * in, so a February day is worth slightly more than a March one — which
 * is correct, because February's charge bought fewer days of food.
 */
export function dayRate(
  monthlyCharge: number,
  month: IsoMonth,
  flatRate: number,
): number {
  if (flatRate > 0) return money(flatRate);
  const total = daysInMonth(month);
  if (total === 0) return 0;
  return money(Math.max(0, monthlyCharge) / total);
}

export interface MealOffCreditInput {
  /** Approved meal-offs whose `credit_month` is the month being billed. */
  entries: ReadonlyArray<{
    fromDate: IsoDate;
    toDate: IsoDate;
    /** The plan in force over those dates, and its charge. */
    monthlyCharge: number;
  }>;
  /** `hostel.mess_day_rate`; 0 derives from the plan. */
  flatRate: number;
  /** Residency window — days outside it were never billed for. */
  residency: ResidencyWindow;
  /** Ceiling: never credit more than the mess charge on this same bill. */
  cap: number;
}

export interface MealOffCredit {
  amount: number;
  days: number;
  /** True when the cap bit — the office should look at why. */
  capped: boolean;
}

/**
 * The credit line. Every day is priced in **its own month** (a meal-off
 * spanning the turn of the month is two different day rates), counted
 * only where it overlaps the residency, and the total is capped.
 */
export function mealOffCredit(input: MealOffCreditInput): MealOffCredit {
  let amount = 0;
  let days = 0;

  for (const entry of input.entries) {
    const covered = intersect(input.residency, {
      from: entry.fromDate,
      to: nextDay(entry.toDate),
    });
    if (covered === null) continue;

    // Walk month by month so each day is priced against the month it
    // actually falls in.
    for (const month of monthsBetween(entry.fromDate, entry.toDate)) {
      const inMonth = residentDaysInMonth(covered, month);
      if (inMonth === 0) continue;
      days += inMonth;
      amount += inMonth * dayRate(entry.monthlyCharge, month, input.flatRate);
    }
  }

  const cap = money(Math.max(0, input.cap));
  const raw = money(amount);
  return raw > cap
    ? { amount: cap, days, capped: true }
    : { amount: raw, days, capped: false };
}

/** The line the parent reads. */
export function creditDescription(credit: MealOffCredit): string {
  return `Mess credit — ${credit.days} day(s) away${credit.capped ? ' (capped at the month’s mess charge)' : ''}`;
}

// ── small date helpers, local because they are only meaningful here ──

/** `YYYY-MM-DD` + 1 day — turns an inclusive end into an exclusive one. */
export function nextDay(date: IsoDate): IsoDate {
  const at = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
  return new Date(at + 86_400_000).toISOString().slice(0, 10);
}

/** Every `YYYY-MM` a range touches, in order. */
export function monthsBetween(from: IsoDate, to: IsoDate): IsoMonth[] {
  if (from > to) return [];
  const months: IsoMonth[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const lastYear = Number(to.slice(0, 4));
  const lastMonth = Number(to.slice(5, 7));

  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}
