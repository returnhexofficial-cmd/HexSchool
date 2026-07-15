import { REDACTED, redactSensitive } from './redact';

describe('redactSensitive', () => {
  it('redacts secret-bearing keys at any depth', () => {
    const input = {
      identifier: 'user@test.local',
      password: 'Secret123',
      profile: {
        name: 'Rahim',
        resetToken: 'abc',
        nested: { apiKey: 'k', list: [{ tokenHash: 'h', ok: 1 }] },
      },
    };
    expect(redactSensitive(input)).toEqual({
      identifier: 'user@test.local',
      password: REDACTED,
      profile: {
        name: 'Rahim',
        resetToken: REDACTED,
        nested: { apiKey: REDACTED, list: [{ tokenHash: REDACTED, ok: 1 }] },
      },
    });
  });

  it('covers the password_hash / otp / authorization families', () => {
    expect(
      redactSensitive({
        password_hash: 'x',
        otpCode: '123456',
        authorization: 'Bearer y',
        newPassword: 'z',
      }),
    ).toEqual({
      password_hash: REDACTED,
      otpCode: REDACTED,
      authorization: REDACTED,
      newPassword: REDACTED,
    });
  });

  it('passes primitives, arrays and dates through untouched', () => {
    expect(redactSensitive('plain')).toBe('plain');
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive([1, 'a'])).toEqual([1, 'a']);
    const date = new Date('2026-01-01T00:00:00Z');
    expect(redactSensitive({ at: date })).toEqual({ at: date });
  });

  it('caps runaway recursion depth', () => {
    type Deep = { child?: Deep };
    const root: Deep = {};
    let cursor = root;
    for (let i = 0; i < 20; i += 1) {
      cursor.child = {};
      cursor = cursor.child;
    }
    const out = JSON.stringify(redactSensitive(root));
    expect(out).toContain(REDACTED);
  });
});
