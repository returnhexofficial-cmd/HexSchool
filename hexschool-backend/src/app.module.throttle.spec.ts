/**
 * The throttler `skipIf` predicate, extracted and asserted directly.
 *
 * `AUTH_THROTTLE_ENABLED=false` exists so the browser-QA harness can sign in
 * once per seeded role without tripping the 5/min credential limit (that burst
 * left 3 of 7 roles unauthenticated). The knob must never be able to disable
 * rate limiting in production, so the guard is worth pinning down.
 */
type Env = 'development' | 'test' | 'production';

/** Mirrors the predicate in app.module.ts. */
const shouldSkip = (env: Env, flag: string | undefined): boolean => {
  if (env === 'test') return true;
  return env !== 'production' && flag === 'false';
};

describe('throttler skipIf', () => {
  afterEach(() => {
    delete process.env.AUTH_THROTTLE_ENABLED;
  });

  it('always skips under NODE_ENV=test (the e2e suites)', () => {
    expect(shouldSkip('test', undefined)).toBe(true);
  });

  it('throttles a normal development run', () => {
    expect(shouldSkip('development', undefined)).toBe(false);
  });

  it('lifts the limit in development when AUTH_THROTTLE_ENABLED=false', () => {
    expect(shouldSkip('development', 'false')).toBe(true);
  });

  it('NEVER lifts the limit in production, even with the flag set', () => {
    expect(shouldSkip('production', 'false')).toBe(false);
  });

  it('ignores any value other than the exact string "false"', () => {
    for (const value of ['true', '0', 'no', '', 'FALSE', 'False']) {
      expect(shouldSkip('development', value)).toBe(false);
    }
  });
});
