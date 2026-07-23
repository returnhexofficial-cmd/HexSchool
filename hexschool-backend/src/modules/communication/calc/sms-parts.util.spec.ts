import {
  countSegments,
  estimateSmsCost,
  isUnicode,
  segmentSms,
} from './sms-parts.util';

describe('SMS segmentation', () => {
  describe('isUnicode', () => {
    it('treats plain Latin as GSM-7', () => {
      expect(isUnicode('Your child was absent today.')).toBe(false);
    });

    it('treats any Bangla character as unicode', () => {
      expect(isUnicode('আপনার সন্তান আজ অনুপস্থিত ছিল')).toBe(true);
    });

    it('keeps the GSM-7 extended chars in GSM-7 (not unicode)', () => {
      expect(isUnicode('50% off [today] {sale}')).toBe(false);
    });

    it('flags an emoji as unicode', () => {
      expect(isUnicode('Result published 🎉')).toBe(true);
    });
  });

  describe('GSM-7 segmentation', () => {
    it('is one part up to 160 characters', () => {
      expect(countSegments('a'.repeat(160))).toBe(1);
    });

    it('rolls to two parts at 161 (153 each once concatenated)', () => {
      expect(countSegments('a'.repeat(161))).toBe(2);
      expect(countSegments('a'.repeat(306))).toBe(2);
      expect(countSegments('a'.repeat(307))).toBe(3);
    });

    it('counts an extended char as two units', () => {
      // 159 plain + one € (2 units) = 161 units → two parts.
      const body = 'a'.repeat(159) + '€';
      expect(segmentSms(body).units).toBe(161);
      expect(countSegments(body)).toBe(2);
    });

    it('the empty string is still one billed segment', () => {
      expect(countSegments('')).toBe(1);
    });
  });

  describe('UCS-2 (Bangla) segmentation', () => {
    it('is one part up to 70 UTF-16 units', () => {
      expect(countSegments('ক'.repeat(70))).toBe(1);
    });

    it('rolls to two parts at 71 (67 each once concatenated)', () => {
      expect(countSegments('ক'.repeat(71))).toBe(2);
      expect(countSegments('ক'.repeat(134))).toBe(2);
      expect(countSegments('ক'.repeat(135))).toBe(3);
    });

    it('bills an emoji surrogate pair as two units', () => {
      // A single 🎉 is two UTF-16 code units.
      expect(segmentSms('🎉').units).toBe(2);
    });
  });

  describe('estimateSmsCost', () => {
    it('multiplies parts by the flat rate', () => {
      expect(estimateSmsCost('a'.repeat(161), 0.5)).toBe(1); // 2 parts × 0.5
    });

    it('uses the unicode rate for a Bangla body when given', () => {
      // 71 Bangla chars = 2 parts; unicode rate 1.0 ⇒ 2.0.
      expect(estimateSmsCost('ক'.repeat(71), 0.5, 1.0)).toBe(2);
    });

    it('falls back to the flat rate when no unicode rate is set', () => {
      expect(estimateSmsCost('ক'.repeat(71), 0.5)).toBe(1); // 2 × 0.5
    });

    it('rounds to four decimal places (the cost column width)', () => {
      expect(estimateSmsCost('a', 0.33333)).toBe(0.3333);
    });
  });
});
