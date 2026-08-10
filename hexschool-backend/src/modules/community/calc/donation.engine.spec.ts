import {
  byMethod,
  byMonth,
  byPurpose,
  donationAmountRefusal,
  donationTotals,
  isLive,
  postsToCash,
  topDonors,
  type DonationRecord,
} from './donation.engine';

function donation(over: Partial<DonationRecord> = {}): DonationRecord {
  return {
    id: 'd1',
    amount: 1000,
    purpose: 'Library fund',
    method: 'CASH',
    receivedAt: new Date('2026-08-09T10:00:00.000Z'),
    donorName: 'Farhana Akter',
    alumniId: null,
    cancelledAt: null,
    ...over,
  };
}

describe('donation.engine — what a donation must be (roadmap §7)', () => {
  it('accepts a positive amount', () => {
    expect(donationAmountRefusal(500)).toBeNull();
    expect(donationAmountRefusal(0.01)).toBeNull();
  });

  it('refuses zero — it would print a receipt saying nothing was received', () => {
    expect(donationAmountRefusal(0)).toContain('more than zero');
  });

  it('refuses a negative amount and a non-number', () => {
    expect(donationAmountRefusal(-100)).toContain('more than zero');
    expect(donationAmountRefusal(Number.NaN)).toContain('Enter a donation');
  });

  it('refuses an amount that rounds to nothing at the paisa', () => {
    expect(donationAmountRefusal(0.004)).toContain('more than zero');
  });

  it('never posts a gift in kind to the cash account', () => {
    expect(postsToCash('IN_KIND')).toBe(false);
    for (const method of [
      'CASH',
      'BANK_TRANSFER',
      'CHEQUE',
      'MOBILE_BANKING',
      'OTHER',
    ] as const) {
      expect(postsToCash(method)).toBe(true);
    }
  });
});

describe('donation.engine — a cancelled receipt stays in the register', () => {
  const rows = [
    donation({ id: 'a', amount: 5000 }),
    donation({ id: 'b', amount: 2500 }),
    donation({
      id: 'c',
      amount: 100000,
      cancelledAt: new Date('2026-08-09T12:00:00.000Z'),
    }),
  ];

  it('is visible in the count and excluded from the money', () => {
    const totals = donationTotals(rows);
    expect(totals.count).toBe(3);
    expect(totals.received).toBe(2);
    expect(totals.total).toBe(7500);
    expect(totals.cancelled).toBe(1);
    expect(totals.cancelledAmount).toBe(100000);
  });

  it('does not distort the largest gift or the average', () => {
    const totals = donationTotals(rows);
    expect(totals.largest).toBe(5000);
    expect(totals.average).toBe(3750);
  });

  it('is dropped from every breakdown', () => {
    expect(byPurpose(rows).reduce((sum, g) => sum + g.amount, 0)).toBe(7500);
    expect(byMethod(rows).reduce((sum, g) => sum + g.amount, 0)).toBe(7500);
    expect(topDonors(rows).reduce((sum, d) => sum + d.amount, 0)).toBe(7500);
  });

  it('marks the row itself', () => {
    expect(isLive(rows[0])).toBe(true);
    expect(isLive(rows[2])).toBe(false);
  });

  it('returns zeroes rather than NaN for an empty register', () => {
    expect(donationTotals([])).toEqual({
      count: 0,
      received: 0,
      total: 0,
      cancelled: 0,
      cancelledAmount: 0,
      fromAlumni: 0,
      fromAlumniAmount: 0,
      largest: 0,
      average: 0,
    });
  });
});

describe('donation.engine — the breakdowns', () => {
  const rows = [
    donation({
      id: 'a',
      amount: 5000,
      purpose: 'Library fund',
      method: 'CASH',
    }),
    donation({
      id: 'b',
      amount: 3000,
      purpose: 'Library fund',
      method: 'BANK_TRANSFER',
    }),
    donation({ id: 'c', amount: 2000, purpose: null, method: 'CASH' }),
  ];

  it('groups by purpose, largest first, with shares that sum to 100', () => {
    const groups = byPurpose(rows);
    expect(groups.map((g) => [g.label, g.amount, g.percent])).toEqual([
      ['Library fund', 8000, 80],
      ['Unspecified', 2000, 20],
    ]);
    expect(groups.reduce((sum, g) => sum + g.percent, 0)).toBe(100);
  });

  it('folds a blank purpose in with a missing one', () => {
    const groups = byPurpose([
      donation({ id: 'a', purpose: null, amount: 100 }),
      donation({ id: 'b', purpose: '   ', amount: 100 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Unspecified');
    expect(groups[0].count).toBe(2);
  });

  it('groups by method', () => {
    expect(byMethod(rows).map((g) => [g.key, g.amount])).toEqual([
      ['CASH', 7000],
      ['BANK_TRANSFER', 3000],
    ]);
  });

  it('orders months chronologically and omits the empty ones', () => {
    const months = byMonth([
      donation({
        id: 'a',
        receivedAt: new Date('2026-03-04T00:00:00.000Z'),
        amount: 100,
      }),
      donation({
        id: 'b',
        receivedAt: new Date('2026-01-31T00:00:00.000Z'),
        amount: 200,
      }),
      donation({
        id: 'c',
        receivedAt: new Date('2026-03-28T00:00:00.000Z'),
        amount: 300,
      }),
    ]);
    expect(months.map((m) => [m.key, m.amount, m.count])).toEqual([
      ['2026-01', 200, 1],
      ['2026-03', 400, 2],
    ]);
  });
});

describe('donation.engine — top donors', () => {
  it('folds two gifts from the same alumnus into one donor', () => {
    const donors = topDonors([
      donation({
        id: 'a',
        alumniId: 'al1',
        donorName: 'Farhana Akter',
        amount: 5000,
      }),
      donation({
        id: 'b',
        alumniId: 'al1',
        donorName: 'F. Akter',
        amount: 3000,
      }),
    ]);
    expect(donors).toHaveLength(1);
    expect(donors[0].amount).toBe(8000);
    expect(donors[0].count).toBe(2);
  });

  it('groups an unlinked donor by name, case-insensitively', () => {
    const donors = topDonors([
      donation({ id: 'a', donorName: 'Karim Traders', amount: 1000 }),
      donation({ id: 'b', donorName: 'karim traders', amount: 2000 }),
    ]);
    expect(donors).toHaveLength(1);
    expect(donors[0].amount).toBe(3000);
  });

  it('keeps an alumnus and a same-named stranger apart', () => {
    const donors = topDonors([
      donation({
        id: 'a',
        alumniId: 'al1',
        donorName: 'Abdul Karim',
        amount: 1000,
      }),
      donation({
        id: 'b',
        alumniId: null,
        donorName: 'Abdul Karim',
        amount: 2000,
      }),
    ]);
    expect(donors).toHaveLength(2);
  });

  it('ranks by amount and truncates', () => {
    const rows = [1000, 9000, 5000].map((amount, i) =>
      donation({ id: `d${i}`, donorName: `Donor ${i}`, amount }),
    );
    expect(topDonors(rows, 2).map((d) => d.amount)).toEqual([9000, 5000]);
  });

  it('counts alumni giving separately from the rest', () => {
    const totals = donationTotals([
      donation({ id: 'a', alumniId: 'al1', amount: 5000 }),
      donation({ id: 'b', alumniId: null, amount: 3000 }),
    ]);
    expect(totals.fromAlumni).toBe(1);
    expect(totals.fromAlumniAmount).toBe(5000);
    expect(totals.total).toBe(8000);
  });
});
