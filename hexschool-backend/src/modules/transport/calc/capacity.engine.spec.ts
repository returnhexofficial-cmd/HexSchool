import {
  capacityStatus,
  capacityVerdict,
  fleetUtilization,
  stopLoads,
} from './capacity.engine';

describe('capacityStatus', () => {
  it('reports the seats left on a route with room', () => {
    const status = capacityStatus({ capacity: 40, assigned: 30 });
    expect(status.state).toBe('SPACE');
    expect(status.seatsLeft).toBe(10);
    expect(status.utilization).toBe(75);
    expect(status.message).toBeNull();
  });

  it('calls an exactly-filled bus FULL, not OVER', () => {
    const status = capacityStatus({ capacity: 40, assigned: 40 });
    expect(status.state).toBe('FULL');
    expect(status.seatsLeft).toBe(0);
    expect(status.utilization).toBe(100);
  });

  it('counts the incoming riders when deciding', () => {
    expect(
      capacityStatus({ capacity: 40, assigned: 39, incoming: 1 }).state,
    ).toBe('FULL');
    expect(
      capacityStatus({ capacity: 40, assigned: 39, incoming: 2 }).state,
    ).toBe('OVER');
  });

  it('says by how much a route is over', () => {
    const status = capacityStatus({ capacity: 40, assigned: 43 });
    expect(status.state).toBe('OVER');
    expect(status.message).toContain('3 over capacity');
    // Seats left never goes negative — "−3 seats left" is not a thing a
    // UI can render sensibly.
    expect(status.seatsLeft).toBe(0);
  });

  it('reports UNKNOWN rather than zero when no vehicle is attached', () => {
    const status = capacityStatus({ capacity: null, assigned: 12 });
    expect(status.state).toBe('UNKNOWN');
    expect(status.seatsLeft).toBeNull();
    expect(status.utilization).toBeNull();
    expect(status.message).toContain('no vehicle');
  });

  it('never reports a negative assignment count', () => {
    expect(capacityStatus({ capacity: 40, assigned: -5 }).assigned).toBe(0);
  });

  it('rounds utilization to one decimal', () => {
    expect(capacityStatus({ capacity: 30, assigned: 7 }).utilization).toBe(
      23.3,
    );
  });
});

describe('capacityVerdict', () => {
  it('allows an assignment with room, silently', () => {
    const verdict = capacityVerdict({
      capacity: 40,
      assigned: 10,
      incoming: 1,
      hardBlock: true,
    });
    expect(verdict).toMatchObject({ allowed: true, warn: false, reason: null });
  });

  it('WARNS over capacity by default (roadmap §6)', () => {
    const verdict = capacityVerdict({
      capacity: 40,
      assigned: 40,
      incoming: 1,
      hardBlock: false,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.warn).toBe(true);
    expect(verdict.reason).toContain('over capacity');
  });

  it('refuses over capacity when the school turned the hard block on', () => {
    const verdict = capacityVerdict({
      capacity: 40,
      assigned: 40,
      incoming: 1,
      hardBlock: true,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.overridePermission).toBe('transport.assign.override');
  });

  it('lets the override push past the hard block, still warning', () => {
    const verdict = capacityVerdict({
      capacity: 40,
      assigned: 41,
      incoming: 1,
      hardBlock: true,
      override: true,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.warn).toBe(true);
  });

  it('never blocks on a route whose capacity is unknown', () => {
    const verdict = capacityVerdict({
      capacity: null,
      assigned: 99,
      incoming: 1,
      hardBlock: true,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.warn).toBe(false);
  });
});

describe('stopLoads', () => {
  const stops = [
    { id: 's1', name: 'Kazipara', displayOrder: 0 },
    { id: 's2', name: 'Shewrapara', displayOrder: 1 },
    { id: 's3', name: 'Agargaon', displayOrder: 2 },
  ];

  it('sorts busiest first', () => {
    const loads = stopLoads(
      stops,
      new Map([
        ['s1', 4],
        ['s2', 9],
        ['s3', 1],
      ]),
    );
    expect(loads.map((load) => load.stopName)).toEqual([
      'Shewrapara',
      'Kazipara',
      'Agargaon',
    ]);
  });

  it('breaks ties on the route order, so the sheet reads down the road', () => {
    const loads = stopLoads(
      stops,
      new Map([
        ['s1', 3],
        ['s2', 3],
        ['s3', 3],
      ]),
    );
    expect(loads.map((load) => load.stopId)).toEqual(['s1', 's2', 's3']);
  });

  it('reports a stop nobody boards at as zero rather than dropping it', () => {
    const loads = stopLoads(stops, new Map([['s1', 2]]));
    expect(loads).toHaveLength(3);
    expect(loads.at(-1)).toMatchObject({ stopId: 's3', riders: 0 });
  });
});

describe('fleetUtilization', () => {
  it('averages over the routes whose capacity is known', () => {
    const result = fleetUtilization([
      { capacity: 40, assigned: 30 },
      { capacity: 20, assigned: 10 },
      { capacity: null, assigned: 5 },
    ]);
    expect(result.routes).toBe(3);
    expect(result.measurable).toBe(2);
    expect(result.seats).toBe(60);
    expect(result.riders).toBe(40);
    expect(result.utilization).toBe(66.7);
  });

  it('does not let an unequipped route drag the percentage down', () => {
    const withoutRoute = fleetUtilization([{ capacity: 40, assigned: 40 }]);
    const withRoute = fleetUtilization([
      { capacity: 40, assigned: 40 },
      { capacity: null, assigned: 0 },
    ]);
    expect(withRoute.utilization).toBe(withoutRoute.utilization);
  });

  it('counts the routes that are over capacity', () => {
    const result = fleetUtilization([
      { capacity: 40, assigned: 41 },
      { capacity: 30, assigned: 31 },
      { capacity: 30, assigned: 10 },
    ]);
    expect(result.overCapacity).toBe(2);
  });

  it('is null rather than NaN for an empty fleet', () => {
    expect(fleetUtilization([]).utilization).toBeNull();
  });
});
