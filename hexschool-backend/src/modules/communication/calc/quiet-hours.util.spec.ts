import { delayUntilSendable, inQuietHours } from './quiet-hours.util';

const HM = (h: number, m = 0) => h * 60 + m;

describe('quiet hours', () => {
  // The default school window: 21:00 → 08:00 (wraps midnight).
  const START = HM(21);
  const END = HM(8);

  describe('inQuietHours (wrapping window)', () => {
    it('is quiet late at night', () => {
      expect(inQuietHours(HM(22, 30), START, END)).toBe(true);
      expect(inQuietHours(HM(23, 59), START, END)).toBe(true);
    });

    it('is quiet in the early morning', () => {
      expect(inQuietHours(HM(0), START, END)).toBe(true);
      expect(inQuietHours(HM(7, 59), START, END)).toBe(true);
    });

    it('is loud during the day', () => {
      expect(inQuietHours(HM(8), START, END)).toBe(false); // window is half-open
      expect(inQuietHours(HM(12), START, END)).toBe(false);
      expect(inQuietHours(HM(20, 59), START, END)).toBe(false);
    });

    it('is quiet exactly at the start boundary', () => {
      expect(inQuietHours(HM(21), START, END)).toBe(true);
    });
  });

  describe('inQuietHours (same-day window)', () => {
    it('handles a non-wrapping window like 01:00–05:00', () => {
      expect(inQuietHours(HM(3), HM(1), HM(5))).toBe(true);
      expect(inQuietHours(HM(6), HM(1), HM(5))).toBe(false);
    });

    it('an empty window (start === end) is never quiet', () => {
      expect(inQuietHours(HM(3), HM(3), HM(3))).toBe(false);
    });
  });

  describe('delayUntilSendable', () => {
    it('is zero during the day (send now)', () => {
      expect(delayUntilSendable(HM(12), START, END)).toBe(0);
    });

    it('holds a late-night message until 08:00', () => {
      // 23:00 → 08:00 is 9 hours.
      expect(delayUntilSendable(HM(23), START, END)).toBe(9 * 60);
    });

    it('holds an early-morning message the remaining minutes', () => {
      // 07:30 → 08:00 is 30 minutes.
      expect(delayUntilSendable(HM(7, 30), START, END)).toBe(30);
    });

    it('never returns a negative delay', () => {
      expect(delayUntilSendable(HM(21), START, END)).toBeGreaterThan(0);
    });
  });
});
