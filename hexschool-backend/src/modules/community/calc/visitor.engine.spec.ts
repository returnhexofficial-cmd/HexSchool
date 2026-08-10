import {
  allowsMultiDayPass,
  appointmentAdmits,
  canMoveAppointment,
  dayStats,
  isInside,
  passLengthRefusal,
  passValidOn,
  visitDurationMinutes,
  visitsToAutoCheckout,
  type VisitView,
} from './visitor.engine';

const NOW = new Date('2026-08-09T16:00:00.000Z');

function visit(over: Partial<VisitView> = {}): VisitView {
  return {
    id: 'v1',
    checkIn: new Date('2026-08-09T09:00:00.000Z'),
    checkOut: null,
    validUntil: null,
    purpose: 'MEETING',
    ...over,
  };
}

describe('visitor.engine — who is in the building', () => {
  it('is exactly "signed in, not signed out"', () => {
    expect(isInside(visit())).toBe(true);
    expect(isInside(visit({ checkOut: NOW }))).toBe(false);
  });

  it('measures a completed visit from the two stamps', () => {
    expect(
      visitDurationMinutes(
        visit({ checkOut: new Date('2026-08-09T10:30:00.000Z') }),
        NOW,
      ),
    ).toBe(90);
  });

  it('measures an open visit against now', () => {
    expect(visitDurationMinutes(visit(), NOW)).toBe(420);
  });
});

describe('visitor.engine — the multi-day pass (roadmap §8)', () => {
  it('is offered only to an OFFICIAL visit', () => {
    expect(allowsMultiDayPass('OFFICIAL')).toBe(true);
    for (const purpose of [
      'MEETING',
      'GUARDIAN_VISIT',
      'VENDOR',
      'ADMISSION_QUERY',
      'OTHER',
    ] as const) {
      expect(allowsMultiDayPass(purpose)).toBe(false);
    }
  });

  it('refuses a multi-day pass for a guardian visit, and says why', () => {
    const refusal = passLengthRefusal(
      'GUARDIAN_VISIT',
      new Date('2026-08-09T09:00:00.000Z'),
      new Date('2026-08-12T00:00:00.000Z'),
      30,
    );
    expect(refusal).toContain('OFFICIAL');
  });

  it("caps an official pass at the school's configured length", () => {
    expect(
      passLengthRefusal(
        'OFFICIAL',
        new Date('2026-08-01T09:00:00.000Z'),
        new Date('2026-08-05T00:00:00.000Z'),
        3,
      ),
    ).toContain('at most 3');
  });

  it('counts the pass length inclusively — 1st to 3rd is three days', () => {
    expect(
      passLengthRefusal(
        'OFFICIAL',
        new Date('2026-08-01T09:00:00.000Z'),
        new Date('2026-08-03T00:00:00.000Z'),
        3,
      ),
    ).toBeNull();
  });

  it('leaves an ordinary same-day visit alone', () => {
    expect(passLengthRefusal('MEETING', NOW, null, 30)).toBeNull();
  });
});

describe('visitor.engine — pass validity is a calendar day, not an instant', () => {
  it('admits a same-day pass all day, hours after it was issued', () => {
    const v = visit({ checkIn: new Date('2026-08-09T09:00:00.000Z') });
    expect(passValidOn(v, new Date('2026-08-09T16:45:00.000Z')).valid).toBe(
      true,
    );
  });

  it('refuses a same-day pass the next morning', () => {
    const v = visit({ checkIn: new Date('2026-08-09T09:00:00.000Z') });
    const verdict = passValidOn(v, new Date('2026-08-10T08:00:00.000Z'));
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toContain('2026-08-09');
  });

  it('admits an official pass on each of its days and refuses the day after', () => {
    const v = visit({
      purpose: 'OFFICIAL',
      checkIn: new Date('2026-08-09T08:00:00.000Z'),
      validUntil: new Date('2026-08-11T00:00:00.000Z'),
    });
    for (const day of ['2026-08-09', '2026-08-10', '2026-08-11']) {
      expect(passValidOn(v, new Date(`${day}T14:00:00.000Z`)).valid).toBe(true);
    }
    expect(passValidOn(v, new Date('2026-08-12T08:00:00.000Z')).valid).toBe(
      false,
    );
  });

  it('refuses a date before the pass was issued', () => {
    expect(
      passValidOn(visit(), new Date('2026-08-08T12:00:00.000Z')).reason,
    ).toContain('issued after');
  });
});

