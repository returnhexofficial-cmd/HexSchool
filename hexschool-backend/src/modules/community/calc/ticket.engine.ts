import type {
  TicketCategoryCode,
  TicketPriorityCode,
  TicketRaiserTypeCode,
  TicketStatusCode,
} from './types';

/**
 * The complaint workflow's rules, with nothing injected (roadmap M28 §6).
 *
 * Two of them carry the module's weight.
 *
 * **Anonymity is a property of the ticket, not of the UI.** `isAnonymous`
 * is consulted before every notification and before every read that would
 * reveal a requester, and it is the same predicate the DB CHECK enforces.
 * A school that offers an anonymous box and then texts the complainant a
 * status update has broken the promise in the most public way available.
 *
 * **The reopen window is measured from `closed_at`, not from "recently".**
 * Roadmap §6 allows a REOPEN within seven days of CLOSED, which means the
 * office's decision becomes final on a specific date that the parent can
 * be told. A window measured from the last update instead would let a
 * one-word internal note quietly extend a dispute forever.
 */

/** Who is asking to make the change, as far as this engine cares. */
export interface TicketActorContext {
  /** Holds `ticket.assign` — an administrator of the inbox. */
  isManager: boolean;
  /** Is the assignee of this exact ticket. */
  isAssignee: boolean;
}

export interface TicketStateView {
  status: TicketStatusCode;
  closedAt: Date | null;
  assignedTo: string | null;
}

export interface TransitionRefusal {
  allowed: false;
  /** `STRUCTURAL` no permission reaches; `POLICY` an override could. */
  kind: 'STRUCTURAL' | 'POLICY';
  reason: string;
}

export type TransitionVerdict = { allowed: true } | TransitionRefusal;

/**
 * The legal moves. Read it as "from → the set you may go to".
 *
 * There is no edge back to OPEN from anywhere: a ticket that was worked on
 * and then disputed is REOPENED, and collapsing the two would make "how
 * many complaints did we settle first time" unanswerable — the one number
 * roadmap §4's report exists to produce.
 */
const TRANSITIONS: Readonly<Record<TicketStatusCode, TicketStatusCode[]>> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'CLOSED', 'OPEN'],
  // Closing a resolved ticket is the ordinary path; reopening one that was
  // never closed is free, because nothing has been declared final yet.
  RESOLVED: ['CLOSED', 'REOPENED', 'IN_PROGRESS'],
  // The only way out of CLOSED, and it is time-bounded — see `reopenWindow`.
  CLOSED: ['REOPENED'],
  REOPENED: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
};

export function allowedTransitions(from: TicketStatusCode): TicketStatusCode[] {
  return [...TRANSITIONS[from]];
}

export interface ReopenWindow {
  open: boolean;
  /** When the window shuts. `null` when the ticket was never closed. */
  closesAt: Date | null;
  daysLeft: number;
}

/**
 * Roadmap §6's "REOPENED allowed within 7 days of CLOSED".
 *
 * A ticket that is not CLOSED has no window to speak of — it is still
 * live, and `open: true` there means "nothing is stopping you", not "the
 * clock is running".
 */
export function reopenWindow(
  state: TicketStateView,
  now: Date,
  windowDays: number,
): ReopenWindow {
  if (state.status !== 'CLOSED' || !state.closedAt) {
    return { open: true, closesAt: null, daysLeft: windowDays };
  }
  const closesAt = new Date(
    state.closedAt.getTime() + windowDays * 24 * 60 * 60 * 1000,
  );
  const msLeft = closesAt.getTime() - now.getTime();
  return {
    open: msLeft > 0,
    closesAt,
    // Ceiling, so "0 days left" genuinely means the window has shut rather
    // than "some hours remain" — the number is shown to a parent.
    daysLeft: Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000))),
  };
}

/**
 * May this actor move this ticket to `to`?
 *
 * Roadmap §6: "only assignee/admin change ticket status". Both halves
 * matter — an assignee who cannot close their own work has to chase an
 * administrator for every ticket, and a school where anyone with
 * `ticket.view` can mark a complaint resolved has no complaints process at
 * all. The permission code is checked at the controller; this decides the
 * *relationship*, which a permission cannot express.
 */
