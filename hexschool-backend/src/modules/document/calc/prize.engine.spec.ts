import {
  ordinal,
  selectPrizeWinners,
  type PrizeCandidate,
} from './prize.engine';

const candidate = (over: Partial<PrizeCandidate>): PrizeCandidate => ({
  enrollmentId: 'e-1',
  studentId: 's-1',
  classId: 'c-9',
  className: 'Class 9',
  studentName: 'A',
  position: 1,
  gpa: 5,
  passed: true,
  ...over,
});

describe('prize.engine — selectPrizeWinners', () => {
  it('takes the top N of one class in order', () => {
    const result = selectPrizeWinners(
      [
        candidate({ studentName: 'Third', position: 3, gpa: 4.2 }),
        candidate({ studentName: 'First', position: 1, gpa: 5 }),
        candidate({ studentName: 'Second', position: 2, gpa: 4.7 }),
        candidate({ studentName: 'Fourth', position: 4, gpa: 4 }),
      ],
      3,
    );
    expect(result.total).toBe(3);
    expect(result.classes[0].winners.map((w) => w.studentName)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
    expect(result.classes[0].note).toBeNull();
  });

  it('cuts on POSITION, not on count, so a tie takes both students', () => {
    // The rule the whole engine turns on: 1, 2, 2, 4 with topN = 3 is
    // three students, and 1, 2, 2, 4 with topN = 2 is three — because
    // handing one of two tied students a prize is indefensible.
    const result = selectPrizeWinners(
      [
        candidate({ studentName: 'First', position: 1 }),
        candidate({ studentName: 'JointA', position: 2, gpa: 4.7 }),
        candidate({ studentName: 'JointB', position: 2, gpa: 4.7 }),
        candidate({ studentName: 'Fourth', position: 4 }),
      ],
      2,
    );
    expect(result.total).toBe(3);
    expect(result.classes[0].winners.map((w) => w.studentName)).toEqual([
      'First',
      'JointA',
      'JointB',
    ]);
    expect(result.classes[0].note).toContain('3 winners for a top-2 cut');
  });

  it('breaks a tie stably by GPA then name, so a re-run reproduces the list', () => {
    const rows = [
      candidate({ studentName: 'Zed', position: 2, gpa: 4.5 }),
      candidate({ studentName: 'Amin', position: 2, gpa: 4.5 }),
      candidate({ studentName: 'Bilal', position: 2, gpa: 4.9 }),
    ];
    const first = selectPrizeWinners(rows, 3);
    const second = selectPrizeWinners([...rows].reverse(), 3);
    expect(first.classes[0].winners.map((w) => w.studentName)).toEqual([
      'Bilal',
      'Amin',
      'Zed',
    ]);
    expect(second.classes[0].winners.map((w) => w.studentName)).toEqual(
      first.classes[0].winners.map((w) => w.studentName),
    );
  });

  it('excludes a failed candidate — a prize is for a passed result', () => {
    const result = selectPrizeWinners(
      [
        candidate({ studentName: 'Passed', position: 1 }),
        candidate({ studentName: 'Failed', position: 2, passed: false }),
      ],
      3,
    );
    expect(result.total).toBe(1);
    expect(result.classes[0].winners[0].studentName).toBe('Passed');
  });

  it('excludes an unranked candidate rather than sorting them last', () => {
    // A null position is INCOMPLETE, WITHHELD or unprocessed — printing a
    // prize for a student whose result is being held back is the mistake
    // nobody catches before the ceremony.
    const result = selectPrizeWinners(
      [
        candidate({ studentName: 'Ranked', position: 1 }),
        candidate({ studentName: 'Withheld', position: null }),
      ],
      3,
    );
    expect(result.total).toBe(1);
    expect(result.classes[0].winners[0].studentName).toBe('Ranked');
  });

  it('groups by class and sorts the groups by name', () => {
    const result = selectPrizeWinners(
      [
        candidate({ classId: 'c-10', className: 'Class 10', studentName: 'X' }),
        candidate({ classId: 'c-9', className: 'Class 9', studentName: 'Y' }),
      ],
      1,
    );
    expect(result.classes.map((c) => c.className)).toEqual([
      'Class 10',
      'Class 9',
    ]);
    expect(result.total).toBe(2);
  });

  it('skips a class where nobody is ranked, and says why', () => {
    const result = selectPrizeWinners(
      [
        candidate({ classId: 'c-9', className: 'Class 9', position: 1 }),
        candidate({
          classId: 'c-8',
          className: 'Class 8',
          position: null,
          studentName: 'Unranked',
        }),
      ],
      3,
    );
    expect(result.classes).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].className).toBe('Class 8');
    expect(result.skipped[0].reason).toContain('No ranked, passed candidate');
  });

  it('skips a class whose best position is outside the cut', () => {
    const result = selectPrizeWinners(
      [candidate({ className: 'Class 9', position: 7 })],
      3,
    );
    expect(result.classes).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('top 3');
  });

  it('treats a nonsensical topN as 1 rather than selecting nobody', () => {
    const rows = [
      candidate({ studentName: 'First', position: 1 }),
      candidate({ studentName: 'Second', position: 2 }),
    ];
    expect(selectPrizeWinners(rows, 0).total).toBe(1);
    expect(selectPrizeWinners(rows, -4).total).toBe(1);
    expect(selectPrizeWinners(rows, 2.9).total).toBe(2);
  });

  it('returns empty results for no candidates at all', () => {
    expect(selectPrizeWinners([], 3)).toEqual({
      classes: [],
      total: 0,
      skipped: [],
    });
  });
});

describe('prize.engine — ordinal', () => {
  it('handles the ordinary cases', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(22)).toBe('22nd');
    expect(ordinal(23)).toBe('23rd');
  });

  it('handles the teens, which is the case everybody gets wrong', () => {
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(111)).toBe('111th');
    expect(ordinal(112)).toBe('112th');
  });
});
