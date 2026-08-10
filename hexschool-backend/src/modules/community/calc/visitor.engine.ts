import type { AppointmentStatusCode, VisitorPurposeCode } from './types';

/**
 * The gate's rules (roadmap M28 §6, §8), with nothing injected.
 *
 * The module's visitor third exists to answer one question at any moment:
 * **who is in the building right now.** Everything here serves that. A
 * visit is a row with an open `check_out`, the in-building list is that
 * predicate, and the day-end sweep exists because the answer must not
 * still say "forty people" at two in the morning because forty people
 * walked out without signing the book.
 *
 * The sweep writes a check-out time AND a flag saying a machine wrote it,
 * which is not fussiness: "left at 16:40" and "was still signed in when we
 * locked up" are different facts, and a register that cannot tell them
 * apart cannot be used to answer the question it would be pulled out for.
 */

export interface VisitView {
  id: string;
  checkIn: Date;
  checkOut: Date | null;
  /** Roadmap §8's multi-day pass. `null` is an ordinary same-day visit. */
  validUntil: Date | null;
  purpose: VisitorPurposeCode;
}

/** In the building: signed in, not signed out. No status column to disagree. */
export function isInside(visit: Pick<VisitView, 'checkOut'>): boolean {
  return visit.checkOut === null;
}

export function visitDurationMinutes(
  visit: Pick<VisitView, 'checkIn' | 'checkOut'>,
  now: Date,
): number {
  const end = visit.checkOut ?? now;
  return Math.max(
    0,
    Math.round((end.getTime() - visit.checkIn.getTime()) / 60_000),
  );
}

/**
 * Roadmap §8: an external invigilator sitting three days of exams gets one
 * pass, not three queues at the gate. Only OFFICIAL earns one — a parent
 * visiting for a meeting has no reason to hold a pass into the building
 * for a week, and the whole value of a gate register is that the passes in
 * circulation are the visits happening today.
 */
export function allowsMultiDayPass(purpose: VisitorPurposeCode): boolean {
  return purpose === 'OFFICIAL';
}

export interface PassValidity {
  valid: boolean;
  reason?: string;
  /** The last date the pass admits its holder. */
  validUntil: Date;
}

/**
 * Is this pass good on `date`? A same-day pass is good on the day it was
 * issued and no later.
 *
 * Dates are compared as **calendar days**, not as instants: a pass issued
 * at 09:00 and valid "until today" must still work at 16:00, and an
 * instant comparison would expire it at 09:00:01 the same morning.
 */
export function passValidOn(visit: VisitView, date: Date): PassValidity {
  const validUntil = visit.validUntil ?? visit.checkIn;
  const last = startOfDay(validUntil);
  const asked = startOfDay(date);

  if (asked.getTime() < startOfDay(visit.checkIn).getTime()) {
    return {
      valid: false,
      reason: 'The pass was issued after this date',
      validUntil: last,
    };
  }
  if (asked.getTime() > last.getTime()) {
    return {
      valid: false,
      reason: `The pass expired on ${last.toISOString().slice(0, 10)}`,
      validUntil: last,
    };
  }
  return { valid: true, validUntil: last };
}

/** Roadmap §7-shaped: a multi-day pass may not run past the school's cap. */
export function passLengthRefusal(
  purpose: VisitorPurposeCode,
  checkIn: Date,
  validUntil: Date | null,
  maxPassDays: number,
): string | null {
  if (!validUntil) return null;

  if (!allowsMultiDayPass(purpose)) {
    return 'Only an OFFICIAL visit may hold a multi-day pass. A meeting, a guardian visit or a vendor call is recorded per visit.';
  }

  const days = dayDiff(startOfDay(checkIn), startOfDay(validUntil)) + 1;
  if (days > maxPassDays) {
    return `A pass may run for at most ${maxPassDays} day(s); this one asks for ${days}.`;
  }
  return null;
}

export interface AutoCheckoutCandidate {
  id: string;
  checkIn: Date;
  validUntil: Date | null;
  purpose: VisitorPurposeCode;
}

