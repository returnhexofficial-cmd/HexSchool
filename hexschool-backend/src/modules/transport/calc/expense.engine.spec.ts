import {
  distanceCovered,
  monthlySeries,
  monthsBetween,
  summarizeExpenses,
  type ExpenseRow,
} from './expense.engine';

const row = (over: Partial<ExpenseRow> = {}): ExpenseRow => ({
  date: '2026-03-01',
  type: 'FUEL',
  amount: 5000,
  odometer: null,
  ...over,
});

describe('distanceCovered', () => {
  it('sums the gaps between consecutive readings, not max minus min of everything', () => {
    const result = distanceCovered([
      row({ date: '2026-03-01', odometer: 10_000 }),
      row({ date: '2026-03-10', odometer: 10_400 }),
      row({ date: '2026-03-20', odometer: 11_000 }),
    ]);
    expect(result).toEqual({ km: 1000, readings: 3, brokenChains: 0 });
  });

  it('ignores rows with no reading', () => {
    const result = distanceCovered([
      row({ date: '2026-03-01', odometer: 10_000 }),
      row({ date: '2026-03-05', type: 'TOLL', amount: 200, odometer: null }),
      row({ date: '2026-03-10', odometer: 10_400 }),
    ]);
    expect(result.km).toBe(400);
    expect(result.readings).toBe(2);
  });

  it('breaks the chain on a reading that goes backwards rather than going negative', () => {
    const result = distanceCovered([
      row({ date: '2026-03-01', odometer: 10_000 }),
      row({ date: '2026-03-10', odometer: 9_000 }), // typo or a replaced meter
      row({ date: '2026-03-20', odometer: 9_500 }),
    ]);
    expect(result.km).toBe(500);
    expect(result.brokenChains).toBe(1);
  });

  it('orders two readings on the same day by the odometer', () => {
    const result = distanceCovered([
      row({ date: '2026-03-01', odometer: 10_200 }),
      row({ date: '2026-03-01', odometer: 10_000 }),
    ]);
    expect(result.km).toBe(200);
    expect(result.brokenChains).toBe(0);
  });

  it('is zero from a single reading — one reading is a moment, not a distance', () => {
    expect(distanceCovered([row({ odometer: 10_000 })]).km).toBe(0);
  });
});

describe('summarizeExpenses', () => {
  const rows: ExpenseRow[] = [
    row({ date: '2026-03-01', type: 'FUEL', amount: 6000, odometer: 10_000 }),
    row({ date: '2026-03-15', type: 'FUEL', amount: 6000, odometer: 11_000 }),
    row({ date: '2026-03-20', type: 'REPAIR', amount: 8000, odometer: null }),
    row({ date: '2026-03-22', type: 'TOLL', amount: 500, odometer: null }),
  ];

  it('totals everything and splits it by type', () => {
    const summary = summarizeExpenses(rows);
    expect(summary.total).toBe(20_500);
    expect(summary.count).toBe(4);
    expect(summary.byType.find((t) => t.type === 'FUEL')).toMatchObject({
      total: 12_000,
      count: 2,
      share: 58.5,
    });
  });

  it('omits types nothing was spent on', () => {
    expect(summarizeExpenses(rows).byType.map((entry) => entry.type)).toEqual([
      'FUEL',
      'REPAIR',
      'TOLL',
    ]);
  });

  it('computes fuel cost per km over the fuel spend only', () => {
    const summary = summarizeExpenses(rows);
    expect(summary.distance.km).toBe(1000);
    expect(summary.fuelCostPerKm).toBe(12);
    expect(summary.totalCostPerKm).toBe(20.5);
  });

  it('refuses to invent a per-km figure from one reading', () => {
    const summary = summarizeExpenses([
      row({ amount: 6000, odometer: 10_000 }),
      row({ date: '2026-03-15', amount: 6000, odometer: null }),
    ]);
    expect(summary.fuelCostPerKm).toBeNull();
    expect(summary.totalCostPerKm).toBeNull();
  });

  it('refuses to divide by a zero distance', () => {
    const summary = summarizeExpenses([
      row({ date: '2026-03-01', amount: 6000, odometer: 10_000 }),
      row({ date: '2026-03-02', amount: 6000, odometer: 10_000 }),
    ]);
    expect(summary.distance.km).toBe(0);
    expect(summary.fuelCostPerKm).toBeNull();
  });

  it('is all zeroes for a vehicle with no receipts', () => {
    const summary = summarizeExpenses([]);
    expect(summary).toMatchObject({ total: 0, count: 0, fuelTotal: 0 });
    expect(summary.byType).toEqual([]);
  });
});

describe('monthlySeries', () => {
  const rows: ExpenseRow[] = [
    row({ date: '2026-01-05', type: 'FUEL', amount: 5000 }),
    row({ date: '2026-01-20', type: 'REPAIR', amount: 3000 }),
    row({ date: '2026-03-02', type: 'FUEL', amount: 4000 }),
  ];

  it('buckets by month with fuel called out', () => {
    const series = monthlySeries(rows);
    expect(series).toEqual([
      { month: '2026-01', total: 8000, fuel: 5000, count: 2 },
      { month: '2026-03', total: 4000, fuel: 4000, count: 1 },
    ]);
  });

  it('emits a spend-nothing month as ZERO when a range is given', () => {
    const series = monthlySeries(rows, {
      from: '2026-01-01',
      to: '2026-03-31',
    });
    expect(series.map((point) => point.month)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
    expect(series[1]).toEqual({
      month: '2026-02',
      total: 0,
      fuel: 0,
      count: 0,
    });
  });

  it('sorts chronologically whatever order the rows arrived in', () => {
    const series = monthlySeries([...rows].reverse());
    expect(series.map((point) => point.month)).toEqual(['2026-01', '2026-03']);
  });

  it('skips a row whose date is not a date', () => {
    expect(monthlySeries([row({ date: 'March' })])).toEqual([]);
  });
});

describe('monthsBetween', () => {
  it('is inclusive at both ends and crosses a year', () => {
    expect(monthsBetween('2025-11-01', '2026-02-28')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('is one month when both bounds are in it', () => {
    expect(monthsBetween('2026-03-01', '2026-03-31')).toEqual(['2026-03']);
  });

  it('is empty for a backwards or malformed range', () => {
    expect(monthsBetween('2026-05-01', '2026-01-01')).toEqual([]);
    expect(monthsBetween('nonsense', '2026-01-01')).toEqual([]);
  });
});
