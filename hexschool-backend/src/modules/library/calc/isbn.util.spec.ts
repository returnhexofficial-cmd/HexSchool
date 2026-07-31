import {
  formatIsbn,
  isbnKind,
  isValidIsbn,
  normalizeIsbn,
  parseIsbn,
  toIsbn13,
} from './isbn.util';

describe('normalizeIsbn', () => {
  it('strips hyphens and spaces and upper-cases the X check digit', () => {
    expect(normalizeIsbn('0-306-40615-2')).toBe('0306406152');
    expect(normalizeIsbn('80 85955 55 x')).toBe('808595555X');
  });
});

describe('isbnKind / isValidIsbn', () => {
  // Published, known-good values — the point of a checksum test is that
  // the expected answers come from outside the implementation.
  it.each([
    ['0306406152', 'ISBN10'],
    ['080442957X', 'ISBN10'],
    ['9780306406157', 'ISBN13'],
    ['9783161484100', 'ISBN13'],
  ] as const)('accepts %s as %s', (value, kind) => {
    expect(isbnKind(value)).toBe(kind);
    expect(isValidIsbn(value)).toBe(true);
  });

  /** One digit transposed is the mistake a checksum exists to catch. */
  it('rejects a transposed digit', () => {
    expect(isValidIsbn('0306460152')).toBe(false);
    expect(isValidIsbn('9780306046157')).toBe(false);
  });

  it('rejects the wrong length', () => {
    expect(isbnKind('030640615')).toBe('INVALID');
    expect(isbnKind('97803064061570')).toBe('INVALID');
  });

  it('rejects an X anywhere but the last position of a 10', () => {
    expect(isValidIsbn('03X6406152')).toBe(false);
  });

  it('rejects an X in a 13', () => {
    expect(isValidIsbn('978030640615X')).toBe(false);
  });

  it('accepts a hyphenated value as written on the back cover', () => {
    expect(isValidIsbn('978-0-306-40615-7')).toBe(true);
  });
});

describe('toIsbn13', () => {
  it('converts a valid ISBN-10 to its 978 form', () => {
    expect(toIsbn13('0306406152')).toBe('9780306406157');
    expect(toIsbn13('080442957X')).toBe('9780804429573');
  });

  it('is idempotent on a 13', () => {
    expect(toIsbn13('9780306406157')).toBe('9780306406157');
  });

  it('returns null for an invalid input rather than inventing a number', () => {
    expect(toIsbn13('0306460152')).toBeNull();
    expect(toIsbn13('not-an-isbn')).toBeNull();
  });
});

describe('parseIsbn', () => {
  it('returns the normalised value for a good ISBN', () => {
    expect(parseIsbn('978-0-306-40615-7')).toBe('9780306406157');
  });

  /**
   * Most of a BD school library has no ISBN at all — locally printed
   * guides, donated older editions — which is why the column is nullable
   * and blank is a legal answer rather than a validation error.
   */
  it.each([null, undefined, '', '   ', '--'])(
    'treats %p as "this book has no ISBN"',
    (value) => {
      expect(parseIsbn(value)).toBeNull();
    },
  );

  it('throws a message naming the check digit for a bad one', () => {
    expect(() => parseIsbn('0306460152')).toThrow(/check digit/i);
  });
});

describe('formatIsbn', () => {
  it('groups a 13 and a 10 for display', () => {
    expect(formatIsbn('9780306406157')).toBe('978-0-306-40615-7');
    expect(formatIsbn('0306406152')).toBe('0-306-40615-2');
  });

  it('leaves anything else alone', () => {
    expect(formatIsbn('12345')).toBe('12345');
  });
});
