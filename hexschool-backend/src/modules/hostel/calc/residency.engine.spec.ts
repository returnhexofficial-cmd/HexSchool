import {
  intersect,
  monthlyRent,
  occupiesDay,
  rentDescription,
  residencyWindow,
  residentDaysInMonth,
  type AllocationDates,
} from './residency.engine';

const base: AllocationDates = {
  startDate: '2026-03-01',
  endDate: null,
  suspendedAt: null,
  resumedAt: null,
  status: 'ACTIVE',
};

describe('residencyWindow', () => {
  it('opens at the start date and never closes for a live boarder', () => {
    expect(residencyWindow(base)).toEqual({ from: '2026-03-01', to: null });
  });

  it('closes at the end date when the boarder has vacated', () => {
    expect(
      residencyWindow({ ...base, status: 'VACATED', endDate: '2026-03-20' }),
    ).toEqual({ from: '2026-03-01', to: '2026-03-20' });
  });

  it('closes at the suspension date while suspended', () => {
    expect(
      residencyWindow({
        ...base,
        status: 'SUSPENDED',
        suspendedAt: '2026-03-10',
      }),
    ).toEqual({ from: '2026-03-01', to: '2026-03-10' });
  });

  it('reopens from the resume date, dropping the lifted suspension', () => {
    expect(
      residencyWindow({
        ...base,
        suspendedAt: null,
        resumedAt: '2026-03-15',
      }),
    ).toEqual({ from: '2026-03-15', to: null });
  });

  it('treats a suspension already lifted by a later resume as history', () => {
    // A row that still carries both — the CHECK forbids it on an ACTIVE
    // row, but a VACATED-then-corrected row could reach the engine.
    expect(
      residencyWindow({
        ...base,
        suspendedAt: '2026-03-10',
        resumedAt: '2026-03-15',
      }),
    ).toEqual({ from: '2026-03-15', to: null });
  });

  it('lets an end date beat a suspension — somebody who left, left', () => {
    expect(
      residencyWindow({
        ...base,
        status: 'VACATED',
        suspendedAt: '2026-03-10',
        endDate: '2026-03-25',
      }),
    ).toEqual({ from: '2026-03-01', to: '2026-03-25' });
  });

  it('ignores a resume date before the start date', () => {
    expect(residencyWindow({ ...base, resumedAt: '2026-02-01' })).toEqual({
      from: '2026-03-01',
      to: null,
    });
  });
});

describe('occupiesDay', () => {
  const window = { from: '2026-03-05', to: '2026-03-10' };

  it('includes the first day and excludes the last — the window is half-open', () => {
    expect(occupiesDay(window, '2026-03-05')).toBe(true);
    expect(occupiesDay(window, '2026-03-09')).toBe(true);
    expect(occupiesDay(window, '2026-03-10')).toBe(false);
    expect(occupiesDay(window, '2026-03-04')).toBe(false);
  });

  it('never ends for an open window', () => {
    expect(occupiesDay({ from: '2026-03-05', to: null }, '2099-01-01')).toBe(
      true,
    );
  });

  it('refuses a malformed day rather than guessing', () => {
    expect(occupiesDay(window, '2026-3-7')).toBe(false);
    expect(occupiesDay(window, '')).toBe(false);
  });
});

describe('residentDaysInMonth', () => {
  it('counts a whole month', () => {
    expect(
      residentDaysInMonth({ from: '2026-01-01', to: null }, '2026-03'),
    ).toBe(31);
  });

  it('counts a mid-month arrival to the end of the month', () => {
    expect(
      residentDaysInMonth({ from: '2026-03-11', to: null }, '2026-03'),
    ).toBe(21);
  });

  it('excludes the exclusive end day', () => {
    // Left on the 20th: the 20th is not a night in the bed.
    expect(
      residentDaysInMonth({ from: '2026-03-01', to: '2026-03-20' }, '2026-03'),
    ).toBe(19);
  });

  it('returns zero for a month entirely outside the window', () => {
    expect(
      residentDaysInMonth({ from: '2026-03-01', to: '2026-03-20' }, '2026-05'),
    ).toBe(0);
  });

  it('handles February in a leap year', () => {
    expect(
      residentDaysInMonth({ from: '2024-01-01', to: null }, '2024-02'),
    ).toBe(29);
  });

  it('returns zero for a malformed month rather than throwing', () => {
    expect(residentDaysInMonth({ from: '2026-03-01', to: null }, '2026')).toBe(
      0,
    );
    expect(
      residentDaysInMonth({ from: '2026-03-01', to: null }, '2026-13'),
    ).toBe(0);
  });
});

