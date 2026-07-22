import { Weekday } from '../../../common/constants';
import { Booking, ConflictOptions, detectConflicts } from './conflict.engine';

/**
 * The conflict matrix the roadmap (M13 §9) asks for: same slot,
 * overlapping custom slots, cross-shift, plus the combined-class escape
 * hatch and the room/duplicate/daily-cap rules.
 */
describe('conflict engine', () => {
  const OPTIONS: ConflictOptions = {
    checkRooms: true,
    allowCombined: true,
    maxPeriodsPerTeacherPerDay: 0,
  };

  const booking = (overrides: Partial<Booking> = {}): Booking => ({
    timetableId: 'tt-a',
    sectionId: 'sec-a',
    sectionLabel: 'Class 7 — A',
    day: Weekday.SAT,
    slotId: 'slot-1',
    slotName: 'Period 1 08:00',
    startMinutes: 480,
    endMinutes: 525,
    teacherId: 'teacher-1',
    teacherName: 'Mr X',
    roomNo: null,
    combinedWithSectionId: null,
    ...overrides,
  });

  /** The same teacher, in another section, at the same minutes. */
  const rival = (overrides: Partial<Booking> = {}): Booking =>
    booking({
      timetableId: 'tt-b',
      sectionId: 'sec-b',
      sectionLabel: 'Class 7 — B',
      slotId: 'slot-9',
      ...overrides,
    });

  describe('teacher double-booking', () => {
    it('flags the same teacher in two sections at the same time', () => {
      const conflicts = detectConflicts([booking()], [rival()], OPTIONS);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].kind).toBe('TEACHER');
      expect(conflicts[0].message).toContain('Class 7 — B');
      expect(conflicts[0].clashesWith?.sectionId).toBe('sec-b');
    });

    it('flags PARTIALLY overlapping slots, not just identical ones', () => {
      const conflicts = detectConflicts(
        [booking()],
        [rival({ startMinutes: 500, endMinutes: 560 })],
        OPTIONS,
      );
      expect(conflicts.map((c) => c.kind)).toEqual(['TEACHER']);
    });

    it('flags a CROSS-SHIFT clash — the slot ids differ, the minutes do not', () => {
      // Morning "Period 4" and day-shift "Period 1" are different rows in
      // different bell schedules but the same wall clock: exactly the
      // part-time-teacher case an id comparison would miss.
      const conflicts = detectConflicts(
        [booking({ slotId: 'morning-p4' })],
        [rival({ slotId: 'day-p1', startMinutes: 490, endMinutes: 535 })],
        OPTIONS,
      );
      expect(conflicts.map((c) => c.kind)).toEqual(['TEACHER']);
    });

    it('allows back-to-back periods (half-open windows)', () => {
      const conflicts = detectConflicts(
        [booking()],
        [rival({ startMinutes: 525, endMinutes: 570 })],
        OPTIONS,
      );
      expect(conflicts).toHaveLength(0);
    });

    it('allows a different day at the same time', () => {
      const conflicts = detectConflicts(
        [booking()],
        [rival({ day: Weekday.SUN })],
        OPTIONS,
      );
      expect(conflicts).toHaveLength(0);
    });

    it('allows a different teacher in the same minutes', () => {
      const conflicts = detectConflicts(
        [booking()],
        [rival({ teacherId: 'teacher-2', teacherName: 'Ms Y' })],
        OPTIONS,
      );
      expect(conflicts).toHaveLength(0);
    });

    it('catches two CANDIDATES clashing inside one submission', () => {
      const conflicts = detectConflicts(
        [booking(), booking({ timetableId: 'tt-b', sectionId: 'sec-b' })],
        [],
        OPTIONS,
      );
      expect(conflicts.map((c) => c.kind)).toEqual(['TEACHER']);
    });

    it('reports a candidate pair once, not from both directions', () => {
      const conflicts = detectConflicts(
        [booking(), booking({ timetableId: 'tt-b', sectionId: 'sec-b' })],
        [],
        OPTIONS,
      );
      expect(conflicts).toHaveLength(1);
    });
  });

  describe('combined classes', () => {
    it('excuses a shared teacher when a section names the other', () => {
      const conflicts = detectConflicts(
        [booking({ combinedWithSectionId: 'sec-b' })],
        [rival()],
        OPTIONS,
      );
      expect(conflicts).toHaveLength(0);
    });

    it('accepts the marker from either side (one-sided is enough)', () => {
      const conflicts = detectConflicts(
        [booking()],
        [rival({ combinedWithSectionId: 'sec-a' })],
        OPTIONS,
      );
      expect(conflicts).toHaveLength(0);
    });

    it('does not excuse a marker pointing at an UNRELATED section', () => {
      const conflicts = detectConflicts(
        [booking({ combinedWithSectionId: 'sec-z' })],
        [rival()],
        OPTIONS,
      );
      expect(conflicts.map((c) => c.kind)).toEqual(['TEACHER']);
    });

    it('stops excusing anything when combined classes are disabled', () => {
      const conflicts = detectConflicts(
        [booking({ combinedWithSectionId: 'sec-b' })],
        [rival()],
        { ...OPTIONS, allowCombined: false },
      );
      expect(conflicts.map((c) => c.kind)).toEqual(['TEACHER']);
    });
  });

  describe('rooms', () => {
    it('flags two sections in one room at overlapping times', () => {
      const conflicts = detectConflicts(
        [booking({ roomNo: '101' })],
        [rival({ teacherId: 'teacher-2', teacherName: 'Ms Y', roomNo: '101' })],
        OPTIONS,
      );
      expect(conflicts.map((c) => c.kind)).toEqual(['ROOM']);
    });

    it('normalizes case and padding before comparing rooms', () => {
      const conflicts = detectConflicts(
        [booking({ roomNo: ' lab-a ' })],
        [
          rival({
            teacherId: 'teacher-2',
            teacherName: 'Ms Y',
            roomNo: 'LAB-A',
          }),
        ],
        OPTIONS,
      );
      expect(conflicts.map((c) => c.kind)).toEqual(['ROOM']);
    });

    it('ignores rooms entirely when the check is switched off', () => {
      const conflicts = detectConflicts(
        [booking({ roomNo: '101' })],
        [rival({ teacherId: 'teacher-2', teacherName: 'Ms Y', roomNo: '101' })],
        { ...OPTIONS, checkRooms: false },
      );
      expect(conflicts).toHaveLength(0);
    });

    it('never treats an unset room as a match', () => {
      const conflicts = detectConflicts(
        [booking({ roomNo: null })],
        [rival({ teacherId: 'teacher-2', teacherName: 'Ms Y', roomNo: null })],
        OPTIONS,
      );
      expect(conflicts).toHaveLength(0);
    });

    it('reports BOTH the teacher and the room clash for one cell', () => {
      const conflicts = detectConflicts(
        [booking({ roomNo: '101' })],
        [rival({ roomNo: '101' })],
        OPTIONS,
      );
      expect(conflicts.map((c) => c.kind).sort()).toEqual(['ROOM', 'TEACHER']);
    });
  });

  describe('duplicate cells', () => {
    it('names a payload that books one cell twice', () => {
      const conflicts = detectConflicts(
        [booking(), booking({ teacherId: 'teacher-2', teacherName: 'Ms Y' })],
        [],
        OPTIONS,
      );
      expect(conflicts.map((c) => c.kind)).toEqual(['DUPLICATE_CELL']);
    });

    it('allows the same slot on different days', () => {
      const conflicts = detectConflicts(
        [booking(), booking({ day: Weekday.SUN })],
        [],
        OPTIONS,
      );
      expect(conflicts).toHaveLength(0);
    });
  });

  describe('daily cap', () => {
    const threePeriods = (day: Weekday) =>
      [0, 1, 2].map((index) =>
        booking({
          day,
          slotId: `slot-${index}`,
          startMinutes: 480 + index * 60,
          endMinutes: 525 + index * 60,
        }),
      );

    it('is inert when the cap is 0 (unlimited)', () => {
      const conflicts = detectConflicts(threePeriods(Weekday.SAT), [], OPTIONS);
      expect(conflicts).toHaveLength(0);
    });

    it('flags a teacher over the cap, once per day', () => {
      const conflicts = detectConflicts(threePeriods(Weekday.SAT), [], {
        ...OPTIONS,
        maxPeriodsPerTeacherPerDay: 2,
      });
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].kind).toBe('TEACHER_DAILY_CAP');
      expect(conflicts[0].message).toContain('3 periods');
    });

    it('counts existing bookings in other sections toward the cap', () => {
      const conflicts = detectConflicts(
        [booking()],
        [
          rival({ startMinutes: 600, endMinutes: 645 }),
          rival({ slotId: 'slot-x', startMinutes: 660, endMinutes: 705 }),
        ],
        { ...OPTIONS, maxPeriodsPerTeacherPerDay: 2 },
      );
      expect(conflicts.map((c) => c.kind)).toContain('TEACHER_DAILY_CAP');
    });

    it('counts a combined class once — one teacher, one room, one period', () => {
      const conflicts = detectConflicts(
        [booking({ combinedWithSectionId: 'sec-b' })],
        [rival({ combinedWithSectionId: 'sec-a' })],
        { ...OPTIONS, maxPeriodsPerTeacherPerDay: 1 },
      );
      expect(conflicts).toHaveLength(0);
    });
  });

  it('returns nothing when the school is empty', () => {
    expect(detectConflicts([], [], OPTIONS)).toEqual([]);
  });
});
