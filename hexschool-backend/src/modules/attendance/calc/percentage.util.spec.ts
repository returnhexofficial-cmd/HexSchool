import { AttendanceStatus } from '../../../common/constants';
import {
  countByStatus,
  emptyCounts,
  presentEquivalent,
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
