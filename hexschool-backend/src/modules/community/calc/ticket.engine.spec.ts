import {
  allowedTransitions,
  canTransition,
  isAnonymous,
  isLive,
  isNotifiable,
  isSensitiveCategory,
  priorityRank,
  reopenWindow,
  statusPatch,
  type TicketStateView,
} from './ticket.engine';
import type { TicketStatusCode } from './types';

const NOW = new Date('2026-08-09T10:00:00.000Z');

function state(over: Partial<TicketStateView> = {}): TicketStateView {
  return { status: 'OPEN', closedAt: null, assignedTo: null, ...over };
}

const MANAGER = { isManager: true, isAssignee: false };
const ASSIGNEE = { isManager: false, isAssignee: true };
const BYSTANDER = { isManager: false, isAssignee: false };
const OPTS = { now: NOW, reopenWindowDays: 7 };

describe('ticket.engine — the transition machine', () => {
  it('walks the ordinary path OPEN → IN_PROGRESS → RESOLVED → CLOSED', () => {
    const path: TicketStatusCode[] = [
      'OPEN',
      'IN_PROGRESS',
      'RESOLVED',
      'CLOSED',
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(
        canTransition(state({ status: path[i] }), path[i + 1], ASSIGNEE, OPTS),
      ).toEqual({ allowed: true });
    }
  });

  it('never offers a route back to OPEN from a settled ticket — a dispute is REOPENED', () => {
    expect(allowedTransitions('RESOLVED')).not.toContain('OPEN');
    expect(allowedTransitions('CLOSED')).toEqual(['REOPENED']);
    expect(allowedTransitions('REOPENED')).not.toContain('OPEN');
  });

  it('refuses a move to the status it is already in', () => {
    expect(
      canTransition(state({ status: 'OPEN' }), 'OPEN', MANAGER, OPTS),
    ).toEqual({
      allowed: false,
      kind: 'STRUCTURAL',
      reason: 'The ticket is already OPEN',
    });
  });

  it('refuses an illegal jump structurally — no permission reaches it', () => {
    const verdict = canTransition(
      state({ status: 'CLOSED', closedAt: NOW }),
      'IN_PROGRESS',
      MANAGER,
      OPTS,
    );
    expect(verdict).toMatchObject({ allowed: false, kind: 'STRUCTURAL' });
  });

  it('refuses a bystander as POLICY — roadmap §6, only assignee or admin', () => {
    const verdict = canTransition(state(), 'IN_PROGRESS', BYSTANDER, OPTS);
    expect(verdict).toMatchObject({ allowed: false, kind: 'POLICY' });
    expect((verdict as { reason: string }).reason).toContain('assignee');
  });

  it('lets the assignee close their own work without chasing an administrator', () => {
    expect(
      canTransition(state({ status: 'RESOLVED' }), 'CLOSED', ASSIGNEE, OPTS),
    ).toEqual({ allowed: true });
  });
});

describe('ticket.engine — the seven-day reopen window (roadmap §6)', () => {
  it('is open on day six and shut on day eight', () => {
    const closedAt = new Date('2026-08-01T10:00:00.000Z');
    const day6 = new Date('2026-08-07T09:00:00.000Z');
    const day8 = new Date('2026-08-09T10:00:01.000Z');

    expect(
      reopenWindow(state({ status: 'CLOSED', closedAt }), day6, 7).open,
    ).toBe(true);
    expect(
      reopenWindow(state({ status: 'CLOSED', closedAt }), day8, 7).open,
    ).toBe(false);
  });

  it('measures from closed_at, not from "recently" — an internal note cannot extend it', () => {
    const closedAt = new Date('2026-08-01T10:00:00.000Z');
    const window = reopenWindow(state({ status: 'CLOSED', closedAt }), NOW, 7);
    expect(window.closesAt).toEqual(new Date('2026-08-08T10:00:00.000Z'));
  });

  it('reports zero days left only once the window has genuinely shut', () => {
    // Closed on the 3rd at 08:00 ⇒ the window shuts on the 10th at 08:00,
    // so 22 hours remain. A parent must be told "1 day", not "0".
    const closedAt = new Date('2026-08-03T08:00:00.000Z');
    const window = reopenWindow(state({ status: 'CLOSED', closedAt }), NOW, 7);
    expect(window.daysLeft).toBe(1);
    expect(window.open).toBe(true);
  });

  it('treats a ticket that was never closed as unconstrained', () => {
    const window = reopenWindow(state({ status: 'RESOLVED' }), NOW, 7);
    expect(window).toEqual({ open: true, closesAt: null, daysLeft: 7 });
  });

  it('refuses the reopen once the window has passed, and says when it shut', () => {
    const closedAt = new Date('2026-07-01T10:00:00.000Z');
    const verdict = canTransition(
      state({ status: 'CLOSED', closedAt }),
      'REOPENED',
      MANAGER,
      OPTS,
    );
    expect(verdict).toMatchObject({ allowed: false, kind: 'POLICY' });
    expect((verdict as { reason: string }).reason).toContain('2026-07-08');
  });
});