export function canTransition(
  state: TicketStateView,
  to: TicketStatusCode,
  actor: TicketActorContext,
  options: { now: Date; reopenWindowDays: number },
): TransitionVerdict {
  if (state.status === to) {
    return {
      allowed: false,
      kind: 'STRUCTURAL',
      reason: `The ticket is already ${to}`,
    };
  }

  if (!TRANSITIONS[state.status].includes(to)) {
    return {
      allowed: false,
      kind: 'STRUCTURAL',
      reason: `A ${state.status} ticket cannot move to ${to}`,
    };
  }

  if (!actor.isManager && !actor.isAssignee) {
    return {
      allowed: false,
      kind: 'POLICY',
      reason:
        'Only the assignee or somebody who manages the inbox may change a ticket status',
    };
  }

  if (to === 'REOPENED') {
    const window = reopenWindow(state, options.now, options.reopenWindowDays);
    if (!window.open) {
      return {
        allowed: false,
        kind: 'POLICY',
        reason: `The reopen window closed on ${window.closesAt?.toISOString().slice(0, 10)} — ${options.reopenWindowDays} days after the ticket was closed. Raise a new ticket referencing this one.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * The columns a status move must write, so no call site assembles them by
 * hand — the M16 `deriveStatus` rule: when the database CHECKs a shape,
 * exactly one place should build it.
 *
 * Note what a reopen clears: `resolved_at`, `closed_at`, the resolution
 * and the SLA escalation stamp. A reopened complaint is a live complaint
 * again, and leaving `escalated_at` set would mean the sweep never chases
 * it a second time — the ticket that was already ignored once being the
 * one that gets ignored again.
 *
 * Note also what it does **not** clear: the **satisfaction rating**. The
 * family rated how the school handled the first attempt, and that
 * happened. Clearing it would let a school raise its average satisfaction
 * by reopening the tickets people scored badly, which is exactly
 * backwards; `chk_tickets_status_evidence` permits a rating on a REOPENED
 * row for the same reason.
 */
export interface StatusPatch {
  status: TicketStatusCode;
  resolution?: string | null;
  resolvedAt?: Date | null;
  closedAt?: Date | null;
  reopenedAt?: Date | null;
  escalatedAt?: Date | null;
}

export function statusPatch(
  to: TicketStatusCode,
  now: Date,
  input: { resolution?: string | null; existingResolvedAt: Date | null },
): StatusPatch {
  switch (to) {
    case 'RESOLVED':
      return {
        status: 'RESOLVED',
        resolution: input.resolution ?? null,
        resolvedAt: now,
        closedAt: null,
      };
    case 'CLOSED':
      return {
        status: 'CLOSED',
        resolution: input.resolution ?? null,
        // Closing straight from OPEN still needs a resolution time: the
        // CHECK demands one, and "when was this settled" has an answer
        // even when the office settled and closed it in one action.
        resolvedAt: input.existingResolvedAt ?? now,
        closedAt: now,
      };
    case 'REOPENED':
      return {
        status: 'REOPENED',
        reopenedAt: now,
        resolvedAt: null,
        closedAt: null,
        resolution: null,
        escalatedAt: null,
      };
    default:
      return { status: to };
  }
}

/**
 * Roadmap §8: "complaint about a specific teacher → visibility restricted".
 *
 * Sensitivity is decided at creation from the category and then **stored**,
 * not recomputed on read. A school that later drops TEACHER from its
 * sensitive list must not thereby expose the complaints already filed
 * under it — the people who wrote those were told they would be handled
 * discreetly, and a settings edit is not their consent.
 */
export function isSensitiveCategory(
  category: TicketCategoryCode,
  sensitiveCategories: readonly TicketCategoryCode[],
): boolean {
  return sensitiveCategories.includes(category);
}

/**
 * The single predicate every notification path consults. It is deliberately
 * not `raisedByType === 'ANONYMOUS'` written out at each call site: there
 * are five of those, and the one that gets it wrong is the one that texts
 * a whistle-blower.
 */
export function isAnonymous(raisedByType: TicketRaiserTypeCode): boolean {
  return raisedByType === 'ANONYMOUS';
}

/**
 * Whether the school can reach the person who raised it. ANONYMOUS never
 * can, by construction; PUBLIC carries a contact block; the three account
 * types are reachable through the row they name.
 */
export function isNotifiable(
  raisedByType: TicketRaiserTypeCode,
  notifyRequester: boolean,
): boolean {
  return notifyRequester && !isAnonymous(raisedByType);
}

/** Priorities in escalation order, so a report can sort by severity. */
const PRIORITY_RANK: Readonly<Record<TicketPriorityCode, number>> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  URGENT: 3,
};

export function priorityRank(priority: TicketPriorityCode): number {
  return PRIORITY_RANK[priority];
}

/** A ticket nobody has finished with. Drives the inbox counts and the SLA. */
export function isLive(status: TicketStatusCode): boolean {
  return status === 'OPEN' || status === 'IN_PROGRESS' || status === 'REOPENED';
}
