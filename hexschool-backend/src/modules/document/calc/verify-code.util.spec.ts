import {
  generateVerifyCode,
  isVerifyCodeShape,
  normalizeVerifyCode,
  VERIFY_CODE_ALPHABET,
  VERIFY_CODE_LENGTH,
  verifyUrl,
} from './verify-code.util';

/** Deterministic byte source — the engine takes it by injection. */
const bytesFrom = (values: number[]) => (size: number) =>
  Uint8Array.from(
    Array.from({ length: size }, (_, i) => values[i % values.length]),
  );

describe('verify-code.util', () => {
  describe('generateVerifyCode', () => {
    it('is exactly ten characters from the alphabet', () => {
      const code = generateVerifyCode(
        bytesFrom([0, 1, 2, 3, 31, 32, 33, 255, 128, 64]),
      );
      expect(code).toHaveLength(VERIFY_CODE_LENGTH);
      expect(isVerifyCodeShape(code)).toBe(true);
    });

    it('maps bytes through the alphabet deterministically', () => {
      // 32 divides 256, so byte % 32 indexes the alphabet directly.
      expect(generateVerifyCode(bytesFrom([0]))).toBe('0000000000');
      expect(generateVerifyCode(bytesFrom([31]))).toBe('ZZZZZZZZZZ');
      // 32 wraps back to index 0, which is what makes the modulo unbiased.
      expect(generateVerifyCode(bytesFrom([32]))).toBe('0000000000');
      expect(generateVerifyCode(bytesFrom([255]))).toBe('ZZZZZZZZZZ');
    });

    it('uses a power-of-two alphabet, so every byte value is equally likely', () => {
      expect(VERIFY_CODE_ALPHABET).toHaveLength(32);
      expect(256 % VERIFY_CODE_ALPHABET.length).toBe(0);
    });

    it('excludes the four characters Crockford drops', () => {
      for (const ch of ['I', 'L', 'O', 'U']) {
        expect(VERIFY_CODE_ALPHABET).not.toContain(ch);
      }
    });
  });

  describe('normalizeVerifyCode', () => {
    it('folds case', () => {
      expect(normalizeVerifyCode('4kj7m2qx9b')).toBe('4KJ7M2QX9B');
    });

    it('drops the separators a printed code carries', () => {
      expect(normalizeVerifyCode('4KJ7-M2QX-9B')).toBe('4KJ7M2QX9B');
      expect(normalizeVerifyCode(' 4KJ7 M2QX 9B ')).toBe('4KJ7M2QX9B');
      expect(normalizeVerifyCode('4KJ7_M2QX.9B')).toBe('4KJ7M2QX9B');
    });

    it('folds the characters a reader mis-reads off a printed page', () => {
      // The whole reason the fold exists: a genuine certificate must not
      // read as a forgery because somebody typed O for 0.
      expect(normalizeVerifyCode('OI L U')).toBe('011V');
      expect(normalizeVerifyCode('o i l u')).toBe('011V');
    });

    it('is idempotent — normalizing a stored code returns it unchanged', () => {
      const code = generateVerifyCode(
        bytesFrom([5, 13, 21, 29, 3, 17, 8, 30, 1, 24]),
      );
      expect(normalizeVerifyCode(code)).toBe(code);
    });

    it('never produces a character outside the alphabet from a foldable input', () => {
      const folded = normalizeVerifyCode('ILOU23456Z');
      for (const ch of folded) expect(VERIFY_CODE_ALPHABET).toContain(ch);
    });
  });

  describe('isVerifyCodeShape', () => {
    it('rejects the wrong length', () => {
      expect(isVerifyCodeShape('4KJ7M2QX9')).toBe(false);
      expect(isVerifyCodeShape('4KJ7M2QX9BB')).toBe(false);
    });

    it('rejects an excluded character', () => {
      expect(isVerifyCodeShape('4KJ7M2QX9I')).toBe(false);
      expect(isVerifyCodeShape('4KJ7M2QX9O')).toBe(false);
    });

    it('accepts a well-formed code', () => {
      expect(isVerifyCodeShape('4KJ7M2QX9B')).toBe(true);
    });
  });

  describe('verifyUrl', () => {
    it('builds the URL the QR encodes', () => {
      expect(verifyUrl('https://school.edu.bd', 'ABC1234567')).toBe(
        'https://school.edu.bd/verify/certificate?code=ABC1234567',
      );
    });

    it('tolerates a trailing slash on the configured site URL', () => {
      expect(verifyUrl('https://school.edu.bd///', 'ABC1234567')).toBe(
        'https://school.edu.bd/verify/certificate?code=ABC1234567',
      );
    });

    it('falls back to the bare code rather than encoding a localhost URL', () => {
      expect(verifyUrl('', 'ABC1234567')).toBe('ABC1234567');
      expect(verifyUrl('   ', 'ABC1234567')).toBe('ABC1234567');
    });
  });
});
