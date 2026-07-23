import { dedupeKey, mergeByDestination } from './dedupe.util';

describe('dedupe key', () => {
  const WINDOW = 120; // minutes
  const t0 = Date.UTC(2026, 6, 23, 10, 0, 0);

  it('is stable for the same destination/template inside a window', () => {
    const a = dedupeKey('01710000000', 'ABSENT_ALERT', WINDOW, t0);
    const b = dedupeKey(
      '01710000000',
      'ABSENT_ALERT',
      WINDOW,
      t0 + 60 * 60_000,
    );
    expect(a).toBe(b);
  });

  it('differs once the window bucket rolls over', () => {
    const a = dedupeKey('01710000000', 'ABSENT_ALERT', WINDOW, t0);
    const c = dedupeKey(
      '01710000000',
      'ABSENT_ALERT',
      WINDOW,
      t0 + 3 * 60 * 60_000,
    );
    expect(a).not.toBe(c);
  });

  it('differs by destination and by template', () => {
    expect(dedupeKey('01710000000', 'A', WINDOW, t0)).not.toBe(
      dedupeKey('01720000000', 'A', WINDOW, t0),
    );
    expect(dedupeKey('01710000000', 'A', WINDOW, t0)).not.toBe(
      dedupeKey('01710000000', 'B', WINDOW, t0),
    );
  });
});

describe('mergeByDestination', () => {
  it('collapses two absent siblings into one guardian SMS', () => {
    const merged = mergeByDestination(
      [
        {
          destination: '01710000000',
          templateCode: 'ABSENT_ALERT',
          vars: { student_name: 'Karim', date: '2026-07-23' },
          ref: 'row-1',
        },
        {
          destination: '01710000000',
          templateCode: 'ABSENT_ALERT',
          vars: { student_name: 'Rahim', date: '2026-07-23' },
          ref: 'row-2',
        },
      ],
      ['student_name'],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].vars.student_name).toBe('Karim, Rahim');
    expect(merged[0].vars.date).toBe('2026-07-23');
    expect(merged[0].refs).toEqual(['row-1', 'row-2']);
    expect(merged[0].count).toBe(2);
  });

  it('keeps distinct destinations separate', () => {
    const merged = mergeByDestination(
      [
        { destination: 'A', templateCode: 'T', vars: {}, ref: 1 },
        { destination: 'B', templateCode: 'T', vars: {}, ref: 2 },
      ],
      [],
    );
    expect(merged).toHaveLength(2);
  });

  it('does not merge across templates to the same number', () => {
    const merged = mergeByDestination(
      [
        { destination: 'A', templateCode: 'ABSENT', vars: {}, ref: 1 },
        { destination: 'A', templateCode: 'RESULT', vars: {}, ref: 2 },
      ],
      [],
    );
    expect(merged).toHaveLength(2);
  });
});
