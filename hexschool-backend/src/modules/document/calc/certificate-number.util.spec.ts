import {
  counterKey,
  DEFAULT_TYPE_PREFIXES,
  isUsableCertificateNumber,
  mergePrefixes,
  normalizeLegacyNumber,
  resolvePattern,
} from './certificate-number.util';

describe('certificate-number.util', () => {
  describe('resolvePattern', () => {
    it('substitutes the per-type prefix and leaves the sequence tokens alone', () => {
      expect(resolvePattern('{TYPE}-{YY}-{SEQ4}', 'TRANSFER')).toBe(
        'TC-{YY}-{SEQ4}',
      );
      expect(resolvePattern('{TYPE}-{YY}-{SEQ4}', 'CHARACTER')).toBe(
        'CC-{YY}-{SEQ4}',
      );
    });

    it('matches the pattern PROJECT_CONTEXT §3 records for certificates', () => {
      expect(resolvePattern('{TYPE}-{YY}-{SEQ4}', 'TRANSFER')).toBe(
        'TC-{YY}-{SEQ4}',
      );
    });

    it('honours a school-configured prefix', () => {
      expect(
        resolvePattern('{TYPE}/{YYYY}/{SEQ5}', 'TESTIMONIAL', {
          TESTIMONIAL: 'tm',
        }),
      ).toBe('TM/{YYYY}/{SEQ5}');
    });

    it('falls back to the default when the configured prefix is blank', () => {
      expect(resolvePattern('{TYPE}-{SEQ4}', 'PRIZE', { PRIZE: '   ' })).toBe(
        'PR-{SEQ4}',
      );
    });

    it('leaves a pattern with no {TYPE} token untouched', () => {
      expect(resolvePattern('CERT-{YY}-{SEQ4}', 'CUSTOM')).toBe(
        'CERT-{YY}-{SEQ4}',
      );
    });

    it('covers every type with a distinct default prefix', () => {
      const prefixes = Object.values(DEFAULT_TYPE_PREFIXES);
      expect(new Set(prefixes).size).toBe(prefixes.length);
    });
  });

  describe('counterKey', () => {
    const jan = new Date(Date.UTC(2026, 0, 3));
    const dec = new Date(Date.UTC(2026, 11, 31));
    const nextJan = new Date(Date.UTC(2027, 0, 1));

    it('is per type and per year', () => {
      expect(counterKey('TRANSFER', jan)).toBe('certificate:transfer:26');
      expect(counterKey('CHARACTER', jan)).toBe('certificate:character:26');
    });

    it('keeps two types in the same year on separate counters', () => {
      expect(counterKey('TRANSFER', jan)).not.toBe(counterKey('PRIZE', jan));
    });

    it('rolls over at the year boundary so numbering restarts', () => {
      expect(counterKey('TRANSFER', dec)).toBe('certificate:transfer:26');
      expect(counterKey('TRANSFER', nextJan)).toBe('certificate:transfer:27');
    });
  });

  describe('mergePrefixes', () => {
    it('returns the defaults for a missing or malformed config', () => {
      expect(mergePrefixes(undefined)).toEqual(DEFAULT_TYPE_PREFIXES);
      expect(mergePrefixes(null)).toEqual(DEFAULT_TYPE_PREFIXES);
      expect(mergePrefixes('TC')).toEqual(DEFAULT_TYPE_PREFIXES);
      expect(mergePrefixes(['TC'])).toEqual(DEFAULT_TYPE_PREFIXES);
    });

    it('overrides only the keys it recognises', () => {
      const merged = mergePrefixes({ TRANSFER: 'tcx', NOT_A_TYPE: 'ZZ' });
      expect(merged.TRANSFER).toBe('TCX');
      expect(merged.CHARACTER).toBe('CC');
      expect(merged).not.toHaveProperty('NOT_A_TYPE');
    });

    it('ignores non-string and blank values rather than printing them', () => {
      const merged = mergePrefixes({ TRANSFER: 42, PRIZE: '', CUSTOM: '  ' });
      expect(merged.TRANSFER).toBe('TC');
      expect(merged.PRIZE).toBe('PR');
      expect(merged.CUSTOM).toBe('CE');
    });

    it('does not mutate the shared defaults', () => {
      mergePrefixes({ TRANSFER: 'XX' });
      expect(DEFAULT_TYPE_PREFIXES.TRANSFER).toBe('TC');
    });
  });

  describe('legacy numbers', () => {
    it('collapses whitespace but preserves the school’s own format', () => {
      expect(normalizeLegacyNumber('  TC /  2011 /  0042 ')).toBe(
        'TC / 2011 / 0042',
      );
    });

    it('refuses a blank or over-long number', () => {
      expect(isUsableCertificateNumber('   ')).toBe(false);
      expect(isUsableCertificateNumber('x'.repeat(61))).toBe(false);
      expect(isUsableCertificateNumber('TC-11-0042')).toBe(true);
    });
  });
});
