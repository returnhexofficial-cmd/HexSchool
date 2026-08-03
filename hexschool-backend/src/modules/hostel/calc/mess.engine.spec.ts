import {
  checkMealOff,
  creditDescription,
  dayRate,
  isLiveMealOff,
  mealOffCredit,
  mealOffDays,
  messCharge,
  monthsBetween,
  nextDay,
  rangesOverlap,
} from './mess.engine';

const OPEN = { from: '2026-03-01', to: null };

describe('mealOffDays', () => {
  it('counts both ends — away on the 12th only is one day', () => {
    expect(mealOffDays('2026-03-12', '2026-03-12')).toBe(1);
    expect(mealOffDays('2026-03-12', '2026-03-20')).toBe(9);
  });

  it('counts across a month boundary', () => {
    expect(mealOffDays('2026-03-30', '2026-04-02')).toBe(4);
  });

  it('returns zero for a backwards or malformed range', () => {
    expect(mealOffDays('2026-03-20', '2026-03-12')).toBe(0);
    expect(mealOffDays('2026-3-1', '2026-03-12')).toBe(0);
  });
});

describe('checkMealOff', () => {
  it('accepts a range that meets the minimum and sits inside the residency', () => {
    expect(
      checkMealOff({
        fromDate: '2026-03-10',
        toDate: '2026-03-14',
        minDays: 3,
        residency: OPEN,
      }),
    ).toEqual({ ok: true, days: 5, reason: null });
  });

  it('refuses a range shorter than the minimum, and says why', () => {
    const verdict = checkMealOff({
      fromDate: '2026-03-10',
      toDate: '2026-03-11',
      minDays: 3,
      residency: OPEN,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.days).toBe(2);
    expect(verdict.reason).toMatch(/at least 3 day/);
  });

  it('accepts a single day when the school sets the minimum to 1', () => {
    expect(
      checkMealOff({
        fromDate: '2026-03-10',
        toDate: '2026-03-10',
        minDays: 1,
        residency: OPEN,
      }).ok,
    ).toBe(true);
  });

  it('treats a minimum of zero or negative as one — a range is at least a day', () => {
    expect(
      checkMealOff({
        fromDate: '2026-03-10',
        toDate: '2026-03-10',
        minDays: 0,
        residency: OPEN,
      }).ok,
    ).toBe(true);
  });

  it('refuses a backwards range', () => {
    expect(
      checkMealOff({
        fromDate: '2026-03-14',
        toDate: '2026-03-10',
        minDays: 1,
        residency: OPEN,
      }).reason,
    ).toMatch(/before the first/);
  });

  it('refuses dates outside the residency — a credit against no bill', () => {
    expect(
      checkMealOff({
        fromDate: '2026-05-01',
        toDate: '2026-05-10',
        minDays: 3,
        residency: { from: '2026-03-01', to: '2026-03-20' },
      }).reason,
    ).toMatch(/outside the time/);
  });
});

describe('rangesOverlap', () => {
  const week = { fromDate: '2026-03-10', toDate: '2026-03-16' };

  it('finds an overlap on a single shared day, at either edge', () => {
    expect(
      rangesOverlap(week, { fromDate: '2026-03-16', toDate: '2026-03-20' }),
    ).toBe(true);
    expect(
      rangesOverlap(week, { fromDate: '2026-03-01', toDate: '2026-03-10' }),
    ).toBe(true);
  });

  it('finds a containment either way round', () => {
    expect(
      rangesOverlap(week, { fromDate: '2026-03-12', toDate: '2026-03-13' }),
    ).toBe(true);
    expect(
      rangesOverlap({ fromDate: '2026-03-12', toDate: '2026-03-13' }, week),
    ).toBe(true);
  });

  it('reports adjacent ranges as clear', () => {
    expect(
      rangesOverlap(week, { fromDate: '2026-03-17', toDate: '2026-03-20' }),
    ).toBe(false);
  });

  it('is symmetric — the M14 id-order lesson, asserted both ways', () => {
    const a = { fromDate: '2026-03-01', toDate: '2026-03-10' };
    const b = { fromDate: '2026-03-05', toDate: '2026-03-15' };
    expect(rangesOverlap(a, b)).toBe(rangesOverlap(b, a));
  });
});

describe('isLiveMealOff', () => {
  it('counts pending and approved requests as holding their dates', () => {
    expect(isLiveMealOff('PENDING')).toBe(true);
    expect(isLiveMealOff('APPROVED')).toBe(true);
  });

  it('releases the dates a rejected or withdrawn request claimed', () => {
    expect(isLiveMealOff('REJECTED')).toBe(false);
    expect(isLiveMealOff('CANCELLED')).toBe(false);
  });
});

describe('dayRate', () => {
  it('derives from the plan over the days of that month', () => {
    expect(dayRate(3100, '2026-03', 0)).toBe(100);
    // February is shorter, so a day of February food is worth more.
    expect(dayRate(2800, '2026-02', 0)).toBe(100);
    expect(dayRate(3100, '2026-02', 0)).toBe(110.71);
  });

  it('prefers a flat rate the school has set', () => {
    expect(dayRate(3100, '2026-03', 90)).toBe(90);
  });

  it('returns zero for a malformed month rather than dividing by zero', () => {
    expect(dayRate(3100, '2026', 0)).toBe(0);
  });
});

describe('messCharge', () => {
  it('charges the whole plan for a whole month', () => {
    expect(
      messCharge({
        monthlyCharge: 3100,
        month: '2026-03',
        window: OPEN,
        prorate: true,
      }),
    ).toEqual({ amount: 3100, messDays: 31, daysInMonth: 31, prorated: false });
  });

  it('prorates a boarder who joined the mess mid-month', () => {
    expect(
      messCharge({
        monthlyCharge: 3100,
        month: '2026-03',
        window: { from: '2026-03-11', to: null },
        prorate: true,
      }),
    ).toEqual({ amount: 2100, messDays: 21, daysInMonth: 31, prorated: true });
  });
});

describe('mealOffCredit', () => {
  const entry = (fromDate: string, toDate: string, monthlyCharge = 3100) => ({
    fromDate,
    toDate,
    monthlyCharge,
  });

  it('credits the derived day rate for each day away', () => {
    expect(
      mealOffCredit({
        entries: [entry('2026-03-10', '2026-03-15')],
        flatRate: 0,
        residency: OPEN,
        cap: 3100,
      }),
    ).toEqual({ amount: 600, days: 6, capped: false });
  });

  it('uses the flat rate when the school has set one', () => {
    expect(
      mealOffCredit({
        entries: [entry('2026-03-10', '2026-03-15')],
        flatRate: 80,
        residency: OPEN,
        cap: 3100,
      }),
    ).toEqual({ amount: 480, days: 6, capped: false });
  });

  it('prices each day in its OWN month across a boundary', () => {
    // 2 days of March at 3100/31 = 100.00, then 2 days of April at
    // 3100/30 = 103.33. A day of April food is worth more than a day of
    // March food, because April's charge buys fewer of them — which is
    // the whole reason the credit is priced month by month rather than
    // against the month it happens to be paid in.
    expect(
      mealOffCredit({
        entries: [entry('2026-03-30', '2026-04-02')],
        flatRate: 0,
        residency: OPEN,
        cap: 5000,
      }),
    ).toEqual({ amount: 406.66, days: 4, capped: false });

    // Same range, a plan whose April rate differs from its March one.
    const split = mealOffCredit({
      entries: [entry('2026-01-30', '2026-02-02', 3100)],
      flatRate: 0,
      residency: { from: '2026-01-01', to: null },
      cap: 5000,
    });
    // 2 × (3100/31) + 2 × (3100/28) = 200 + 221.42
    expect(split.days).toBe(4);
    expect(split.amount).toBe(421.42);
  });

  it('adds up several meal-offs in one month', () => {
    expect(
      mealOffCredit({
        entries: [
          entry('2026-03-03', '2026-03-05'),
          entry('2026-03-20', '2026-03-22'),
        ],
        flatRate: 0,
        residency: OPEN,
        cap: 3100,
      }),
    ).toEqual({ amount: 600, days: 6, capped: false });
  });

  it('caps the credit at what was billed, and says it did', () => {
    expect(
      mealOffCredit({
        entries: [entry('2026-03-01', '2026-03-31')],
        flatRate: 200, // deliberately generous
        residency: OPEN,
        cap: 3100,
      }),
    ).toEqual({ amount: 3100, days: 31, capped: true });
  });

  it('drops days outside the residency — they were never billed', () => {
    expect(
      mealOffCredit({
        entries: [entry('2026-03-15', '2026-03-25')],
        flatRate: 0,
        residency: { from: '2026-03-01', to: '2026-03-20' },
        cap: 3100,
      }),
    ).toEqual({ amount: 500, days: 5, capped: false });
  });

  it('credits nothing when there is nothing to credit against', () => {
    expect(
      mealOffCredit({
        entries: [entry('2026-03-10', '2026-03-15')],
        flatRate: 0,
        residency: OPEN,
        cap: 0,
      }),
    ).toEqual({ amount: 0, days: 6, capped: true });
  });

  it('credits nothing for an empty list', () => {
    expect(
      mealOffCredit({ entries: [], flatRate: 0, residency: OPEN, cap: 3100 }),
    ).toEqual({ amount: 0, days: 0, capped: false });
  });
});

describe('creditDescription', () => {
  it('names the days', () => {
    expect(creditDescription({ amount: 600, days: 6, capped: false })).toBe(
      'Mess credit — 6 day(s) away',
    );
  });

  it('says so when the cap bit', () => {
    expect(creditDescription({ amount: 3100, days: 31, capped: true })).toMatch(
      /capped/,
    );
  });
});

describe('date helpers', () => {
  it('turns an inclusive end into an exclusive one, across month and year ends', () => {
    expect(nextDay('2026-03-15')).toBe('2026-03-16');
    expect(nextDay('2026-03-31')).toBe('2026-04-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(nextDay('2024-02-28')).toBe('2024-02-29');
  });

  it('lists every month a range touches', () => {
    expect(monthsBetween('2026-03-10', '2026-03-20')).toEqual(['2026-03']);
    expect(monthsBetween('2026-03-30', '2026-05-02')).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
    ]);
    expect(monthsBetween('2026-12-20', '2027-01-05')).toEqual([
      '2026-12',
      '2027-01',
    ]);
    expect(monthsBetween('2026-03-20', '2026-03-10')).toEqual([]);
  });
});
