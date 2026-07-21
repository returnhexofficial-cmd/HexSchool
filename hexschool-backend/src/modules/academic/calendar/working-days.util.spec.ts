import { workingDaysBetween } from './working-days.util';

describe('workingDaysBetween', () => {
  const d = (value: string) => new Date(value);

  it('excludes the configured weekly off-day', () => {
    // 2026-07-20 (Mon) → 2026-07-26 (Sun); Friday is the 24th.
    const days = workingDaysBetween(
      d('2026-07-20'),
      d('2026-07-26'),
      ['FRIDAY'],
      [],
    );
    expect(days).toHaveLength(6);
    expect(days).not.toContain('2026-07-24');
  });

  it('supports a two-day weekend', () => {
    const days = workingDaysBetween(
      d('2026-07-20'),
      d('2026-07-26'),
      ['friday', 'saturday'],
      [],
    );
    expect(days).toHaveLength(5);
  });

  it('excludes holiday ranges, inclusive of both ends', () => {
    const days = workingDaysBetween(
      d('2026-07-20'),
      d('2026-07-26'),
      [],
      [{ startDate: d('2026-07-21'), endDate: d('2026-07-23') }],
    );
    expect(days).toEqual([
      '2026-07-20',
      '2026-07-24',
      '2026-07-25',
      '2026-07-26',
    ]);
  });

  it('does not double-count a holiday that lands on a weekly off-day', () => {
    const days = workingDaysBetween(
      d('2026-07-20'),
      d('2026-07-26'),
      ['FRIDAY'],
      [{ startDate: d('2026-07-24'), endDate: d('2026-07-24') }],
    );
    expect(days).toHaveLength(6);
  });

  it('returns an empty list for an inverted range', () => {
    expect(
      workingDaysBetween(d('2026-07-26'), d('2026-07-20'), [], []),
    ).toEqual([]);
  });

  it('handles a single-day range', () => {
    expect(
      workingDaysBetween(d('2026-07-20'), d('2026-07-20'), [], []),
    ).toEqual(['2026-07-20']);
  });
});
