import {
  alertable,
  daysBetween,
  expiryItems,
  expirySummary,
  expiryState,
  pastDateWarnings,
  worstState,
} from './expiry.engine';

const TODAY = '2026-07-31';

describe('daysBetween', () => {
  it('counts whole days forwards and backwards', () => {
    expect(daysBetween('2026-07-31', '2026-08-10')).toBe(10);
    expect(daysBetween('2026-07-31', '2026-07-01')).toBe(-30);
    expect(daysBetween('2026-07-31', '2026-07-31')).toBe(0);
  });

  it('crosses a month and a leap day without drifting', () => {
    expect(daysBetween('2024-02-27', '2024-03-01')).toBe(3);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('is zero for an unparseable date rather than NaN', () => {
    expect(daysBetween('yesterday', '2026-07-31')).toBe(0);
  });
});

describe('expiryState', () => {
  it('is OK well beyond the window', () => {
    expect(expiryState('2026-12-31', TODAY, 30)).toEqual({
      state: 'OK',
      daysLeft: 153,
    });
  });

  it('is DUE_SOON inside the window, including on the last day of it', () => {
    expect(expiryState('2026-08-30', TODAY, 30).state).toBe('DUE_SOON');
    expect(expiryState('2026-08-31', TODAY, 30).state).toBe('OK');
  });

  it('is still valid ON the expiry day', () => {
    expect(expiryState(TODAY, TODAY, 30)).toEqual({
      state: 'DUE_SOON',
      daysLeft: 0,
    });
  });

  it('is EXPIRED the day after', () => {
    expect(expiryState('2026-07-30', TODAY, 30)).toEqual({
      state: 'EXPIRED',
      daysLeft: -1,
    });
  });

  it('treats a missing or malformed date as UNKNOWN, never as valid', () => {
    expect(expiryState(null, TODAY, 30).state).toBe('UNKNOWN');
    expect(expiryState(undefined, TODAY, 30).state).toBe('UNKNOWN');
    expect(expiryState('', TODAY, 30).state).toBe('UNKNOWN');
    expect(expiryState('31/07/2026', TODAY, 30).state).toBe('UNKNOWN');
  });
});

describe('expiryItems', () => {
  const documents = [
    { kind: 'FITNESS' as const, expiry: '2026-12-01' },
    { kind: 'TAX_TOKEN' as const, expiry: '2026-08-10' },
    { kind: 'INSURANCE' as const, expiry: '2026-07-01' },
    { kind: 'LICENSE' as const, expiry: null },
  ];

  it('sorts expired first, then due-soon, then unknown, then fine', () => {
    const items = expiryItems(documents, TODAY, 30);
    expect(items.map((item) => item.state)).toEqual([
      'EXPIRED',
      'DUE_SOON',
      'UNKNOWN',
      'OK',
    ]);
  });

  it('labels each document the way the alert prints it', () => {
    const items = expiryItems(documents, TODAY, 30);
    expect(items[0]).toMatchObject({
      kind: 'INSURANCE',
      label: 'Insurance',
      daysLeft: -30,
    });
  });

  it('sorts two expired papers with the older one first', () => {
    const items = expiryItems(
      [
        { kind: 'FITNESS', expiry: '2026-07-30' },
        { kind: 'INSURANCE', expiry: '2026-01-01' },
      ],
      TODAY,
      30,
    );
    expect(items.map((item) => item.kind)).toEqual(['INSURANCE', 'FITNESS']);
  });

  it('nulls out a malformed date instead of echoing it', () => {
    const items = expiryItems([{ kind: 'FITNESS', expiry: 'soon' }], TODAY, 30);
    expect(items[0].expiry).toBeNull();
  });
});

describe('alertable / worstState', () => {
  const items = expiryItems(
    [
      { kind: 'FITNESS', expiry: '2026-12-01' },
      { kind: 'TAX_TOKEN', expiry: '2026-08-10' },
      { kind: 'LICENSE', expiry: null },
    ],
    TODAY,
    30,
  );

  it('keeps everything that is not OK — a missing paper is an alert', () => {
    expect(
      alertable(items)
        .map((item) => item.kind)
        .sort(),
    ).toEqual(['LICENSE', 'TAX_TOKEN']);
  });

  it('ranks a known imminent expiry above a missing date', () => {
    expect(worstState(items)).toBe('DUE_SOON');
  });

  it('ranks an expired paper worst of all', () => {
    expect(
      worstState(
        expiryItems([{ kind: 'FITNESS', expiry: '2020-01-01' }], TODAY, 30),
      ),
    ).toBe('EXPIRED');
  });

  it('is OK when every paper is current', () => {
    expect(
      worstState(
        expiryItems([{ kind: 'FITNESS', expiry: '2030-01-01' }], TODAY, 30),
      ),
    ).toBe('OK');
  });
});

describe('expirySummary', () => {
  it('says nothing is wrong when nothing is', () => {
    expect(
      expirySummary(
        'DHAKA METRO GA 11-2345',
        expiryItems([{ kind: 'FITNESS', expiry: '2030-01-01' }], TODAY, 30),
      ),
    ).toBe('DHAKA METRO GA 11-2345: all documents are current.');
  });

  it('names every problem in one sentence', () => {
    const summary = expirySummary(
      'DHAKA METRO GA 11-2345',
      expiryItems(
        [
          { kind: 'INSURANCE', expiry: '2026-07-01' },
          { kind: 'TAX_TOKEN', expiry: '2026-08-10' },
          { kind: 'FITNESS', expiry: null },
        ],
        TODAY,
        30,
      ),
    );
    expect(summary).toContain('Insurance expired 30 day(s) ago');
    expect(summary).toContain('Tax token expires in 10 day(s)');
    expect(summary).toContain('Fitness certificate not recorded');
  });
});

describe('pastDateWarnings', () => {
  it('warns rather than refuses when a paper is already expired', () => {
    expect(
      pastDateWarnings([{ kind: 'FITNESS', expiry: '2026-06-30' }], TODAY),
    ).toEqual(['Fitness certificate expired 31 day(s) ago (2026-06-30).']);
  });

  it('says nothing about a current or a missing date', () => {
    expect(
      pastDateWarnings(
        [
          { kind: 'FITNESS', expiry: '2027-01-01' },
          { kind: 'LICENSE', expiry: null },
        ],
        TODAY,
      ),
    ).toEqual([]);
  });
});