describe('ticket.engine — the columns a status move writes', () => {
  it('stamps resolved_at on RESOLVED and leaves closed_at alone', () => {
    expect(
      statusPatch('RESOLVED', NOW, {
        resolution: 'Bus timing adjusted',
        existingResolvedAt: null,
      }),
    ).toEqual({
      status: 'RESOLVED',
      resolution: 'Bus timing adjusted',
      resolvedAt: NOW,
      closedAt: null,
    });
  });

  it('gives a straight OPEN → CLOSED a resolution time, because the CHECK demands one', () => {
    const patch = statusPatch('CLOSED', NOW, {
      resolution: 'Spoke to the guardian',
      existingResolvedAt: null,
    });
    expect(patch.resolvedAt).toEqual(NOW);
    expect(patch.closedAt).toEqual(NOW);
  });

  it('keeps the original resolution time when a resolved ticket is later closed', () => {
    const resolvedAt = new Date('2026-08-05T09:00:00.000Z');
    const patch = statusPatch('CLOSED', NOW, {
      resolution: 'Done',
      existingResolvedAt: resolvedAt,
    });
    expect(patch.resolvedAt).toEqual(resolvedAt);
    expect(patch.closedAt).toEqual(NOW);
  });

  it('clears escalated_at on a reopen, so the sweep can chase it a second time', () => {
    const patch = statusPatch('REOPENED', NOW, { existingResolvedAt: NOW });
    expect(patch).toEqual({
      status: 'REOPENED',
      reopenedAt: NOW,
      resolvedAt: null,
      closedAt: null,
      resolution: null,
      escalatedAt: null,
    });
  });

  /**
   * The e2e run found this: reopening a **rated** ticket hit
   * `chk_tickets_status_evidence`, whose ratings clause originally allowed
   * a score only on RESOLVED or CLOSED. The fix was the constraint, not
   * the patch — clearing the rating would let a school raise its average
   * satisfaction by reopening the tickets people scored badly.
   */
  it('never touches the satisfaction rating — that score is a fact that happened', () => {
    const patch = statusPatch('REOPENED', NOW, { existingResolvedAt: NOW });
    expect(patch).not.toHaveProperty('satisfactionRating');
  });
});

describe('ticket.engine — anonymity and sensitivity', () => {
  it('never notifies an anonymous complainant, however the setting is set', () => {
    expect(isAnonymous('ANONYMOUS')).toBe(true);
    expect(isNotifiable('ANONYMOUS', true)).toBe(false);
    expect(isNotifiable('GUARDIAN', true)).toBe(true);
    expect(isNotifiable('GUARDIAN', false)).toBe(false);
  });

  it('marks a complaint about a teacher sensitive by default (roadmap §8)', () => {
    expect(isSensitiveCategory('TEACHER', ['TEACHER'])).toBe(true);
    expect(isSensitiveCategory('FACILITY', ['TEACHER'])).toBe(false);
  });

  it('lets a school widen the sensitive list without touching the code', () => {
    expect(isSensitiveCategory('FEES', ['TEACHER', 'FEES'])).toBe(true);
  });

  it('ranks priorities in escalation order', () => {
    expect(priorityRank('URGENT')).toBeGreaterThan(priorityRank('HIGH'));
    expect(priorityRank('HIGH')).toBeGreaterThan(priorityRank('MEDIUM'));
    expect(priorityRank('MEDIUM')).toBeGreaterThan(priorityRank('LOW'));
  });

  it('counts OPEN, IN_PROGRESS and REOPENED as live work', () => {
    expect(isLive('OPEN')).toBe(true);
    expect(isLive('IN_PROGRESS')).toBe(true);
    expect(isLive('REOPENED')).toBe(true);
    expect(isLive('RESOLVED')).toBe(false);
    expect(isLive('CLOSED')).toBe(false);
  });
});
