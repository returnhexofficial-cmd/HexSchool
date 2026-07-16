import { BadRequestException } from '@nestjs/common';
import { isoDate, parseDate } from './date.util';

describe('parseDate (strict)', () => {
  it('parses real calendar dates', () => {
    expect(isoDate(parseDate('2026-02-28'))).toBe('2026-02-28');
    expect(isoDate(parseDate('2028-02-29'))).toBe('2028-02-29'); // leap year
  });

  it('rejects shape-valid but impossible dates (regex blind spots)', () => {
    for (const bad of [
      '2026-13-01',
      '2026-00-10',
      '2026-02-30',
      '2026-04-31',
    ]) {
      expect(() => parseDate(bad)).toThrow(BadRequestException);
    }
  });
});
