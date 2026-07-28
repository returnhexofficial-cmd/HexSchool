import {
  isKebabCase,
  isReservedSlug,
  MAX_SLUG_LENGTH,
  slugError,
  slugify,
  uniqueSlug,
} from './slug.util';

describe('slug.util', () => {
  describe('isKebabCase', () => {
    it.each([
      ['about', true],
      ['principal-message', true],
      ['class-9-routine', true],
      ['About', false],
      ['about_us', false],
      ['about--us', false],
      ['-about', false],
      ['about-', false],
      ['about us', false],
      ['', false],
    ])('%s → %s', (slug, expected) => {
      expect(isKebabCase(slug)).toBe(expected);
    });
  });

  describe('slugError', () => {
    it('accepts a clean kebab-case slug', () => {
      expect(slugError('mission-vision')).toBeNull();
    });

    it('refuses a reserved application segment', () => {
      expect(slugError('admin')).toMatch(/reserved/i);
      expect(slugError('api')).toMatch(/reserved/i);
      expect(slugError('portal')).toMatch(/reserved/i);
      // Case-insensitively: a page at /Admin would still shadow /admin
      // on a case-insensitive host.
      expect(isReservedSlug('ADMIN')).toBe(true);
    });

    it('refuses the routes this module itself serves', () => {
      for (const slug of ['news', 'notices', 'gallery', 'contact', 'results']) {
        expect(slugError(slug)).toMatch(/reserved/i);
      }
    });

    it('refuses a non-kebab slug with an actionable message', () => {
      expect(slugError('About Us')).toMatch(/kebab-case/);
    });

    it('refuses an over-long slug', () => {
      expect(slugError('a'.repeat(MAX_SLUG_LENGTH + 1))).toMatch(/at most/);
    });

    it('refuses an empty slug', () => {
      expect(slugError('')).toMatch(/required/);
    });
  });

  describe('slugify', () => {
    it.each([
      ['About Us', 'about-us'],
      ['  Principal’s Message  ', 'principal-s-message'],
      ['Class 9 — Routine (2026)', 'class-9-routine-2026'],
      ['Café Corner', 'cafe-corner'],
      ['multiple   spaces', 'multiple-spaces'],
      ['---leading and trailing---', 'leading-and-trailing'],
    ])('%s → %s', (input, expected) => {
      expect(slugify(input)).toBe(expected);
    });

    it('returns empty for text with no ASCII letters (Bangla titles)', () => {
      // Deliberate: there is no transliteration here, so the service asks
      // the author for an explicit slug rather than inventing one.
      expect(slugify('শিক্ষক পরিচিতি')).toBe('');
    });

    it('never produces a trailing hyphen when truncating', () => {
      const long = `${'word '.repeat(60)}`;
      const slug = slugify(long);
      expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
      expect(slug.endsWith('-')).toBe(false);
    });
  });

  describe('uniqueSlug', () => {
    it('returns the base when it is free', () => {
      expect(uniqueSlug('About Us', new Set())).toBe('about-us');
    });

    it('suffixes until it finds a free slug', () => {
      expect(uniqueSlug('About', new Set(['about']))).toBe('about-2');
      expect(uniqueSlug('About', new Set(['about', 'about-2']))).toBe(
        'about-3',
      );
    });

    it('falls back to "page" when the title slugifies to nothing', () => {
      expect(uniqueSlug('শিক্ষক', new Set())).toBe('page');
    });
  });
});
