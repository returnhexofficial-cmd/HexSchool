/**
 * ISBN-10 / ISBN-13 normalisation and checksum (roadmap §7).
 *
 * Dependency-free, and deliberately **validating rather than
 * rejecting-on-shape**: the check digit is the whole point of an ISBN,
 * and a librarian who mistypes one digit gets a specific "that check
 * digit is wrong" rather than a shrug. What we do *not* do is refuse an
 * ISBN we merely do not recognise — a BD school's shelves carry books
 * whose ISBNs predate the 13-digit switch, and a validator that knows
 * better than the barcode is a validator that gets switched off.
 */

/** Strips hyphens, spaces and non-significant characters; upper-cases X. */
export function normalizeIsbn(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/** ISBN-10: Σ digit × (10…1) ≡ 0 (mod 11); the last digit may be `X` = 10. */
function isbn10Valid(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = value[i];
    const digit = ch === 'X' ? 10 : Number(ch);
    sum += digit * (10 - i);
  }
  return sum % 11 === 0;
}

/** ISBN-13: Σ digit × (1,3,1,3…) ≡ 0 (mod 10) — the EAN-13 rule. */
function isbn13Valid(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += Number(value[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return sum % 10 === 0;
}

export type IsbnKind = 'ISBN10' | 'ISBN13' | 'INVALID';

export function isbnKind(raw: string): IsbnKind {
  const value = normalizeIsbn(raw);
  if (isbn10Valid(value)) return 'ISBN10';
  if (isbn13Valid(value)) return 'ISBN13';
  return 'INVALID';
}

export function isValidIsbn(raw: string): boolean {
  return isbnKind(raw) !== 'INVALID';
}

/** The 978-prefixed 13-digit form, for an ISBN-10. Idempotent on a 13. */
export function toIsbn13(raw: string): string | null {
  const value = normalizeIsbn(raw);
  if (isbn13Valid(value)) return value;
  if (!isbn10Valid(value)) return null;

  const body = `978${value.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return `${body}${check}`;
}

/**
 * Validate-and-store. Returns the normalised value, or throws the
 * message the DTO surfaces. An empty/absent ISBN is legal and returns
 * `null` — most of a BD school library has no ISBN at all, which is why
 * `books.isbn` is nullable and not unique (see the model doc).
 */
export function parseIsbn(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const value = normalizeIsbn(raw);
  if (value.length === 0) return null;
  if (!isValidIsbn(value)) {
    throw new Error(
      `"${raw}" is not a valid ISBN — the check digit does not match. Leave it blank if the book has no ISBN.`,
    );
  }
  return value;
}

/** `9780306406157` → `978-0-306-40615-7`, for display only. */
export function formatIsbn(value: string): string {
  const v = normalizeIsbn(value);
  if (v.length === 13) {
    return `${v.slice(0, 3)}-${v.slice(3, 4)}-${v.slice(4, 7)}-${v.slice(7, 12)}-${v.slice(12)}`;
  }
  if (v.length === 10) {
    return `${v.slice(0, 1)}-${v.slice(1, 4)}-${v.slice(4, 9)}-${v.slice(9)}`;
  }
  return v;
}
