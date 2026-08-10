import {
  DEFAULT_SLA_HOURS,
  clockStartedAt,
  resolutionStats,
  slaHoursFor,
  slaState,
  ticketsToEscalate,
  type SlaTicketView,
} from './sla.engine';

const NOW = new Date('2026-08-09T12:00:00.000Z');

function ticket(over: Partial<SlaTicketView> = {}): SlaTicketView {
  return {
    id: 't1',
    status: 'OPEN',
    priority: 'MEDIUM',
    createdAt: new Date('2026-08-09T00:00:00.000Z'),
    reopenedAt: null,
    firstResponseAt: null,
    resolvedAt: null,
    escalatedAt: null,
    ...over,
  };
}

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

describe('sla.engine — the threshold', () => {
  it("defaults MEDIUM to the roadmap's 72 hours", () => {
    expect(DEFAULT_SLA_HOURS.MEDIUM).toBe(72);
    expect(slaHoursFor('MEDIUM', {})).toBe(72);
  });

  it('gives an urgent complaint a shorter clock than a suggestion', () => {
    expect(slaHoursFor('URGENT', {})).toBeLessThan(slaHoursFor('LOW', {}));
  });

  it("takes a school's configured hours", () => {
    expect(slaHoursFor('HIGH', { HIGH: 6 })).toBe(6);
  });

  it('falls back to the default for null, undefined, NaN and zero — the M24 lesson', () => {
    // `Number(null)` is 0 and `Number.isFinite(0)` is true, so a guard that
    // only tests for NaN would accept a zero-hour SLA and mark every ticket
    // breached the instant it was raised.
    for (const bad of [null, undefined, Number.NaN, 0, -5]) {
      expect(slaHoursFor('HIGH', { HIGH: bad as unknown as number })).toBe(
        DEFAULT_SLA_HOURS.HIGH,
      );
    }
  });
});

describe('sla.engine — the clock', () => {
  it('runs from created_at for a live ticket', () => {
    const t = ticket({ createdAt: hoursAgo(10) });
    expect(clockStartedAt(t)).toEqual(hoursAgo(10));
  });

  it('restarts at reopened_at, so a March complaint reopened today is not instantly overdue', () => {
    const t = ticket({
      status: 'REOPENED',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      reopenedAt: hoursAgo(2),
    });
    expect(clockStartedAt(t)).toEqual(hoursAgo(2));
    expect(slaState(t, NOW).breached).toBe(false);
  });

  it('breaches once the age passes the SLA', () => {
    const t = ticket({ priority: 'URGENT', createdAt: hoursAgo(25) });
    const state = slaState(t, NOW);
    expect(state.slaHours).toBe(24);
    expect(state.ageHours).toBe(25);
    expect(state.breached).toBe(true);
    expect(state.hoursRemaining).toBe(-1);
  });

  it('does not breach a ticket that is already settled', () => {
    const t = ticket({
      status: 'RESOLVED',
      createdAt: hoursAgo(500),
      resolvedAt: hoursAgo(1),
    });
    expect(slaState(t, NOW).breached).toBe(false);
  });
});

describe('sla.engine — the sweep', () => {
  it('escalates a breached ticket exactly once (escalated_at is the dedupe)', () => {
    const fresh = ticket({ id: 'a', createdAt: hoursAgo(100) });
    expect(slaState(fresh, NOW).shouldEscalate).toBe(true);

    const chased = ticket({
      id: 'a',
      createdAt: hoursAgo(100),
      escalatedAt: hoursAgo(4),
    });
    expect(slaState(chased, NOW).breached).toBe(true);
    expect(slaState(chased, NOW).shouldEscalate).toBe(false);
  });

  it('returns only what needs chasing, worst priority first', () => {
    const rows = [
      ticket({ id: 'low', priority: 'LOW', createdAt: hoursAgo(130) }),
      ticket({ id: 'urgent', priority: 'URGENT', createdAt: hoursAgo(30) }),
      ticket({ id: 'fine', priority: 'MEDIUM', createdAt: hoursAgo(1) }),
      ticket({
        id: 'chased',
        priority: 'URGENT',
        createdAt: hoursAgo(90),
        escalatedAt: hoursAgo(1),
      }),
    ];
    expect(ticketsToEscalate(rows, NOW).map((s) => s.ticketId)).toEqual([
      'urgent',
      'low',
    ]);
  });

  it('escalates nothing when the whole inbox is inside its SLA', () => {
    expect(
      ticketsToEscalate([ticket({ createdAt: hoursAgo(2) })], NOW),
    ).toEqual([]);
  });
});

describe('sla.engine — the report numbers', () => {
  it('averages only resolved tickets, so leaving one open cannot improve the figure', () => {
    const rows = [
      ticket({ id: 'a', createdAt: hoursAgo(10), resolvedAt: hoursAgo(4) }), // 6 h
      ticket({ id: 'b', createdAt: hoursAgo(20), resolvedAt: hoursAgo(10) }), // 10 h
      // Open for three weeks and deliberately excluded.
      ticket({ id: 'c', createdAt: hoursAgo(500) }),
    ];
    const stats = resolutionStats(rows);
    expect(stats.resolved).toBe(2);
    expect(stats.avgResolutionHours).toBe(8);
  });

  it('reports SLA compliance over the resolved set', () => {
    const rows = [
      // MEDIUM, 72 h SLA: inside.
      ticket({ id: 'a', createdAt: hoursAgo(30), resolvedAt: hoursAgo(5) }),
      // URGENT, 24 h SLA: 40 h — outside.
      ticket({
        id: 'b',
        priority: 'URGENT',
        createdAt: hoursAgo(45),
        resolvedAt: hoursAgo(5),
      }),
    ];
    const stats = resolutionStats(rows);
    expect(stats.withinSla).toBe(1);
    expect(stats.slaCompliancePercent).toBe(50);
  });

  it('averages first response over only the tickets that got one', () => {
    const rows = [
      ticket({
        id: 'a',
        createdAt: hoursAgo(10),
        firstResponseAt: hoursAgo(8),
        resolvedAt: hoursAgo(2),
      }),
      ticket({ id: 'b', createdAt: hoursAgo(10), resolvedAt: hoursAgo(2) }),
    ];
    expect(resolutionStats(rows).avgFirstResponseHours).toBe(2);
  });

  it('returns zeroes rather than NaN for an empty window', () => {
    expect(resolutionStats([])).toEqual({
      resolved: 0,
      avgResolutionHours: 0,
      avgFirstResponseHours: 0,
      withinSla: 0,
      slaCompliancePercent: 0,
    });
  });

  it('clamps a resolution that predates the reopen clock rather than reporting a negative average', () => {
    const rows = [
      ticket({
        id: 'a',
        status: 'REOPENED',
        createdAt: hoursAgo(100),
        reopenedAt: hoursAgo(2),
        resolvedAt: hoursAgo(50),
      }),
    ];
    expect(resolutionStats(rows).avgResolutionHours).toBe(0);
  });
});
