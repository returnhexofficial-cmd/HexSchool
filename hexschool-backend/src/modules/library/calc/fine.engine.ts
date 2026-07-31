import { money } from '../../fee/calc/money.util';

/**
 * What a late, lost or damaged book costs — the whole of Module 23's
 * arithmetic, dependency-free and golden-tested (roadmap §9's first unit
 * requirement, "fine calculator (holiday-aware)").
 *
 * The engine is pure in the way M12's percentage util and M21's leave
 * engine are: **the calendar is passed in, never fetched**. A caller
 * hands it the set of dates the school was closed and it counts days;
 * nothing here knows that `CalendarService` exists. That is what makes
 * "was Friday a holiday last March?" a fixture rather than a database.
 */

/** Whole days, floor, from `from` to `to`. Negative clamps to zero. */
const DAY_MS = 86_400_000;

export interface FinePolicy {
  /** BDT charged per chargeable overdue day. */
  perDay: number;
  /** Days after the due date that are free — a bus strike, a long weekend. */
  graceDays: number;
  /** Ceiling per loan. 0 means uncapped. */
  maxPerBook: number;
  /**
   * Skip days the school was closed. Roadmap §4 calls this an "option"
   * and it is: a school that opens its library on Fridays wants every
   * day counted, and a school that does not would otherwise fine a
   * member for a day they could not physically have returned the book.
   */
  holidayAware: boolean;
  /** Multiplier on the replacement price when a copy is written off. */
  lostMultiplier: number;
  /** Multiplier when a copy comes back damaged but usable. */
  damagedMultiplier: number;
  /** Replacement value used when the title carries no price. */
  defaultBookPrice: number;
}

export interface OverdueInput {
  dueAt: Date;
  /** When it actually came back, or "now" for a loan still out. */
  returnedAt: Date;
  policy: FinePolicy;
  /**
   * `YYYY-MM-DD` dates the school was closed, as
   * `CalendarService.workingDays` complements them. Only consulted when
   * `policy.holidayAware` is on.
   */
  holidays?: ReadonlySet<string>;
}

export interface OverdueVerdict {
  /** Calendar days past the due date, before grace and holidays. */
  daysLate: number;
  /** Days actually charged for. */
  chargeableDays: number;
  /** Days dropped because the school was closed. */
  holidayDays: number;
  /** `chargeableDays × perDay`, capped. */
  amount: number;
  /** True when the cap bit — the desk shows "capped at 500". */
  capped: boolean;
}

/** `2026-07-30T18:30:00+06:00` → `2026-07-30` in Asia/Dhaka. */
export function dhakaDateKey(at: Date): string {
  // `en-CA` formats as YYYY-MM-DD, which is the key shape every other
  // module's holiday set uses (M05 `isoDate`).
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * The overdue charge.
 *
 * Lateness is counted in **whole elapsed days**, not in calendar-date
 * differences: a book due at 14:00 Monday and returned at 09:00 Tuesday
 * is 0 days late, because the member had it for less than a full extra
 * day. Counting calendar dates would charge them for a morning. This is
 * the same reasoning M22 applies to `is_late` — the deadline is an
 * instant, so the arithmetic has to be too.
 *
 * Grace comes off the *lateness*, holidays come off the *chargeable*
 * days, and the cap is applied last. That order matters: taking the cap
 * first would make grace invisible on a long overdue, and taking
 * holidays before grace would spend a school's grace days on days it was
 * never going to charge for anyway.
 */
export function assessOverdue(input: OverdueInput): OverdueVerdict {
  const { dueAt, returnedAt, policy } = input;
  const elapsed = returnedAt.getTime() - dueAt.getTime();
  const daysLate = elapsed <= 0 ? 0 : Math.floor(elapsed / DAY_MS);

  if (daysLate <= 0 || policy.perDay <= 0) {
    return {
      daysLate: Math.max(0, daysLate),
      chargeableDays: 0,
      holidayDays: 0,
      amount: 0,
      capped: false,
    };
  }

  const afterGrace = Math.max(0, daysLate - Math.max(0, policy.graceDays));

  // Which calendar dates the charged days actually fall on. The book was
  // due on day 0, so the first day the member is in default is day 1 —
  // "you should have brought it back on the 5th, and on the 6th you had
  // not" — and grace shifts that window forward wholesale. Starting the
  // loop at day 0 instead would forgive the holiday *before* the
  // deadline and charge for the one after it, which is off by one in the
  // direction nobody notices until a member disputes a bill.
  let holidayDays = 0;
  if (policy.holidayAware && input.holidays && input.holidays.size > 0) {
    const graceEnd = dueAt.getTime() + Math.max(0, policy.graceDays) * DAY_MS;
    for (let day = 1; day <= afterGrace; day++) {
      const at = new Date(graceEnd + day * DAY_MS);
      if (input.holidays.has(dhakaDateKey(at))) holidayDays++;
    }
  }

  const chargeableDays = Math.max(0, afterGrace - holidayDays);
  const raw = money(chargeableDays * policy.perDay);
  const cap = policy.maxPerBook > 0 ? money(policy.maxPerBook) : Infinity;
  const amount = Math.min(raw, cap);

  return {
    daysLate,
    chargeableDays,
    holidayDays,
    amount: money(amount),
    capped: raw > cap,
  };
}

/**
 * What a written-off copy costs its borrower.
 *
 * A title with no recorded price falls back to
 * `library.default_book_price` rather than to zero. Charging nothing for
 * a book nobody priced is how a catalogue's unpriced half becomes the
 * half that goes missing — and the librarian who did not enter a price
 * is not the person the rule should punish.
 */
export function replacementCharge(
  bookPrice: number | null | undefined,
  policy: FinePolicy,
  kind: 'LOST' | 'DAMAGED',
): number {
  const base =
    bookPrice !== null && bookPrice !== undefined && bookPrice > 0
      ? money(bookPrice)
      : money(policy.defaultBookPrice);
  const multiplier =
    kind === 'LOST' ? policy.lostMultiplier : policy.damagedMultiplier;
  return money(base * Math.max(0, multiplier));
}

/**
 * A loan can be both late AND lost — a member who keeps a book for three
 * months and then reports it missing owes for the delay as well as for
 * the book. The two are summed, and the **reason recorded is the more
 * serious one**, because that is what a school's income report wants to
 * group by and what a member's history should say happened.
 */
export function totalCharge(
  overdue: number,
  replacement: number,
): { amount: number; reason: 'NONE' | 'OVERDUE' | 'LOST' | 'DAMAGED' } {
  const amount = money(Math.max(0, overdue) + Math.max(0, replacement));
  if (amount <= 0) return { amount: 0, reason: 'NONE' };
  return {
    amount,
    reason: replacement > 0 ? 'LOST' : 'OVERDUE',
  };
}

/** What is still owed on a loan: assessed, less collected and waived. */
export function outstandingFine(issue: {
  fineAmount: number;
  fineCollected: number;
  fineWaived: number;
}): number {
  return money(
    Math.max(0, issue.fineAmount - issue.fineCollected - issue.fineWaived),
  );
}

/**
 * The `fine_paid` flag, computed the same way the database CHECK
 * computes it. Exported so no write path has to inline the comparison —
 * if this and `chk_book_issues_fine_paid` ever disagree, the write is
 * refused rather than silently stored, which is the point of having
 * both (the M16 `deriveStatus` rule).
 */
export function isFineSettled(issue: {
  fineAmount: number;
  fineCollected: number;
  fineWaived: number;
}): boolean {
  return issue.fineCollected + issue.fineWaived >= issue.fineAmount;
}
