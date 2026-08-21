import { AttendanceStatus } from '../../../common/constants';
import {
  cohortPercentage,
  countByStatus,
  emptyCounts,
  presentEquivalent,
  rangePercentage,
  sameDayPercentage,
  summarize,
} from './percentage.util';

describe('attendance percentage engine', () => {
  const counts = (partial: Partial<Record<AttendanceStatus, number>>) => ({
    ...emptyCounts(),
    ...partial,
  });

  it('counts a half day as half a present day', () => {
    expect(
      presentEquivalent(
        counts({ PRESENT: 10, LATE: 2, HALF_DAY: 3, ABSENT: 5 }),
      ),
    ).toBe(13.5);
  });

  it('treats LATE as present for the percentage', () => {
    const summary = summarize(counts({ PRESENT: 8, LATE: 2 }), 10);
    expect(summary.percentage).toBe(100);
  });

  it('counts LEAVE as a working day that was not attended', () => {
    const summary = summarize(counts({ PRESENT: 8, LEAVE: 2 }), 10);
    expect(summary.percentage).toBe(80);
  });

  it('drops HOLIDAY-converted days out of the denominator', () => {
    // 20 calendar working days, 2 later declared a government holiday.
    const summary = summarize(counts({ PRESENT: 18, HOLIDAY: 2 }), 20);
    expect(summary.workingDays).toBe(18);
    expect(summary.percentage).toBe(100);
  });

  it('reports unmarked working days without inflating the percentage', () => {
    const summary = summarize(counts({ PRESENT: 5, ABSENT: 1 }), 10);
    expect(summary.markedDays).toBe(6);
    expect(summary.unmarkedDays).toBe(4);
    expect(summary.percentage).toBe(50);
  });

  it('returns 0% instead of dividing by zero for an empty window', () => {
    expect(summarize(emptyCounts(), 0).percentage).toBe(0);
  });

  it('rounds to two decimals', () => {
    // 1 of 3 days → 33.333…%
    expect(summarize(counts({ PRESENT: 1, ABSENT: 2 }), 3).percentage).toBe(
      33.33,
    );
  });

  it('tallies rows by status', () => {
    const tally = countByStatus([
      { status: AttendanceStatus.PRESENT },
      { status: AttendanceStatus.PRESENT },
      { status: AttendanceStatus.ABSENT },
    ]);
    expect(tally.PRESENT).toBe(2);
    expect(tally.ABSENT).toBe(1);
    expect(tally.LATE).toBe(0);
  });
});

/**
 * QA finding F28 — one student report carried two figures both called
 * `percentage`, 42.86% and 60%, because the range-spanning ones divided by
 * marked days instead of working days. These pin which denominator each
 * question takes, so the two can never quietly become one again.
 */
describe('three denominators', () => {
  const c = (partial: Partial<Record<AttendanceStatus, number>>) => ({
    ...emptyCounts(),
    ...partial,
  });

  describe('sameDayPercentage — one day, one cohort', () => {
    it('divides by the students actually marked', () => {
      // 3 of 4 marked students present: an unmarked 5th is missing data,
      // not an absence, and must not drag the day down.
      expect(
        sameDayPercentage(
          c({
            [AttendanceStatus.PRESENT]: 2,
            [AttendanceStatus.LATE]: 1,
            [AttendanceStatus.ABSENT]: 1,
          }),
        ),
      ).toBe(75);
    });

    it('counts LEAVE against the day, and half a HALF_DAY', () => {
      expect(
        sameDayPercentage(
          c({
            [AttendanceStatus.PRESENT]: 1,
            [AttendanceStatus.HALF_DAY]: 1,
            [AttendanceStatus.LEAVE]: 2,
          }),
        ),
      ).toBe(37.5);
    });

    it('is 0, not NaN, when nobody was marked', () => {
      expect(sameDayPercentage(emptyCounts())).toBe(0);
    });
  });

  describe('rangePercentage — one student over a window', () => {
    it('follows the roadmap formula over working days', () => {
      // The exact shape that exposed F28: 2 present + 1 late over 7 working
      // days, with one day converted to HOLIDAY after marking.
      const counts = c({
        [AttendanceStatus.PRESENT]: 2,
        [AttendanceStatus.LATE]: 1,
        [AttendanceStatus.ABSENT]: 1,
        [AttendanceStatus.LEAVE]: 1,
        [AttendanceStatus.HOLIDAY]: 1,
      });
      expect(rangePercentage(counts, 8)).toBe(42.86);
      // …and agrees with `summarize`, which is the whole point.
      expect(summarize(counts, 8).percentage).toBe(42.86);
    });

    it('drops a converted holiday from the denominator', () => {
      const counts = c({
        [AttendanceStatus.PRESENT]: 1,
        [AttendanceStatus.HOLIDAY]: 1,
      });
      expect(rangePercentage(counts, 2)).toBe(100);
    });

    it('is 0 when the window holds no working days', () => {
      expect(rangePercentage(c({ [AttendanceStatus.PRESENT]: 1 }), 0)).toBe(0);
    });
  });

  describe('cohortPercentage — a section over a window', () => {
    it('divides by working days × heads', () => {
      // 2 students, 7 working days, 6 present-days between them.
      expect(
        cohortPercentage(
          c({ [AttendanceStatus.PRESENT]: 6, [AttendanceStatus.ABSENT]: 2 }),
          7,
          2,
        ),
      ).toBe(42.86);
    });

    it('cannot exceed 100% when the section holds many students', () => {
      // The bug this shape guards: dividing a whole section's present-days by
      // working days alone gave 300% for three fully-present students.
      expect(
        cohortPercentage(c({ [AttendanceStatus.PRESENT]: 15 }), 5, 3),
      ).toBe(100);
    });

    it('is 0 for an empty section rather than dividing by zero', () => {
      expect(cohortPercentage(c({ [AttendanceStatus.PRESENT]: 0 }), 5, 0)).toBe(0);
    });
  });
});
