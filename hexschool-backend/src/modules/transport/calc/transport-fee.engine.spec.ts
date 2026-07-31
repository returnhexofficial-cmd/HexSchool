import {
  chargeDescription,
  daysInMonth,
  expectedMonthlyRevenue,
  monthlyCharge,
  servedDaysInMonth,
  serviceWindow,
  servesDay,
  type AssignmentDates,
} from './transport-fee.engine';

const rider = (over: Partial<AssignmentDates> = {}): AssignmentDates => ({
  startDate: '2026-03-01',
  endDate: null,
  suspendedAt: null,
  resumedAt: null,
  status: 'ACTIVE',
  ...over,
});

describe('daysInMonth', () => {
  it.each([
    ['2026-01', 31],
    ['2026-02', 28],
    ['2024-02', 29],
    ['2026-04', 30],
    ['2026-12', 31],
  ])('%s has %i days', (month, expected) => {
    expect(daysInMonth(month)).toBe(expected);
  });

  it('refuses a shape that is not a month rather than guessing', () => {
    expect(daysInMonth('2026-13')).toBe(0);
    expect(daysInMonth('2026-00')).toBe(0);
    expect(daysInMonth('March')).toBe(0);
    expect(daysInMonth('2026-03-01')).toBe(0);
  });
});

describe('serviceWindow', () => {
  it('is open-ended for a rider who simply travels', () => {
    expect(serviceWindow(rider())).toEqual({ from: '2026-03-01', to: null });
  });

  it('closes at the end date', () => {
    expect(
      serviceWindow(rider({ endDate: '2026-03-20', status: 'ENDED' })),
    ).toEqual({ from: '2026-03-01', to: '2026-03-20' });
  });

  it('closes at the suspension date while suspended', () => {
    expect(
      serviceWindow(rider({ suspendedAt: '2026-03-11', status: 'SUSPENDED' })),
    ).toEqual({ from: '2026-03-01', to: '2026-03-11' });
  });

  it('reopens from the resume date, and the old suspension stops being a boundary', () => {
    expect(
      serviceWindow(
        rider({ suspendedAt: '2026-02-10', resumedAt: '2026-03-05' }),
      ),
    ).toEqual({ from: '2026-03-05', to: null });
  });

  it('lets an end date win over a suspension — a rider who left, left', () => {
    expect(
      serviceWindow(
        rider({
          suspendedAt: '2026-03-05',
          endDate: '2026-03-18',
          status: 'ENDED',
        }),
      ),
    ).toEqual({ from: '2026-03-01', to: '2026-03-18' });
  });

  it('ignores a resume date that predates the start', () => {
    expect(serviceWindow(rider({ resumedAt: '2026-02-01' }))).toEqual({
      from: '2026-03-01',
      to: null,
    });
  });
});

describe('servesDay', () => {
  const window = { from: '2026-03-05', to: '2026-03-20' };

  it('includes the first day and excludes the last — the window is half-open', () => {
    expect(servesDay(window, '2026-03-05')).toBe(true);
    expect(servesDay(window, '2026-03-19')).toBe(true);
    expect(servesDay(window, '2026-03-20')).toBe(false);
    expect(servesDay(window, '2026-03-04')).toBe(false);
  });

  it('serves everything after an open end', () => {
    expect(servesDay({ from: '2026-03-05', to: null }, '2030-01-01')).toBe(
      true,
    );
  });

  it('refuses a malformed day rather than comparing strings by luck', () => {
    expect(servesDay(window, '5 March')).toBe(false);
  });
});

describe('servedDaysInMonth', () => {
  it('counts a whole month for an open window that started earlier', () => {
    expect(servedDaysInMonth({ from: '2026-01-01', to: null }, '2026-03')).toBe(
      31,
    );
  });

  it('counts from a mid-month start', () => {
    // 10th to the 31st inclusive.
    expect(servedDaysInMonth({ from: '2026-03-10', to: null }, '2026-03')).toBe(
      22,
    );
  });

  it('counts up to but not including the end', () => {
    expect(
      servedDaysInMonth({ from: '2026-03-01', to: '2026-03-11' }, '2026-03'),
    ).toBe(10);
  });

  it('is zero for a month entirely outside the window', () => {
    expect(servedDaysInMonth({ from: '2026-04-01', to: null }, '2026-03')).toBe(
      0,
    );
    expect(
      servedDaysInMonth({ from: '2026-01-01', to: '2026-02-01' }, '2026-03'),
    ).toBe(0);
  });

  it('handles February in a leap year', () => {
    expect(servedDaysInMonth({ from: '2024-01-01', to: null }, '2024-02')).toBe(
      29,
    );
  });
});

