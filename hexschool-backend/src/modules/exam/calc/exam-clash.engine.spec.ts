import {
  ClashOptions,
  clock,
  detectClashes,
  Sitting,
  splitByOverridability,
} from './exam-clash.engine';

/** Roadmap M14 §4: routine clash checks (same-day rule, room double-booking). */
describe('exam clash engine', () => {
  const OPTIONS: ClashOptions = {
    checkRooms: true,
    allowMultiplePapersPerDay: false,
    window: { startDate: '2026-06-01', endDate: '2026-06-15' },
  };

  const sitting = (over: Partial<Sitting> = {}): Sitting => ({
    examSubjectId: 'es-1',
    examId: 'exam-1',
    classId: 'class-7',
    classLabel: 'Class 7',
    subjectId: 'sub-bangla',
    subjectName: 'Bangla',
    date: '2026-06-02',
    startMinutes: 600, // 10:00
    endMinutes: 780, // 13:00
    room: 'H1',
    ...over,
  });

  const kinds = (list: ReturnType<typeof detectClashes>): string[] =>
    list.map((c) => c.kind).sort();

  it('accepts a clean routine', () => {
    const clashes = detectClashes(
      [
        sitting(),
        sitting({
          examSubjectId: 'es-2',
          subjectId: 'sub-eng',
          subjectName: 'English',
          date: '2026-06-04',
        }),
      ],
      [],
      OPTIONS,
    );
    expect(clashes).toEqual([]);
  });

  describe('a class cannot be in two halls at once', () => {
    it('flags overlapping sittings of the same class', () => {
      const clashes = detectClashes(
        [
          sitting(),
          sitting({
            examSubjectId: 'es-2',
            subjectId: 'sub-eng',
            subjectName: 'English',
            startMinutes: 660,
            endMinutes: 840,
            room: 'H2',
          }),
        ],
        [],
        OPTIONS,
      );
      expect(kinds(clashes)).toContain('CLASS_OVERLAP');
    });

    it('does NOT flag back-to-back sittings that merely touch', () => {
      // 10:00–13:00 then 13:00–15:00 is a legal double sitting.
      const clashes = detectClashes(
        [
          sitting(),
          sitting({
            examSubjectId: 'es-2',
            subjectId: 'sub-eng',
            subjectName: 'English',
            startMinutes: 780,
            endMinutes: 900,
            room: 'H2',
          }),
        ],
        [],
        { ...OPTIONS, allowMultiplePapersPerDay: true },
      );
      expect(clashes).toEqual([]);
    });
  });

  describe('same-day policy', () => {
    it('flags two papers for one class on one day when the policy is off', () => {
      const clashes = detectClashes(
        [
          sitting(),
          sitting({
            examSubjectId: 'es-2',
            subjectId: 'sub-eng',
            subjectName: 'English',
            startMinutes: 840,
            endMinutes: 960,
            room: 'H2',
          }),
        ],
        [],
        OPTIONS,
      );
      expect(kinds(clashes)).toEqual(['CLASS_SAME_DAY']);
    });

    it('reports the pair once, not once per direction', () => {
      const clashes = detectClashes(
        [
          sitting(),
          sitting({
            examSubjectId: 'es-2',
            subjectId: 'sub-eng',
            subjectName: 'English',
            startMinutes: 840,
            endMinutes: 960,
            room: 'H2',
          }),
        ],
        [],
        OPTIONS,
      );
      expect(clashes.filter((c) => c.kind === 'CLASS_SAME_DAY')).toHaveLength(
        1,
      );
    });

    /**
     * Regression: the pair used to be de-duplicated by comparing the two
     * `examSubjectId`s, which dropped the clash entirely whenever they
     * sorted descending. Real ids are UUIDs, so that silently disabled
     * the same-day policy on roughly half of all saves. Every other case
     * in this file happens to list `es-1` before `es-2`, which is exactly
     * why it went unnoticed.
     */
    it('flags the pair regardless of the order the ids sort in', () => {
      const clashes = detectClashes(
        [
          sitting({ examSubjectId: 'es-9' }),
          sitting({
            examSubjectId: 'es-2',
            subjectId: 'sub-eng',
            subjectName: 'English',
            startMinutes: 840,
            endMinutes: 960,
            room: 'H2',
          }),
        ],
        [],
        OPTIONS,
      );
      expect(clashes.filter((c) => c.kind === 'CLASS_SAME_DAY')).toHaveLength(
        1,
      );
    });

    it('stays quiet when the school allows multiple papers per day', () => {
      const clashes = detectClashes(
        [
          sitting(),
          sitting({
            examSubjectId: 'es-2',
            subjectId: 'sub-eng',
            subjectName: 'English',
            startMinutes: 840,
            endMinutes: 960,
            room: 'H2',
          }),
        ],
        [],
        { ...OPTIONS, allowMultiplePapersPerDay: true },
      );
      expect(clashes).toEqual([]);
    });

    it('never applies across different classes', () => {
      const clashes = detectClashes(
        [
          sitting(),
          sitting({
            examSubjectId: 'es-2',
            classId: 'class-8',
            classLabel: 'Class 8',
            room: 'H2',
          }),
        ],
        [],
        OPTIONS,
      );
      expect(clashes).toEqual([]);
    });
  });

  describe('room double-booking', () => {
    it('flags two classes in one room at overlapping times', () => {
      const clashes = detectClashes(
        [sitting()],
        [
          sitting({
            examSubjectId: 'es-9',
            classId: 'class-8',
            classLabel: 'Class 8',
            startMinutes: 660,
            endMinutes: 900,
          }),
        ],
        OPTIONS,
      );
      expect(kinds(clashes)).toEqual(['ROOM']);
      expect(clashes[0].message).toContain('Class 8');
    });

    it('matches room names case- and whitespace-insensitively', () => {
      const clashes = detectClashes(
        [sitting({ room: ' h1 ' })],
        [
          sitting({
            examSubjectId: 'es-9',
            classId: 'class-8',
            classLabel: 'Class 8',
            room: 'H1',
          }),
        ],
        OPTIONS,
      );
      expect(kinds(clashes)).toEqual(['ROOM']);
    });

    it('never treats two unroomed sittings as sharing a room', () => {
      const clashes = detectClashes(
        [sitting({ room: null })],
        [
          sitting({
            examSubjectId: 'es-9',
            classId: 'class-8',
            classLabel: 'Class 8',
            room: null,
          }),
        ],
        OPTIONS,
      );
      expect(clashes).toEqual([]);
    });

    it('respects the exam.room_conflict_check switch', () => {
      const clashes = detectClashes(
        [sitting()],
        [
          sitting({
            examSubjectId: 'es-9',
            classId: 'class-8',
            classLabel: 'Class 8',
          }),
        ],
        { ...OPTIONS, checkRooms: false },
      );
      expect(clashes).toEqual([]);
    });

    it('catches a room clash against ANOTHER exam of the session', () => {
      // The competing sitting belongs to a different exam — rooms are a
      // school-wide resource, not an exam-local one.
      const clashes = detectClashes(
        [sitting()],
        [
          sitting({
            examId: 'exam-2',
            examSubjectId: 'es-other',
            classId: 'class-9',
            classLabel: 'Class 9',
          }),
        ],
        OPTIONS,
      );
      expect(kinds(clashes)).toEqual(['ROOM']);
    });
  });

  describe('exam window', () => {
    it('flags a sitting before the exam starts', () => {
      const clashes = detectClashes(
        [sitting({ date: '2026-05-30' })],
        [],
        OPTIONS,
      );
      expect(kinds(clashes)).toEqual(['OUTSIDE_WINDOW']);
    });

    it('flags a sitting after the exam ends', () => {
      const clashes = detectClashes(
        [sitting({ date: '2026-06-20' })],
        [],
        OPTIONS,
      );
      expect(kinds(clashes)).toEqual(['OUTSIDE_WINDOW']);
    });

    it('accepts the boundary dates themselves', () => {
      const clashes = detectClashes(
        [
          sitting({ date: '2026-06-01' }),
          sitting({
            examSubjectId: 'es-2',
            classId: 'class-8',
            classLabel: 'Class 8',
            date: '2026-06-15',
            room: 'H2',
          }),
        ],
        [],
        OPTIONS,
      );
      expect(clashes).toEqual([]);
    });
  });

  it('flags the same paper scheduled twice in one payload', () => {
    const clashes = detectClashes(
      [
        sitting({ examSubjectId: null }),
        sitting({ examSubjectId: null, date: '2026-06-05' }),
      ],
      [],
      OPTIONS,
    );
    expect(kinds(clashes)).toContain('DUPLICATE_PAPER');
  });

  describe('override tiers', () => {
    it('makes only the same-day policy waivable', () => {
      const clashes = detectClashes(
        [
          sitting(),
          sitting({
            examSubjectId: 'es-2',
            subjectId: 'sub-eng',
            subjectName: 'English',
            startMinutes: 840,
            endMinutes: 960,
            room: 'H2',
          }),
        ],
        [
          sitting({
            examSubjectId: 'es-9',
            classId: 'class-8',
            classLabel: 'Class 8',
          }),
        ],
        OPTIONS,
      );
      const { structural, waivable } = splitByOverridability(clashes);
      expect(waivable.map((c) => c.kind)).toEqual(['CLASS_SAME_DAY']);
      expect(structural.map((c) => c.kind)).toContain('ROOM');
    });

    it('never lets a physical impossibility be waived', () => {
      const clashes = detectClashes(
        [sitting({ date: '2026-07-01' })],
        [],
        OPTIONS,
      );
      expect(splitByOverridability(clashes).waivable).toEqual([]);
    });
  });

  it('formats minutes as a wall clock for the messages', () => {
    expect(clock(600)).toBe('10:00');
    expect(clock(0)).toBe('00:00');
    expect(clock(1439)).toBe('23:59');
  });
});
