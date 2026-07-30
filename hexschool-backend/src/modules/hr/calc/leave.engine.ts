/**
 * Leave arithmetic — dependency-free and golden-tested (PROJECT_CONTEXT
 * §4). Nothing here touches Prisma, the calendar service or settings: the
 * caller resolves the working days and the balance row, and this module
 * decides how many days a request costs and whether the employee has
 * them.
 *
 * The unit is **days, to one decimal**. A half-day is 0.5 and nothing
 * finer, which is why every figure rounds to 0.5 rather than to paisa:
 * `leave_balances` and `leave_applications` store `DECIMAL(_, 1)`, and a
 * 0.33-day leave is not a thing a school grants.
 */

/** Round to the nearest half day — the finest unit a leave register has. */
export function halfDays(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 2) / 2;
}

// ── how many days a request costs ─────────────────────────────────────

export interface LeaveDayInput {
  /** Working days inside [from, to], as YYYY-MM-DD (M05 `workingDays`). */
  workingDays: readonly string[];
  halfDay: boolean;
}

/**
 * The number of days a request consumes.
 *
 * Counting **working days** rather than calendar days is the whole point
 * of asking the calendar: a leave that spans a weekend must not burn two
 * days of quota for days nobody was expected to work. A half-day request
 * is exactly 0.5 and is only meaningful on a single date — the DB CHECK
 * `chk_leave_applications_range` refuses the other shape, so this
 * function may assume it.
 */
export function leaveDays(input: LeaveDayInput): number {
  if (input.halfDay) return input.workingDays.length > 0 ? 0.5 : 0;
  return halfDays(input.workingDays.length);
}

// ── balances ──────────────────────────────────────────────────────────

export interface BalanceFacts {
  allocated: number;
  used: number;
  carried: number;
}

/** What is left to take: `allocated + carried − used`, never below zero. */
export function availableDays(balance: BalanceFacts): number {
  return Math.max(
    0,
    halfDays(balance.allocated + balance.carried - balance.used),
  );
}

/**
 * The raw remainder, which CAN be negative.
 *
 * `availableDays` floors at zero because that is what an employee is
 * shown, but the approval check needs to see an overdraft: a school that
 * approved 12 days against a 10-day quota with an override is 2 days
 * over, and hiding that would let the next request through as if the
 * balance were merely empty.
 */
export function remainingDays(balance: BalanceFacts): number {
  return halfDays(balance.allocated + balance.carried - balance.used);
}

export interface QuotaVerdict {
  /** `true` when approving would take the balance below zero. */
  exceeded: boolean;
  requested: number;
  remaining: number;
  /** How far past the quota this request goes (0 when it fits). */
  shortfall: number;
}

/**
 * Would approving `requested` days overdraw the balance?
 *
 * An UNPAID leave type carries a zero quota by design — the days are
 * deducted from pay, not from an entitlement — so it is never "exceeded".
 * Treating it as an overdraft would make every unpaid leave need the
 * override permission, which inverts what the two things mean.
 */
export function quotaVerdict(
  requested: number,
  balance: BalanceFacts,
  options: { unlimited?: boolean } = {},
): QuotaVerdict {
  const remaining = remainingDays(balance);
  if (options.unlimited) {
    return { exceeded: false, requested, remaining, shortfall: 0 };
  }
  const shortfall = halfDays(requested - remaining);
  return {
    exceeded: shortfall > 0,
    requested,
    remaining,
    shortfall: Math.max(0, shortfall),
  };
}

// ── overlap ───────────────────────────────────────────────────────────

export interface LeaveRange {
  id: string;
  from: string;
  to: string;
}

/**
 * Every existing range the candidate touches.
 *
 * Dates are compared as YYYY-MM-DD strings, which sort lexicographically
 * in calendar order — the M05 convention that keeps date logic free of
 * timezone arithmetic.
 *
 * Note what this deliberately does NOT do: de-duplicate by comparing
 * ids. M14's clash engine did exactly that and silently dropped about
 * half of all real clashes, because with UUIDs the comparison is a coin
 * flip. Each existing row is visited once, so there is nothing to
 * de-duplicate.
 */
