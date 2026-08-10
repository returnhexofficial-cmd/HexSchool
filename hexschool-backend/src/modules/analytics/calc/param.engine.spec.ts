import { isRealDate, paramFingerprint, validateParams } from './param.engine';
import type { ReportParam } from './types';

const p = (over: Partial<ReportParam> & Pick<ReportParam, 'key' | 'type'>) => ({
  label: over.key,
  required: false,
  ...over,
});

describe('isRealDate', () => {
  it('accepts a real date', () => {
    expect(isRealDate('2026-02-28')).toBe(true);
    expect(isRealDate('2024-02-29')).toBe(true); // leap year
  });

  it('rejects a shape-valid impossible date — the M05 lesson', () => {
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(isRealDate('2026-13-01')).toBe(false);
    expect(isRealDate('2026-00-10')).toBe(false);
    expect(isRealDate('2025-02-29')).toBe(false);
  });

  it('rejects the wrong shape entirely', () => {
    expect(isRealDate('10/08/2026')).toBe(false);
    expect(isRealDate('2026-8-1')).toBe(false);
    expect(isRealDate('')).toBe(false);
  });
});

describe('validateParams', () => {
  it('reports every error at once, not just the first', () => {
    const schema = [
      p({ key: 'from', type: 'date', required: true }),
      p({ key: 'to', type: 'date', required: true }),
      p({ key: 'sessionId', type: 'session', required: true }),
    ];
    const result = validateParams(schema, {
      from: 'nonsense',
      to: '2026-02-30',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.key).sort()).toEqual([
      'from',
      'sessionId',
      'to',
    ]);
  });

  it('coerces numbers and booleans from query strings', () => {
    const schema = [
      p({ key: 'days', type: 'number', min: 1, max: 365 }),
      p({ key: 'includeVoid', type: 'boolean' }),
    ];
    const result = validateParams(schema, { days: '30', includeVoid: 'true' });
    expect(result.ok).toBe(true);
    expect(result.values).toEqual({ days: 30, includeVoid: true });
  });

  it('enforces number bounds', () => {
    const schema = [p({ key: 'days', type: 'number', min: 1, max: 90 })];
    expect(validateParams(schema, { days: '0' }).ok).toBe(false);
    expect(validateParams(schema, { days: '91' }).ok).toBe(false);
    expect(validateParams(schema, { days: '90' }).ok).toBe(true);
  });

  it('applies defaults when a value is blank, not only when absent', () => {
    const schema = [p({ key: 'limit', type: 'number', default: 20 })];
    expect(validateParams(schema, {}).values.limit).toBe(20);
    expect(validateParams(schema, { limit: '' }).values.limit).toBe(20);
    expect(validateParams(schema, { limit: '5' }).values.limit).toBe(5);
  });

  it('requires an id param to look like a uuid', () => {
    const schema = [p({ key: 'examId', type: 'exam', required: true })];
    expect(validateParams(schema, { examId: '42' }).ok).toBe(false);
    expect(
      validateParams(schema, {
        examId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      }).ok,
    ).toBe(true);
  });

  it('validates a month as YYYY-MM', () => {
    const schema = [p({ key: 'month', type: 'month', required: true })];
    expect(validateParams(schema, { month: '2026-08' }).ok).toBe(true);
    expect(validateParams(schema, { month: '2026-13' }).ok).toBe(false);
    expect(validateParams(schema, { month: '2026-8' }).ok).toBe(false);
  });

  it('holds an enum to its options', () => {
    const schema = [
      p({ key: 'status', type: 'enum', options: ['OPEN', 'CLOSED'] }),
    ];
    expect(validateParams(schema, { status: 'OPEN' }).ok).toBe(true);
    expect(validateParams(schema, { status: 'PENDING' }).ok).toBe(false);
  });

  it('drops unknown keys rather than refusing the run', () => {
    // A stored schedule outlives the schema it was written against.
    const schema = [p({ key: 'from', type: 'date' })];
    const result = validateParams(schema, {
      from: '2026-01-01',
      retiredFilter: 'whatever',
    });
    expect(result.ok).toBe(true);
    expect(result.values).toEqual({ from: '2026-01-01' });
  });

  it('catches a reversed window once, across every report', () => {
    const schema = [
      p({ key: 'from', type: 'date' }),
      p({ key: 'to', type: 'date' }),
    ];
    const result = validateParams(schema, {
      from: '2026-06-01',
      to: '2026-05-01',
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      { key: 'to', message: 'The end date is before the start' },
    ]);
  });

  it('accepts an equal from and to (a single day is a window)', () => {
    const schema = [
      p({ key: 'from', type: 'date' }),
      p({ key: 'to', type: 'date' }),
    ];
    expect(
      validateParams(schema, { from: '2026-06-01', to: '2026-06-01' }).ok,
    ).toBe(true);
  });

  it('treats an empty string as absent for a required param', () => {
    const schema = [p({ key: 'sessionId', type: 'session', required: true })];
    expect(validateParams(schema, { sessionId: '   ' }).ok).toBe(false);
  });

  it('tolerates a null bag', () => {
    expect(validateParams([p({ key: 'x', type: 'text' })], null).ok).toBe(true);
  });
});

describe('paramFingerprint', () => {
  it('is stable under key order', () => {
    expect(paramFingerprint({ b: 2, a: '1' })).toBe(
      paramFingerprint({ a: '1', b: 2 }),
    );
  });

  it('ignores undefined values', () => {
    expect(paramFingerprint({ a: '1', b: undefined })).toBe('a=1');
  });
});
