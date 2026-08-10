import { isLive, priorityRank } from './ticket.engine';
import type { TicketPriorityCode, TicketStatusCode } from './types';

/**
 * Roadmap M28 §4's "SLA reminder job (OPEN > 72 h → escalation
 * notification)" and §4's "reports … avg resolution time".
 *
 * The roadmap names one number, 72 hours, for every complaint. That is
 * the wrong shape for a school: a broken toilet and an allegation about a
 * teacher do not deserve the same clock, and a single threshold means
 * either the urgent one waits three days or every suggestion escalates to
 * the head overnight. So the SLA is **a map from priority to hours**, and
 * the registry default puts MEDIUM at exactly the 72 the roadmap asks for
 * — a school that never touches the setting gets the specified behaviour.
 *
 * Everything here is pure: the sweep passes rows in and gets verdicts
 * back, which is what lets the "should this escalate" rule be tested
 * against a clock the test controls (the M25 lesson about mixing a
 * client-side clock with a server-side one).
 */

export const DEFAULT_SLA_HOURS: Readonly<Record<TicketPriorityCode, number>> = {
  LOW: 120,
  MEDIUM: 72,
  HIGH: 48,
  URGENT: 24,
};

export interface SlaTicketView {
  id: string;
  status: TicketStatusCode;
  priority: TicketPriorityCode;
  createdAt: Date;
  /** A reopen restarts the clock — see `clockStartedAt`. */
  reopenedAt: Date | null;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  escalatedAt: Date | null;
}

export interface SlaState {
  ticketId: string;
  /** Hours the ticket has been live against its current clock. */
  ageHours: number;
  slaHours: number;
  dueAt: Date;
  breached: boolean;
  /** Breached AND not yet chased — what the sweep acts on. */
  shouldEscalate: boolean;
  /** Negative once overdue; the inbox shows it as "2 h left" / "6 h over". */
  hoursRemaining: number;
}

/**
 * When the clock this ticket is judged against started.
 *
 * A REOPENED ticket restarts from `reopened_at`, not from `created_at`.
 * Measuring a dispute reopened this morning against a complaint filed in
 * March would report it three months overdue and escalate it instantly —
 * every reopen would page the head, and the sweep would be switched off
 * within a week.
 */
export function clockStartedAt(ticket: SlaTicketView): Date {
  return ticket.status === 'REOPENED' && ticket.reopenedAt
    ? ticket.reopenedAt
    : ticket.createdAt;
}

export function slaHoursFor(
  priority: TicketPriorityCode,
  configured: Partial<Record<TicketPriorityCode, number>>,
): number {
  const value = configured[priority];
  // `null`, `undefined`, `''` and 0 all mean "not configured" here — the
  // M24 `Number(null) === 0` lesson. A zero-hour SLA would mark every
  // ticket breached the instant it was raised.
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_SLA_HOURS[priority];
}

export function slaState(
  ticket: SlaTicketView,
  now: Date,
  configured: Partial<Record<TicketPriorityCode, number>> = {},
): SlaState {
  const slaHours = slaHoursFor(ticket.priority, configured);
  const start = clockStartedAt(ticket);
  const dueAt = new Date(start.getTime() + slaHours * 60 * 60 * 1000);
  const ageHours = (now.getTime() - start.getTime()) / (60 * 60 * 1000);
  const live = isLive(ticket.status);
  const breached = live && now.getTime() > dueAt.getTime();

  return {
    ticketId: ticket.id,
    ageHours: round2(ageHours),
    slaHours,
    dueAt,
    breached,
    // `escalated_at` is the dedupe, the M12 `absent_notified_at`
    // column-as-dedupe pattern: the sweep runs hourly and the head must be
    // told once, not once an hour until somebody acts.
    shouldEscalate: breached && ticket.escalatedAt === null,
    hoursRemaining: round2(
      (dueAt.getTime() - now.getTime()) / (60 * 60 * 1000),
    ),
  };
}

/** The sweep's whole job: which of these need chasing right now. */
export function ticketsToEscalate(
  tickets: readonly SlaTicketView[],
  now: Date,
  configured: Partial<Record<TicketPriorityCode, number>> = {},
): SlaState[] {
  return (
    tickets
      .map((ticket) => slaState(ticket, now, configured))
      .filter((state) => state.shouldEscalate)
      // Worst first, so a truncated notification names the URGENT ones.
      .sort((a, b) => {
        const byPriority =
          priorityRank(priorityOf(tickets, b.ticketId)) -
          priorityRank(priorityOf(tickets, a.ticketId));
        return byPriority !== 0 ? byPriority : b.ageHours - a.ageHours;
      })
  );
}

function priorityOf(
  tickets: readonly SlaTicketView[],
  id: string,
): TicketPriorityCode {
  return tickets.find((t) => t.id === id)?.priority ?? 'MEDIUM';
}

export interface ResolutionStats {
  resolved: number;
  /** Mean hours from the clock start to `resolved_at`. */
  avgResolutionHours: number;
  /** Mean hours to the first thing anybody said back. */
  avgFirstResponseHours: number;
  /** Of the resolved ones, how many landed inside their SLA. */
  withinSla: number;
  slaCompliancePercent: number;
}

/**
 * Roadmap §4's "avg resolution time", plus the two numbers a head actually
 * asks for next.
 *
 * **Only resolved tickets count towards the average.** Including the live
 * ones would let a school improve its average resolution time by leaving
 * complaints open, which is precisely backwards. The open backlog is a
 * separate number, and the report prints both.
 */
export function resolutionStats(
  tickets: readonly SlaTicketView[],
  configured: Partial<Record<TicketPriorityCode, number>> = {},
): ResolutionStats {
  const resolved = tickets.filter((t) => t.resolvedAt !== null);
  if (resolved.length === 0) {
    return {
      resolved: 0,
      avgResolutionHours: 0,
      avgFirstResponseHours: 0,
      withinSla: 0,
      slaCompliancePercent: 0,
    };
  }

  let totalResolution = 0;
  let totalFirstResponse = 0;
  let firstResponseCount = 0;
  let withinSla = 0;

  for (const ticket of resolved) {
    const start = clockStartedAt(ticket);
    const hours =
      (ticket.resolvedAt!.getTime() - start.getTime()) / (60 * 60 * 1000);
    // A resolution stamped before the clock started is a reopened ticket
    // whose data crossed over; clamp rather than report a negative average.
    totalResolution += Math.max(0, hours);

    if (ticket.firstResponseAt) {
      totalFirstResponse += Math.max(
        0,
        (ticket.firstResponseAt.getTime() - start.getTime()) / (60 * 60 * 1000),
      );
      firstResponseCount += 1;
    }

    if (Math.max(0, hours) <= slaHoursFor(ticket.priority, configured)) {
      withinSla += 1;
    }
  }

  return {
    resolved: resolved.length,
    avgResolutionHours: round2(totalResolution / resolved.length),
    avgFirstResponseHours:
      firstResponseCount === 0
        ? 0
        : round2(totalFirstResponse / firstResponseCount),
    withinSla,
    slaCompliancePercent: round2((withinSla / resolved.length) * 100),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
