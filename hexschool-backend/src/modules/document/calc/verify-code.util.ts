/**
 * The public handle on a certificate (roadmap M27 §3 `verify_code uq
 * (random 10-char)`, §7 "verify_code collision-checked").
 *
 * **It is not the row id, for the M09 `qr_token` reason**: a primary key
 * printed on ten thousand certificates can never be changed, and a
 * sequential one would let anybody holding one certificate enumerate the
 * rest. This is random, short enough to read off a page and type into a
 * phone, and replaceable without touching a foreign key.
 *
 * The alphabet is **Crockford Base32** — `I`, `L`, `O` and `U` are absent,
 * and the first three fold onto `1`, `1` and `0` when somebody types what
 * they read. That fold is the point: the code exists to be retyped off a
 * laser print or a photocopy, and a verification page that answers "not
 * found" to a correctly-read certificate is worse than having no
 * verification page at all — it tells the holder of a genuine document
 * that it is a forgery. (`U` is dropped by Crockford so no accidental
 * obscenity can be generated; it folds to `V`.)
 *
 * 32 characters over 10 positions is ~10^15 codes, which is why a DB
 * unique plus a bounded retry is the whole collision strategy.
 */

export const VERIFY_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const VERIFY_CODE_LENGTH = 10;

/** Confusables → the character Crockford Base32 actually uses. */
const FOLD: Record<string, string> = {
  I: '1',
  L: '1',
  O: '0',
  U: 'V',
};

/**
 * Generate one code. `randomBytes` is injected rather than imported so the
 * engine stays dependency-free and golden-testable — the caller passes
 * `crypto.randomBytes`.
 *
 * 32 divides 256 exactly, so the modulo is unbiased and rejection sampling
 * would add a loop with nothing to test. (That is a second reason for a
 * power-of-two alphabet, and the reason not to trim it to 29 characters.)
 */
export function generateVerifyCode(
  randomBytes: (size: number) => Uint8Array,
): string {
  const bytes = randomBytes(VERIFY_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < VERIFY_CODE_LENGTH; i++) {
    code += VERIFY_CODE_ALPHABET[bytes[i] % VERIFY_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * What a person typed, turned into what is stored: case folded, separators
 * dropped (a code printed as `4KJ7-M2QX-9B` is the same code), confusables
 * mapped.
 */
export function normalizeVerifyCode(raw: string): string {
  const stripped = raw
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.]/g, '');
  let out = '';
  for (const ch of stripped) out += FOLD[ch] ?? ch;
  return out;
}

/** Shape check — cheap enough to run before touching the database. */
export function isVerifyCodeShape(value: string): boolean {
  if (value.length !== VERIFY_CODE_LENGTH) return false;
  for (const ch of value) {
    if (!VERIFY_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/**
 * The URL the QR encodes (roadmap §4, "QR encodes verify URL+code").
 *
 * The QR carries a **URL and not a bare code**, because the person scanning
 * it is a university admissions clerk with a phone, not somebody who knows
 * this school has a verification page. A bare code would need them to find
 * the site first, which is exactly the friction that makes people ring the
 * office instead — and a certificate nobody verifies online is a
 * certificate this module did not help with.
 *
 * With no site URL configured there is nothing honest to encode but the
 * code itself; a QR pointing at `localhost` would be worse than one that
 * simply shows the code (the M19 unconfigured-sitemap rule).
 */
export function verifyUrl(base: string, code: string): string {
  const root = base.trim().replace(/\/+$/, '');
  if (!root) return code;
  return `${root}/verify/certificate?code=${encodeURIComponent(code)}`;
}
