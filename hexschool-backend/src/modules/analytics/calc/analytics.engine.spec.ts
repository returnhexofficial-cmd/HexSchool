import {
  agingBuckets,
  average,
  buildHeatmap,
  changePercent,
  densify,
  monthKeysEndingAt,
  percent,
  ratio,
  realization,
  topNWithOther,
  trend,
  yearOverYear,
} from './analytics.engine';

describe('ratio / percent', () => {
  it('returns null rather than Infinity on a zero denominator', () => {
    expect(ratio(5, 0)).toBeNull();
    expect(percent(5, 0)).toBeNull();
  });

  it('rounds a percentage to two places', () => {
    expect(percent(1, 3)).toBe(33.33);
    expect(percent(2, 3)).toBe(66.67);
  });

  it('guards against NaN inputs', () => {
    expect(ratio(Number.NaN, 3)).toBeNull();
  });
});

describe('changePercent', () => {
  it('is null when the baseline is zero — not infinite growth', () => {
    expect(changePercent(1200, 0)).toBeNull();
  });

  it('reports a rise and a fall', () => {
    expect(changePercent(120, 100)).toBe(20);
    expect(changePercent(80, 100)).toBe(-20);
  });

  it('uses the magnitude of a negative baseline', () => {
    expect(changePercent(-50, -100)).toBe(50);
  });
});

describe('monthKeysEndingAt', () => {
  it('is oldest first and inclusive of the end month', () => {
    expect(monthKeysEndingAt(new Date('2026-03-15T00:00:00Z'), 4)).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
  });
});

describe('densify', () => {
  it('fills a month nothing happened in with zero, not with a gap', () => {
    const points = [
      { key: '2026-01', value: 10 },
      { key: '2026-03', value: 30 },
    ];
    expect(densify(points, ['2026-01', '2026-02', '2026-03'])).toEqual([
      { key: '2026-01', value: 10 },
      { key: '2026-02', value: 0 },
      { key: '2026-03', value: 30 },
    ]);
  });

  it('drops points outside the key list', () => {
    expect(densify([{ key: '2025-11', value: 9 }], ['2026-01'])).toEqual([
      { key: '2026-01', value: 0 },
    ]);
  });
});

describe('yearOverYear', () => {
  it('pairs by month of year, not by array position', () => {
    const current = [
      { key: '2026-04', value: 120 },
      { key: '2026-05', value: 150 },
    ];
    const previous = [
      { key: '2025-03', value: 999 },
      { key: '2025-04', value: 100 },
      { key: '2025-05', value: 200 },
    ];
    expect(yearOverYear(current, previous)).toEqual([
      { key: '2026-04', current: 120, previous: 100, changePct: 20 },
      { key: '2026-05', current: 150, previous: 200, changePct: -25 },
    ]);
  });

  it('treats a missing prior month as zero and reports no change %', () => {
    expect(yearOverYear([{ key: '2026-04', value: 50 }], [])).toEqual([
      { key: '2026-04', current: 50, previous: 0, changePct: null },
    ]);
  });
});

describe('agingBuckets', () => {
  it('puts each boundary day in exactly one bucket', () => {
    const buckets = agingBuckets([
      { daysOverdue: 0, amount: 1 },
      { daysOverdue: 30, amount: 1 },
      { daysOverdue: 31, amount: 1 },
      { daysOverdue: 60, amount: 1 },
      { daysOverdue: 61, amount: 1 },
      { daysOverdue: 90, amount: 1 },
      { daysOverdue: 91, amount: 1 },
      { daysOverdue: 500, amount: 1 },
    ]);
    expect(buckets.map((b) => b.count)).toEqual([2, 2, 2, 2]);
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(8);
  });

  it('sums money to the paisa', () => {
    const buckets = agingBuckets([
      { daysOverdue: 5, amount: 10.005 },
      { daysOverdue: 5, amount: 20.5 },
    ]);
    expect(buckets[0].amount).toBe(30.51);
  });

  it('clamps a negative age into the first bucket', () => {
    // An invoice not yet due is 0 days overdue, never −4.
    const buckets = agingBuckets([{ daysOverdue: -4, amount: 100 }]);
    expect(buckets[0].count).toBe(1);
  });

  it('returns four empty buckets for no items', () => {
    expect(agingBuckets([]).map((b) => b.count)).toEqual([0, 0, 0, 0]);
  });
});