export function overlappingRanges(
  candidate: { from: string; to: string },
  existing: readonly LeaveRange[],
  excludeId?: string,
): LeaveRange[] {
  return existing.filter(
    (row) =>
      row.id !== excludeId &&
      row.from <= candidate.to &&
      row.to >= candidate.from,
  );
}

// ── yearly allocation ─────────────────────────────────────────────────

export interface AllocationInput {
  annualQuota: number;
  /** Session bounds, YYYY-MM-DD. */
  sessionStart: string;
  sessionEnd: string;
  /** When the employee joined; earlier than the session start means full. */
  joiningDate: string | null;
  /** Prorate the quota for somebody who joins mid-session. */
  prorate: boolean;
}

/**
 * A person's allocation for one session.
 *
 * Proration is by **elapsed months of the session**, not by days: a
 * school grants "ten casual days a year", and telling a teacher who
 * joined in July that they have 4.7 days is arithmetic nobody asked for.
 * Months are rounded up, because somebody who joins on the 28th has still
 * joined that month.
 */
export function allocationFor(input: AllocationInput): number {
  const quota = Math.max(0, input.annualQuota);
  if (quota === 0) return 0;
  if (!input.prorate || !input.joiningDate) return halfDays(quota);
  if (input.joiningDate <= input.sessionStart) return halfDays(quota);
  if (input.joiningDate > input.sessionEnd) return 0;

  const total = monthSpan(input.sessionStart, input.sessionEnd);
  const remaining = monthSpan(input.joiningDate, input.sessionEnd);
  if (total <= 0) return 0;
  return halfDays((quota * Math.min(remaining, total)) / total);
}

/**
 * What carries into the next session.
 *
 * Only an unused balance carries, only where the type allows it, and
 * never past `maxCarry` — a carry-forward cap is the whole reason a
 * school offers earned leave without accumulating a decade of it.
 */
export function carryForwardDays(
  balance: BalanceFacts,
  type: { carryForward: boolean; maxCarry: number },
): number {
  if (!type.carryForward) return 0;
  const unused = availableDays(balance);
  return halfDays(Math.min(unused, Math.max(0, type.maxCarry)));
}

/** Inclusive count of calendar months two YYYY-MM-DD dates span. */
export function monthSpan(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return 0;
  return Math.max(0, (ty - fy) * 12 + (tm - fm) + 1);
}

// ── unpaid-day counting for payroll ───────────────────────────────────

export interface ApprovedLeaveSpan {
  from: string;
  to: string;
  isPaid: boolean;
  halfDay: boolean;
}

export interface LeaveDaySplit {
  paid: number;
  unpaid: number;
}

/**
 * Split an employee's approved leave inside a month into paid and unpaid
 * days, counting only the month's working days.
 *
 * Overlapping approvals are collapsed by DATE rather than summed: two
 * approvals covering the same Tuesday are one day off, and adding them
 * would deduct a teacher's pay twice for one absence. Where a date is
 * covered by both a paid and an unpaid approval, **paid wins** — the
 * employee has an entitlement covering that day, and the school should
 * not charge for it because a second row also exists.
 */
export function splitLeaveDays(
  spans: readonly ApprovedLeaveSpan[],
  monthWorkingDays: readonly string[],
): LeaveDaySplit {
  const paidDates = new Map<string, number>();
  const unpaidDates = new Map<string, number>();

  for (const span of spans) {
    const weight = span.halfDay ? 0.5 : 1;
    const target = span.isPaid ? paidDates : unpaidDates;
    for (const day of monthWorkingDays) {
      if (day < span.from || day > span.to) continue;
      target.set(day, Math.max(target.get(day) ?? 0, weight));
    }
  }

  let paid = 0;
  let unpaid = 0;
  for (const [day, weight] of paidDates) {
    paid += weight;
    unpaidDates.delete(day);
  }
  for (const weight of unpaidDates.values()) unpaid += weight;

  return { paid: halfDays(paid), unpaid: halfDays(unpaid) };
}