/**
 * Roadmap §4's day-end sweep: "auto-checkout job at day end (flag)".
 *
 * A **multi-day pass is deliberately exempt until its last day**. The
 * invigilator sitting three days of exams has not failed to sign out at
 * the end of day one; they are legitimately still admitted tomorrow, and
 * checking them out nightly would produce three visits where there was one
 * engagement and would make the pass pointless.
 */
export function visitsToAutoCheckout(
  visits: readonly AutoCheckoutCandidate[],
  now: Date,
): AutoCheckoutCandidate[] {
  const today = startOfDay(now);
  return visits.filter((visit) => {
    const lastDay = startOfDay(visit.validUntil ?? visit.checkIn);
    return lastDay.getTime() <= today.getTime();
  });
}

/**
 * Whether the gate must print a pass for this visit.
 *
 * A school that requires passes requires them for everybody — including
 * the vendor the office knows by name, who is exactly the person a
 * "trusted visitor" exemption would be invented for and exactly the person
 * an inspection would ask about.
 */
export function gatePassRequired(required: boolean): boolean {
  return required;
}

/** Which appointment states may still turn into somebody at the gate. */
export function appointmentAdmits(status: AppointmentStatusCode): boolean {
  return status === 'APPROVED';
}

/**
 * The legal appointment moves. COMPLETED is reached by the visitor turning
 * up (a check-in against the appointment); NO_SHOW is the office recording
 * that they did not — kept separate from REJECTED because a school that
 * refused a meeting and a visitor who never came are different facts, and
 * one register that cannot tell them apart is one nobody trusts.
 */
const APPOINTMENT_TRANSITIONS: Readonly<
  Record<AppointmentStatusCode, AppointmentStatusCode[]>
> = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['COMPLETED', 'NO_SHOW', 'REJECTED'],
  REJECTED: [],
  COMPLETED: [],
  NO_SHOW: [],
};

export function canMoveAppointment(
  from: AppointmentStatusCode,
  to: AppointmentStatusCode,
): { allowed: boolean; reason?: string } {
  if (from === to) {
    return { allowed: false, reason: `The appointment is already ${to}` };
  }
  if (!APPOINTMENT_TRANSITIONS[from].includes(to)) {
    return {
      allowed: false,
      reason: `A ${from} appointment cannot become ${to}`,
    };
  }
  return { allowed: true };
}

export interface VisitorDayStats {
  total: number;
  inside: number;
  departed: number;
  autoCheckedOut: number;
  avgStayMinutes: number;
  byPurpose: Array<{ purpose: VisitorPurposeCode; count: number }>;
}

/** Roadmap §4's daily register summary. */
export function dayStats(
  visits: ReadonlyArray<VisitView & { autoCheckedOut: boolean }>,
  now: Date,
): VisitorDayStats {
  const departed = visits.filter((v) => v.checkOut !== null);
  const purposes = new Map<VisitorPurposeCode, number>();
  for (const visit of visits) {
    purposes.set(visit.purpose, (purposes.get(visit.purpose) ?? 0) + 1);
  }

  // Only completed visits contribute to the average stay. A visitor who is
  // still inside has not stayed a length yet, and counting "so far" would
  // make the number drift downward all morning and upward all afternoon.
  const totalStay = departed.reduce(
    (sum, visit) => sum + visitDurationMinutes(visit, now),
    0,
  );

  return {
    total: visits.length,
    inside: visits.filter((v) => v.checkOut === null).length,
    departed: departed.length,
    autoCheckedOut: visits.filter((v) => v.autoCheckedOut).length,
    avgStayMinutes:
      departed.length === 0 ? 0 : Math.round(totalStay / departed.length),
    byPurpose: [...purposes.entries()]
      .map(([purpose, count]) => ({ purpose, count }))
      .sort((a, b) => b.count - a.count || a.purpose.localeCompare(b.purpose)),
  };
}

function startOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function dayDiff(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}