describe('visitor.engine — the day-end sweep (roadmap §4)', () => {
  it('checks out everybody still inside on an ordinary day', () => {
    const rows = [
      {
        id: 'a',
        checkIn: new Date('2026-08-09T09:00:00.000Z'),
        validUntil: null,
        purpose: 'MEETING' as const,
      },
      {
        id: 'b',
        checkIn: new Date('2026-08-09T11:00:00.000Z'),
        validUntil: null,
        purpose: 'VENDOR' as const,
      },
    ];
    expect(visitsToAutoCheckout(rows, NOW).map((v) => v.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('leaves a multi-day pass alone until its last day', () => {
    const invigilator = {
      id: 'inv',
      checkIn: new Date('2026-08-09T08:00:00.000Z'),
      validUntil: new Date('2026-08-11T00:00:00.000Z'),
      purpose: 'OFFICIAL' as const,
    };
    expect(visitsToAutoCheckout([invigilator], NOW)).toEqual([]);
    expect(
      visitsToAutoCheckout([invigilator], new Date('2026-08-11T21:00:00.000Z')),
    ).toHaveLength(1);
  });

  it('sweeps a pass whose last day has already passed', () => {
    const stale = {
      id: 'stale',
      checkIn: new Date('2026-08-01T08:00:00.000Z'),
      validUntil: new Date('2026-08-03T00:00:00.000Z'),
      purpose: 'OFFICIAL' as const,
    };
    expect(visitsToAutoCheckout([stale], NOW)).toHaveLength(1);
  });
});

describe('visitor.engine — appointments', () => {
  it('admits only an APPROVED appointment at the gate', () => {
    expect(appointmentAdmits('APPROVED')).toBe(true);
    for (const status of [
      'PENDING',
      'REJECTED',
      'COMPLETED',
      'NO_SHOW',
    ] as const) {
      expect(appointmentAdmits(status)).toBe(false);
    }
  });

  it('walks PENDING → APPROVED → COMPLETED', () => {
    expect(canMoveAppointment('PENDING', 'APPROVED').allowed).toBe(true);
    expect(canMoveAppointment('APPROVED', 'COMPLETED').allowed).toBe(true);
  });

  it('keeps NO_SHOW distinct from REJECTED — they are different facts', () => {
    expect(canMoveAppointment('APPROVED', 'NO_SHOW').allowed).toBe(true);
    expect(canMoveAppointment('REJECTED', 'NO_SHOW').allowed).toBe(false);
  });

  it('refuses to move a terminal appointment', () => {
    for (const from of ['REJECTED', 'COMPLETED', 'NO_SHOW'] as const) {
      expect(canMoveAppointment(from, 'APPROVED').allowed).toBe(false);
    }
  });

  it('refuses a move to the status it already holds', () => {
    expect(canMoveAppointment('PENDING', 'PENDING')).toEqual({
      allowed: false,
      reason: 'The appointment is already PENDING',
    });
  });
});

describe('visitor.engine — the daily register summary', () => {
  const rows = [
    {
      ...visit({ id: 'a', checkOut: new Date('2026-08-09T10:00:00.000Z') }),
      autoCheckedOut: false,
    },
    {
      ...visit({ id: 'b', checkOut: new Date('2026-08-09T12:00:00.000Z') }),
      autoCheckedOut: true,
    },
    { ...visit({ id: 'c', purpose: 'VENDOR' }), autoCheckedOut: false },
  ];

  it('counts who came, who is still here, and who the sweep signed out', () => {
    const stats = dayStats(rows, NOW);
    expect(stats.total).toBe(3);
    expect(stats.inside).toBe(1);
    expect(stats.departed).toBe(2);
    expect(stats.autoCheckedOut).toBe(1);
  });

  it('averages only completed visits, so the figure does not drift all afternoon', () => {
    // 60 and 180 minutes; the open visit contributes nothing.
    expect(dayStats(rows, NOW).avgStayMinutes).toBe(120);
  });

  it('breaks the day down by purpose, commonest first', () => {
    expect(dayStats(rows, NOW).byPurpose).toEqual([
      { purpose: 'MEETING', count: 2 },
      { purpose: 'VENDOR', count: 1 },
    ]);
  });

  it('returns zeroes for a day nobody visited', () => {
    expect(dayStats([], NOW)).toEqual({
      total: 0,
      inside: 0,
      departed: 0,
      autoCheckedOut: 0,
      avgStayMinutes: 0,
      byPurpose: [],
    });
  });
});
