import { CRON_PRESETS, describeCron, nextRun, parseCron } from './cron.engine';

/** A Dhaka wall-clock time, as the UTC instant it actually is. */
const dhaka = (iso: string) => new Date(`${iso}+06:00`);

describe('parseCron — the §7 whitelist', () => {
  it('refuses a wildcard minute (that is the sub-hourly rule)', () => {
    const result = parseCron('* * * * *');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/sub-hourly/);
  });

  it('refuses a stepped minute', () => {
    expect(parseCron('*/5 * * * *').ok).toBe(false);
    expect(parseCron('0,30 * * * *').ok).toBe(false);
    expect(parseCron('0-30 * * * *').ok).toBe(false);
  });

  it('accepts a single literal minute', () => {
    const result = parseCron('35 * * * *');
    expect(result.ok).toBe(true);
    expect(result.fields?.minute).toBe(35);
  });

  it('refuses a six-field expression rather than reinterpreting it', () => {
    const result = parseCron('0 0 7 * * *');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Six-field/);
  });

  it('refuses the wrong field count', () => {
    expect(parseCron('0 7 * *').ok).toBe(false);
    expect(parseCron('').ok).toBe(false);
  });

  it('expands ranges, lists and steps in the other fields', () => {
    const result = parseCron('0 8-10 1,15 */3 *');
    expect(result.ok).toBe(true);
    expect(result.fields?.hours).toEqual([8, 9, 10]);
    expect(result.fields?.daysOfMonth).toEqual([1, 15]);
    expect(result.fields?.months).toEqual([1, 4, 7, 10]);
  });

  it('rejects out-of-range values', () => {
    expect(parseCron('0 24 * * *').ok).toBe(false);
    expect(parseCron('0 7 32 * *').ok).toBe(false);
    expect(parseCron('0 7 * 13 *').ok).toBe(false);
    expect(parseCron('0 7 * * 7').ok).toBe(false);
    expect(parseCron('60 7 * * *').ok).toBe(false);
  });

  it('rejects a backwards range', () => {
    expect(parseCron('0 10-8 * * *').ok).toBe(false);
  });

  it('accepts every preset', () => {
    for (const expression of Object.values(CRON_PRESETS)) {
      expect(parseCron(expression).ok).toBe(true);
    }
  });
});

describe('nextRun — Asia/Dhaka wall clock', () => {
  it('fires at the Dhaka hour, not the UTC one', () => {
    // 07:00 Dhaka is 01:00 UTC, same calendar day.
    const next = nextRun('0 7 * * *', dhaka('2026-08-10T06:00:00'));
    expect(next?.toISOString()).toBe('2026-08-10T01:00:00.000Z');
  });

  it('keeps the Dhaka calendar day when UTC is still on the day before', () => {
    // The case a UTC-native implementation gets wrong: 03:00 Dhaka on the
    // 11th is 21:00 UTC on the 10th, so a naive scan would fire it a day
    // late — and a "daily 3 a.m." report would arrive on the wrong date
    // every single time without anybody noticing the pattern.
    const next = nextRun('0 3 11 * *', dhaka('2026-08-10T09:00:00'));
    expect(next?.toISOString()).toBe('2026-08-10T21:00:00.000Z');
  });

  it('is strictly after the given instant, never equal to it', () => {
    const at = dhaka('2026-08-10T07:00:00');
    const next = nextRun('0 7 * * *', at);
    expect(next?.getTime()).toBeGreaterThan(at.getTime());
    expect(next?.toISOString()).toBe('2026-08-11T01:00:00.000Z');
  });

  it('finds the same day when the time has not passed yet', () => {
    const next = nextRun('30 20 * * *', dhaka('2026-08-10T09:00:00'));
    expect(next?.toISOString()).toBe('2026-08-10T14:30:00.000Z');
  });

  it('walks to the next matching weekday', () => {
    // 2026-08-10 is a Monday; a Sunday schedule lands on the 16th.
    const next = nextRun('0 7 * * 0', dhaka('2026-08-10T09:00:00'));
    expect(next?.toISOString().slice(0, 10)).toBe('2026-08-16');
  });

  it('walks to the next month for a day-of-month schedule', () => {
    const next = nextRun('0 7 1 * *', dhaka('2026-08-10T09:00:00'));
    expect(next?.toISOString()).toBe('2026-09-01T01:00:00.000Z'); // 1 Sep Dhaka
  });

  it('ORs the two day fields when both are restricted (Vixie rule)', () => {
    // The 1st OR any Monday. From Monday 10 Aug 09:00 — that day's 07:00
    // already gone — the next hit is Monday the 17th, NOT 1 September.
    // An AND reading would skip six weeks of reports.
    const next = nextRun('0 7 1 * 1', dhaka('2026-08-10T09:00:00'));
    expect(next?.toISOString().slice(0, 10)).toBe('2026-08-17');
  });

  it('ANDs nothing when only one day field is restricted', () => {
    const next = nextRun('0 7 15 * *', dhaka('2026-08-10T09:00:00'));
    expect(next?.toISOString().slice(0, 10)).toBe('2026-08-15');
  });

  it('picks the earliest matching hour of a multi-hour expression', () => {
    const next = nextRun('0 6,12,18 * * *', dhaka('2026-08-10T07:00:00'));
    expect(next?.toISOString()).toBe('2026-08-10T06:00:00.000Z'); // 12:00 Dhaka
  });

  it('returns null for an expression that can never fire', () => {
    expect(nextRun('0 9 30 2 *', dhaka('2026-08-10T09:00:00'))).toBeNull();
  });

  it('returns null for an invalid expression rather than throwing', () => {
    expect(nextRun('nonsense', dhaka('2026-08-10T09:00:00'))).toBeNull();
    expect(nextRun('* * * * *', dhaka('2026-08-10T09:00:00'))).toBeNull();
  });

  it('finds a leap day', () => {
    const next = nextRun('0 7 29 2 *', dhaka('2026-08-10T09:00:00'));
    expect(next?.toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('crosses a year boundary', () => {
    const next = nextRun('0 7 1 1 *', dhaka('2026-08-10T09:00:00'));
    expect(next?.toISOString()).toBe('2027-01-01T01:00:00.000Z'); // 1 Jan Dhaka
  });
});

describe('describeCron', () => {
  it('describes a daily schedule in Dhaka terms', () => {
    expect(describeCron('0 7 * * *')).toBe('At 07:00 (Asia/Dhaka) every day');
  });

  it('describes a weekly schedule', () => {
    expect(describeCron('30 6 * * 1')).toBe(
      'At 06:30 (Asia/Dhaka) every Monday',
    );
  });

  it('describes a monthly schedule with an ordinal', () => {
    expect(describeCron('0 7 1 * *')).toBe('At 07:00 (Asia/Dhaka) on the 1st');
    expect(describeCron('0 7 22 * *')).toBe(
      'At 07:00 (Asia/Dhaka) on the 22nd',
    );
    expect(describeCron('0 7 3 * *')).toBe('At 07:00 (Asia/Dhaka) on the 3rd');
    expect(describeCron('0 7 11 * *')).toBe(
      'At 07:00 (Asia/Dhaka) on the 11th',
    );
  });

  it('falls back to the raw expression when it cannot parse', () => {
    expect(describeCron('* * * * *')).toBe('* * * * *');
  });
});