describe('monthlyCharge', () => {
  const fee = 1500;

  it('charges the full fee for a full month', () => {
    const charge = monthlyCharge({
      monthlyFee: fee,
      month: '2026-03',
      window: { from: '2026-01-01', to: null },
      prorate: true,
    });
    expect(charge).toEqual({
      amount: 1500,
      servedDays: 31,
      daysInMonth: 31,
      prorated: false,
    });
  });

  it('prorates a mid-month start by DAYS', () => {
    // 22 of 31 days at ৳1,500 → 1064.516… → 1064.52 to the paisa.
    const charge = monthlyCharge({
      monthlyFee: fee,
      month: '2026-03',
      window: { from: '2026-03-10', to: null },
      prorate: true,
    });
    expect(charge.servedDays).toBe(22);
    expect(charge.amount).toBe(1064.52);
    expect(charge.prorated).toBe(true);
  });

  it('prorates a mid-month end the same way', () => {
    const charge = monthlyCharge({
      monthlyFee: fee,
      month: '2026-03',
      window: { from: '2026-01-01', to: '2026-03-16' },
      prorate: true,
    });
    expect(charge.servedDays).toBe(15);
    expect(charge.amount).toBe(725.81);
  });

  it('charges nothing for a month with no service', () => {
    expect(
      monthlyCharge({
        monthlyFee: fee,
        month: '2026-05',
        window: { from: '2026-01-01', to: '2026-03-16' },
        prorate: true,
      }),
    ).toEqual({ amount: 0, servedDays: 0, daysInMonth: 31, prorated: false });
  });

  it('charges a WHOLE month for any service when proration is off', () => {
    const charge = monthlyCharge({
      monthlyFee: fee,
      month: '2026-03',
      window: { from: '2026-03-29', to: null },
      prorate: false,
    });
    expect(charge.amount).toBe(1500);
    expect(charge.servedDays).toBe(3);
    expect(charge.prorated).toBe(false);
  });

  it('never charges a negative fee', () => {
    expect(
      monthlyCharge({
        monthlyFee: -500,
        month: '2026-03',
        window: { from: '2026-01-01', to: null },
        prorate: true,
      }).amount,
    ).toBe(0);
  });

  it('is zero for a month string that is not a month', () => {
    expect(
      monthlyCharge({
        monthlyFee: fee,
        month: '2026-13',
        window: { from: '2026-01-01', to: null },
        prorate: true,
      }).amount,
    ).toBe(0);
  });

  it('bills a suspend-and-resume in one month from the resume date only', () => {
    // The documented simplification: one row cannot describe two windows,
    // and the school rounds in the rider's favour.
    const window = serviceWindow(
      rider({
        startDate: '2026-03-01',
        suspendedAt: '2026-03-05',
        resumedAt: '2026-03-20',
      }),
    );
    const charge = monthlyCharge({
      monthlyFee: 3100,
      month: '2026-03',
      window,
      prorate: true,
    });
    expect(charge.servedDays).toBe(12); // 20th … 31st
    expect(charge.amount).toBe(1200);
  });
});

describe('chargeDescription', () => {
  it('names the route and the stop', () => {
    expect(
      chargeDescription('Mirpur Morning', 'Kazipara', {
        amount: 1500,
        servedDays: 31,
        daysInMonth: 31,
        prorated: false,
      }),
    ).toBe('Transport — Mirpur Morning (Kazipara)');
  });

  it('says how partial a partial month is', () => {
    expect(
      chargeDescription('Mirpur Morning', 'Kazipara', {
        amount: 1064.52,
        servedDays: 22,
        daysInMonth: 31,
        prorated: true,
      }),
    ).toBe('Transport — Mirpur Morning (Kazipara), 22/31 days');
  });
});

describe('expectedMonthlyRevenue', () => {
  it('sums stop fees to the paisa', () => {
    expect(expectedMonthlyRevenue([1500.55, 800.45, 1200])).toBe(3501);
  });

  it('treats a negative fee as zero rather than a refund', () => {
    expect(expectedMonthlyRevenue([1000, -400])).toBe(1000);
  });

  it('is zero for an empty fleet', () => {
    expect(expectedMonthlyRevenue([])).toBe(0);
  });
});