describe('buildHeatmap', () => {
  const rows = ['6-A', '6-B'];
  const columns = ['2026-01', '2026-02'];

  it('leaves a cell with no data null, never zero', () => {
    const map = buildHeatmap(
      [
        { row: '6-A', column: '2026-01', value: 91 },
        { row: '6-A', column: '2026-02', value: 88 },
        { row: '6-B', column: '2026-02', value: 0 },
      ],
      rows,
      columns,
    );
    expect(map.cells).toEqual([
      { row: '6-A', column: '2026-01', value: 91 },
      { row: '6-A', column: '2026-02', value: 88 },
      { row: '6-B', column: '2026-01', value: null },
      { row: '6-B', column: '2026-02', value: 0 },
    ]);
  });

  it('scales min/max over present cells only', () => {
    const map = buildHeatmap(
      [{ row: '6-A', column: '2026-01', value: 91 }],
      rows,
      columns,
    );
    expect(map.min).toBe(91);
    expect(map.max).toBe(91);
  });

  it('has a null scale when nothing was recorded at all', () => {
    const map = buildHeatmap([], rows, columns);
    expect(map.min).toBeNull();
    expect(map.max).toBeNull();
    expect(map.cells).toHaveLength(4);
  });
});

describe('topNWithOther', () => {
  it('folds the tail so the parts still add to the whole', () => {
    const items = [
      { label: 'Tuition', value: 100 },
      { label: 'Transport', value: 60 },
      { label: 'Hostel', value: 30 },
      { label: 'Library', value: 5 },
      { label: 'Lab', value: 5 },
    ];
    const folded = topNWithOther(items, 3);
    expect(folded).toEqual([
      { label: 'Tuition', value: 100 },
      { label: 'Transport', value: 60 },
      { label: 'Hostel', value: 30 },
      { label: 'Other', value: 10 },
    ]);
    expect(folded.reduce((s, i) => s + i.value, 0)).toBe(200);
  });

  it('adds no Other row when everything already fits', () => {
    const items = [{ label: 'Tuition', value: 100 }];
    expect(topNWithOther(items, 3)).toEqual(items);
  });

  it('omits a zero Other row', () => {
    const items = [
      { label: 'a', value: 5 },
      { label: 'b', value: 0 },
    ];
    expect(topNWithOther(items, 1)).toEqual([{ label: 'a', value: 5 }]);
  });

  it('does not mutate its input order', () => {
    const items = [
      { label: 'a', value: 1 },
      { label: 'b', value: 9 },
    ];
    topNWithOther(items, 1);
    expect(items[0].label).toBe('a');
  });
});

describe('realization', () => {
  it('does not clamp recovery above 100 %', () => {
    // Arrears from last term settled this month: genuinely over-collected.
    expect(realization(1000, 1500)).toEqual({
      billed: 1000,
      collected: 1500,
      outstanding: -500,
      rate: 150,
    });
  });

  it('reports no rate when nothing was billed', () => {
    expect(realization(0, 0).rate).toBeNull();
  });
});

describe('average', () => {
  it('is null for an empty set, not zero', () => {
    expect(average([])).toBeNull();
  });

  it('rounds to the requested places', () => {
    expect(average([1, 2, 2])).toBe(1.67);
    expect(average([1, 2, 2], 0)).toBe(2);
  });
});

describe('trend', () => {
  it('needs two points to have a direction', () => {
    expect(trend([])).toBeNull();
    expect(trend([{ key: '2026-01', value: 5 }])).toBeNull();
  });

  it('reads the last two points', () => {
    expect(
      trend([
        { key: '2026-01', value: 100 },
        { key: '2026-02', value: 80 },
        { key: '2026-03', value: 120 },
      ]),
    ).toEqual({ direction: 'up', changePct: 50 });
  });

  it('reports flat without a change figure of its own', () => {
    expect(
      trend([
        { key: '2026-01', value: 10 },
        { key: '2026-02', value: 10 },
      ]),
    ).toEqual({ direction: 'flat', changePct: 0 });
  });
});
