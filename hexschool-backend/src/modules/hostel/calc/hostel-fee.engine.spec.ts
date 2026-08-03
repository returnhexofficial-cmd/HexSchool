import {
  billableHeads,
  monthlyLines,
  type MonthlyLinesInput,
} from './hostel-fee.engine';

const base: MonthlyLinesInput = {
  month: '2026-03',
  hostelName: 'Shapla',
  roomNo: 'A-101',
  roomFee: 3100,
  residency: { from: '2026-01-01', to: null },
  mess: {
    planName: 'Full board',
    monthlyCharge: 3100,
    window: { from: '2026-01-01', to: null },
  },
  mealOffs: [],
  messDayRate: 0,
  prorate: true,
};

describe('monthlyLines', () => {
  it('bills rent and mess as two separate lines', () => {
    const result = monthlyLines(base);
    expect(result.lines.map((l) => l.kind)).toEqual(['RENT', 'MESS']);
    expect(result.total).toBe(6200);
  });

  it('bills rent alone for a boarder on no mess plan', () => {
    const result = monthlyLines({ ...base, mess: null });
    expect(result.lines.map((l) => l.kind)).toEqual(['RENT']);
    expect(result.total).toBe(3100);
  });

  it('prorates both lines against a mid-month arrival', () => {
    const result = monthlyLines({
      ...base,
      residency: { from: '2026-03-11', to: null },
    });
    expect(result.total).toBe(4200);
    expect(result.lines[0].description).toMatch(/21\/31 days/);
    expect(result.lines[1].description).toMatch(/21\/31 days/);
  });

  it('applies roadmap §8 precedence — the residency bounds the mess window', () => {
    // Mess enrolment left open, boarder vacated on the 15th: 14 days of
    // food, not 31.
    const result = monthlyLines({
      ...base,
      residency: { from: '2026-03-01', to: '2026-03-15' },
    });
    const mess = result.lines.find((l) => l.kind === 'MESS');
    expect(mess?.days).toBe(14);
    expect(mess?.amount).toBe(1400);
  });

  it('adds a negative credit line for approved meal-offs', () => {
    const result = monthlyLines({
      ...base,
      mealOffs: [
        { fromDate: '2026-02-10', toDate: '2026-02-15', monthlyCharge: 3100 },
      ],
    });
    // 6 days of February at 3100/28 = 110.71 → 664.26
    const credit = result.lines.find((l) => l.kind === 'MESS_CREDIT');
    expect(credit?.amount).toBeLessThan(0);
    expect(credit?.days).toBe(6);
    expect(result.total).toBe(6200 - 664.26);
  });

  it('caps the credit at this month’s mess charge and floors the total at zero', () => {
    const result = monthlyLines({
      ...base,
      roomFee: 0,
      mealOffs: [
        { fromDate: '2026-02-01', toDate: '2026-02-28', monthlyCharge: 3100 },
        { fromDate: '2026-01-01', toDate: '2026-01-31', monthlyCharge: 3100 },
      ],
    });
    expect(result.credit.capped).toBe(true);
    expect(result.total).toBe(0);
  });

  it('never produces a negative total, however generous the credit', () => {
    const result = monthlyLines({
      ...base,
      messDayRate: 5000,
      mealOffs: [
        { fromDate: '2026-02-10', toDate: '2026-02-20', monthlyCharge: 3100 },
      ],
    });
    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  it('credits nothing for a boarder with no mess charge to credit against', () => {
    const result = monthlyLines({
      ...base,
      mess: null,
      mealOffs: [
        { fromDate: '2026-02-10', toDate: '2026-02-15', monthlyCharge: 3100 },
      ],
    });
    expect(result.lines.find((l) => l.kind === 'MESS_CREDIT')).toBeUndefined();
    expect(result.total).toBe(3100);
  });

  it('produces nothing at all for a month outside the residency', () => {
    const result = monthlyLines({
      ...base,
      residency: { from: '2026-01-01', to: '2026-02-01' },
    });
    expect(result.lines).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('charges whole months on both lines with proration off', () => {
    const result = monthlyLines({
      ...base,
      residency: { from: '2026-03-28', to: null },
      prorate: false,
    });
    expect(result.total).toBe(6200);
    expect(result.lines[0].description).not.toMatch(/days/);
  });
});

describe('billableHeads', () => {
  it('nets the credit into the mess head rather than emitting a third head', () => {
    const heads = billableHeads(
      monthlyLines({
        ...base,
        mealOffs: [
          { fromDate: '2026-02-10', toDate: '2026-02-15', monthlyCharge: 3100 },
        ],
      }),
    );
    expect(heads.map((h) => h.kind)).toEqual(['RENT', 'MESS']);
    expect(heads[1].amount).toBe(3100 - 664.26);
    expect(heads[1].description).toMatch(/less 6 day\(s\) away/);
  });

  it('drops a mess head the credit wiped out entirely', () => {
    const heads = billableHeads(
      monthlyLines({
        ...base,
        mealOffs: [
          { fromDate: '2026-02-01', toDate: '2026-02-28', monthlyCharge: 3100 },
        ],
        messDayRate: 200,
      }),
    );
    expect(heads.map((h) => h.kind)).toEqual(['RENT']);
  });

  it('returns nothing for a boarder with nothing to bill', () => {
    expect(
      billableHeads(
        monthlyLines({
          ...base,
          residency: { from: '2026-01-01', to: '2026-02-01' },
        }),
      ),
    ).toEqual([]);
  });

  it('keeps the two heads independent — rent survives a wiped-out mess', () => {
    const heads = billableHeads(
      monthlyLines({
        ...base,
        mess: {
          planName: 'Lunch only',
          monthlyCharge: 0,
          window: base.residency,
        },
      }),
    );
    expect(heads.map((h) => h.kind)).toEqual(['RENT']);
    expect(heads[0].amount).toBe(3100);
  });
});
