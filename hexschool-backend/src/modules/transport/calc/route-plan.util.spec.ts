import {
  formatClock,
  nextDisplayOrder,
  normalizeRegNo,
  parseClock,
  reorderPlan,
  routeWindow,
  stopSequenceIssues,
  type PlannedStop,
} from './route-plan.util';

const stop = (over: Partial<PlannedStop> & { id: string }): PlannedStop => ({
  name: over.id,
  displayOrder: 0,
  ...over,
});

describe('normalizeRegNo', () => {
  it('upper-cases and collapses the spacing a plate is typed with', () => {
    expect(normalizeRegNo('  dhaka   metro ga 11-2345 ')).toBe(
      'DHAKA METRO GA 11-2345',
    );
  });

  it('makes two typings of one plate compare equal', () => {
    expect(normalizeRegNo('Dhaka Metro Ga 11-2345')).toBe(
      normalizeRegNo('DHAKA  METRO  GA  11-2345'),
    );
  });
});

describe('parseClock / formatClock', () => {
  it('parses HH:MM to minutes since midnight', () => {
    expect(parseClock('07:10')).toBe(430);
    expect(parseClock('7:05')).toBe(425);
    expect(parseClock('00:00')).toBe(0);
    expect(parseClock('23:59')).toBe(1439);
  });

  it('refuses an impossible or malformed time', () => {
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('07:60')).toBeNull();
    expect(parseClock('7am')).toBeNull();
    expect(parseClock(null)).toBeNull();
    expect(parseClock(undefined)).toBeNull();
  });

  it('round-trips', () => {
    expect(formatClock(parseClock('07:10'))).toBe('07:10');
    expect(formatClock(430)).toBe('07:10');
    expect(formatClock(null)).toBeNull();
  });
});

describe('reorderPlan', () => {
  const stops = [
    stop({ id: 'a', displayOrder: 0 }),
    stop({ id: 'b', displayOrder: 1 }),
    stop({ id: 'c', displayOrder: 2 }),
  ];

  it('parks every row out of the way before writing the real order', () => {
    const plan = reorderPlan(['c', 'a', 'b'], stops);
    expect(plan.apply).toEqual([
      { stopId: 'c', displayOrder: 0 },
      { stopId: 'a', displayOrder: 1 },
      { stopId: 'b', displayOrder: 2 },
    ]);
    // Every parked position is above every position the route can hold,
    // so pass 1 can never collide with a row pass 2 has not moved yet.
    const parked = plan.park.map((step) => step.displayOrder);
    expect(Math.min(...parked)).toBeGreaterThan(stops.length);
    expect(new Set(parked).size).toBe(parked.length);
  });

  it('parks in the FINAL order, so pass 2 only lowers numbers', () => {
    const plan = reorderPlan(['c', 'a', 'b'], stops);
    expect(plan.park.map((step) => step.stopId)).toEqual(['c', 'a', 'b']);
  });

  it('keeps stops the caller did not mention, after the ones it did', () => {
    const plan = reorderPlan(['c'], stops);
    expect(plan.apply).toEqual([
      { stopId: 'c', displayOrder: 0 },
      { stopId: 'a', displayOrder: 1 },
      { stopId: 'b', displayOrder: 2 },
    ]);
  });

  it('ignores an id that is not on this route', () => {
    const plan = reorderPlan(['ghost', 'b'], stops);
    expect(plan.apply.map((step) => step.stopId)).toEqual(['b', 'a', 'c']);
  });

  it('compacts a sparse order to 0…N', () => {
    const sparse = [
      stop({ id: 'a', displayOrder: 5 }),
      stop({ id: 'b', displayOrder: 9 }),
    ];
    expect(reorderPlan(['a', 'b'], sparse).apply).toEqual([
      { stopId: 'a', displayOrder: 0 },
      { stopId: 'b', displayOrder: 1 },
    ]);
  });

  it('produces no work for an empty route', () => {
    expect(reorderPlan([], [])).toEqual({ park: [], apply: [] });
  });
});

describe('nextDisplayOrder', () => {
  it('appends after the highest position, not after the count', () => {
    expect(
      nextDisplayOrder([
        stop({ id: 'a', displayOrder: 0 }),
        stop({ id: 'b', displayOrder: 7 }),
      ]),
    ).toBe(8);
  });

  it('starts at zero on an empty route', () => {
    expect(nextDisplayOrder([])).toBe(0);
  });
});

describe('stopSequenceIssues', () => {
  it('says nothing about a route whose times run down the road', () => {
    expect(
      stopSequenceIssues([
        stop({
          id: 'a',
          displayOrder: 0,
          pickupTime: '06:50',
          dropTime: '16:40',
        }),
        stop({
          id: 'b',
          displayOrder: 1,
          pickupTime: '07:10',
          dropTime: '16:20',
        }),
        stop({
          id: 'c',
          displayOrder: 2,
          pickupTime: '07:30',
          dropTime: '16:00',
        }),
      ]),
    ).toEqual([]);
  });

  it('flags a pickup that goes backwards down the sequence', () => {
    const issues = stopSequenceIssues([
      stop({ id: 'a', displayOrder: 0, pickupTime: '07:10' }),
      stop({ id: 'b', displayOrder: 1, pickupTime: '06:50' }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].stopId).toBe('b');
    expect(issues[0].message).toContain('earlier than the previous stop');
  });

  it('flags a drop sequence running the wrong way', () => {
    const issues = stopSequenceIssues([
      stop({ id: 'a', displayOrder: 0, dropTime: '16:00' }),
      stop({ id: 'b', displayOrder: 1, dropTime: '16:30' }),
    ]);
    expect(issues[0].message).toContain('reverses the morning order');
  });

  it('flags a stop dropped before it is picked up', () => {
    const issues = stopSequenceIssues([
      stop({
        id: 'a',
        displayOrder: 0,
        pickupTime: '07:10',
        dropTime: '06:00',
      }),
    ]);
    expect(issues[0].message).toContain('not after pickup');
  });

  it('reads the sequence by display order, not by array order', () => {
    const issues = stopSequenceIssues([
      stop({ id: 'b', displayOrder: 1, pickupTime: '07:10' }),
      stop({ id: 'a', displayOrder: 0, pickupTime: '06:50' }),
    ]);
    expect(issues).toEqual([]);
  });

  it('ignores stops with no times at all', () => {
    expect(
      stopSequenceIssues([
        stop({ id: 'a' }),
        stop({ id: 'b', displayOrder: 1 }),
      ]),
    ).toEqual([]);
  });
});

describe('routeWindow', () => {
  it('spans the first pickup to the last drop', () => {
    expect(
      routeWindow([
        stop({
          id: 'a',
          displayOrder: 0,
          pickupTime: '06:50',
          dropTime: '16:40',
        }),
        stop({
          id: 'b',
          displayOrder: 1,
          pickupTime: '07:30',
          dropTime: '16:00',
        }),
      ]),
    ).toEqual({ firstPickup: '06:50', lastDrop: '16:40' });
  });

  it('is null rather than midnight when no stop carries a time', () => {
    expect(routeWindow([stop({ id: 'a' })])).toEqual({
      firstPickup: null,
      lastDrop: null,
    });
  });
});