describe('intersect — roadmap §8 precedence', () => {
  it('clips the inner window to the outer one', () => {
    expect(
      intersect(
        { from: '2026-03-01', to: '2026-03-20' },
        { from: '2026-02-01', to: '2026-04-01' },
      ),
    ).toEqual({ from: '2026-03-01', to: '2026-03-20' });
  });

  it('keeps a fully-contained inner window intact', () => {
    expect(
      intersect(
        { from: '2026-03-01', to: null },
        { from: '2026-03-10', to: '2026-03-15' },
      ),
    ).toEqual({ from: '2026-03-10', to: '2026-03-15' });
  });

  it('stays open only when both ends are open', () => {
    expect(
      intersect(
        { from: '2026-03-01', to: null },
        { from: '2026-03-05', to: null },
      ),
    ).toEqual({ from: '2026-03-05', to: null });
  });

  it('returns null when the windows do not touch', () => {
    expect(
      intersect(
        { from: '2026-03-01', to: '2026-03-10' },
        { from: '2026-04-01', to: null },
      ),
    ).toBeNull();
  });

  it('returns null for a zero-width overlap — a single instant is no days', () => {
    expect(
      intersect(
        { from: '2026-03-01', to: '2026-03-10' },
        { from: '2026-03-10', to: '2026-03-20' },
      ),
    ).toBeNull();
  });

  it('bounds a mess enrolment nobody closed by the vacate date', () => {
    // The whole point of the precedence rule: an open-ended mess window
    // against a boarder who left on the 15th bills 14 days, not the month.
    const covered = intersect(
      { from: '2026-03-01', to: '2026-03-15' },
      { from: '2026-03-01', to: null },
    );
    expect(covered).toEqual({ from: '2026-03-01', to: '2026-03-15' });
    expect(residentDaysInMonth(covered!, '2026-03')).toBe(14);
  });
});

describe('monthlyRent', () => {
  const window = { from: '2026-03-01', to: null };

  it('charges a full month for a full month', () => {
    expect(
      monthlyRent({
        monthlyFee: 3100,
        month: '2026-03',
        window,
        prorate: true,
      }),
    ).toEqual({
      amount: 3100,
      residentDays: 31,
      daysInMonth: 31,
      prorated: false,
    });
  });

  it('prorates a mid-month arrival', () => {
    expect(
      monthlyRent({
        monthlyFee: 3100,
        month: '2026-03',
        window: { from: '2026-03-11', to: null },
        prorate: true,
      }),
    ).toEqual({
      amount: 2100,
      residentDays: 21,
      daysInMonth: 31,
      prorated: true,
    });
  });

  it('charges a whole month with proration off — "per month started"', () => {
    expect(
      monthlyRent({
        monthlyFee: 3100,
        month: '2026-03',
        window: { from: '2026-03-29', to: null },
        prorate: false,
      }),
    ).toEqual({
      amount: 3100,
      residentDays: 3,
      daysInMonth: 31,
      prorated: false,
    });
  });

  it('charges nothing for a month with no residency, proration on or off', () => {
    for (const prorate of [true, false]) {
      expect(
        monthlyRent({
          monthlyFee: 3100,
          month: '2026-05',
          window: { from: '2026-03-01', to: '2026-03-20' },
          prorate,
        }).amount,
      ).toBe(0);
    }
  });

  it('rounds to the paisa', () => {
    // 1000 / 31 * 7 = 225.806…
    expect(
      monthlyRent({
        monthlyFee: 1000,
        month: '2026-03',
        window: { from: '2026-03-25', to: null },
        prorate: true,
      }).amount,
    ).toBe(225.81);
  });

  it('treats a negative fee as zero rather than crediting a boarder', () => {
    expect(
      monthlyRent({ monthlyFee: -500, month: '2026-03', window, prorate: true })
        .amount,
    ).toBe(0);
  });
});

describe('rentDescription', () => {
  it('names the building and the room', () => {
    expect(
      rentDescription('Shapla Hostel', 'A-101', {
        amount: 3100,
        residentDays: 31,
        daysInMonth: 31,
        prorated: false,
      }),
    ).toBe('Hostel — Shapla Hostel (Room A-101)');
  });

  it('shows the fraction when the charge is partial', () => {
    expect(
      rentDescription('Shapla Hostel', 'A-101', {
        amount: 2100,
        residentDays: 21,
        daysInMonth: 31,
        prorated: true,
      }),
    ).toBe('Hostel — Shapla Hostel (Room A-101), 21/31 days');
  });
});
