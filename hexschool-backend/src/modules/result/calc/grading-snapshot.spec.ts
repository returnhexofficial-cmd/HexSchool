import {
  failBand,
  gradeForGpa,
  gradeForPercentage,
  GradingSnapshot,
  maxGradePoint,
  parseGradingSnapshot,
  round2,
} from './grading-snapshot';

/** The NCTB Standard scale Module 04 seeds — the fixture every suite uses. */
export const NCTB: GradingSnapshot = {
  gradingSystemId: 'gs-1',
  name: 'NCTB Standard',
  frozenAt: '2026-07-22T00:00:00.000Z',
  gradePoints: [
    { grade: 'F', point: 0, minMark: 0, maxMark: 32 },
    { grade: 'D', point: 1, minMark: 33, maxMark: 39 },
    { grade: 'C', point: 2, minMark: 40, maxMark: 49 },
    { grade: 'B', point: 3, minMark: 50, maxMark: 59 },
    { grade: 'A-', point: 3.5, minMark: 60, maxMark: 69 },
    { grade: 'A', point: 4, minMark: 70, maxMark: 79 },
    { grade: 'A+', point: 5, minMark: 80, maxMark: 100 },
  ],
};

describe('grading snapshot', () => {
  describe('parseGradingSnapshot', () => {
    it('reads the blob Module 14 freezes onto an exam', () => {
      const parsed = parseGradingSnapshot({
        gradingSystemId: 'gs-1',
        name: 'NCTB Standard',
        frozenAt: '2026-07-22T00:00:00.000Z',
        gradePoints: [
          { grade: 'A+', point: '5.00', minMark: 80, maxMark: 100 },
          { grade: 'F', point: '0.00', minMark: 0, maxMark: 32 },
        ],
      });

      expect(parsed.name).toBe('NCTB Standard');
      // Sorted ascending by floor regardless of the stored order.
      expect(parsed.gradePoints.map((b) => b.grade)).toEqual(['F', 'A+']);
      expect(parsed.gradePoints[1].point).toBe(5);
    });

    it('refuses a snapshot that cannot grade anything', () => {
      expect(() => parseGradingSnapshot(null)).toThrow(/missing/i);
      expect(() => parseGradingSnapshot({ gradePoints: [] })).toThrow(
        /no grade bands/i,
      );
      expect(() =>
        parseGradingSnapshot({ gradePoints: [{ grade: 'A' }] }),
      ).toThrow(/incomplete/i);
    });
  });

  describe('gradeForPercentage', () => {
    it.each([
      [100, 'A+'],
      [80, 'A+'],
      [79.99, 'A'],
      [70, 'A'],
      [60, 'A-'],
      [50, 'B'],
      [40, 'C'],
      [33, 'D'],
      [32, 'F'],
      [0, 'F'],
    ])('%s%% → %s', (percentage, grade) => {
      expect(gradeForPercentage(NCTB, percentage).grade).toBe(grade);
    });

    it('does not round a fractional near-miss up into a pass', () => {
      // The gap between the F band's 32 ceiling and D's 33 floor is where
      // a `min <= p <= max` lookup would return nothing at all.
      expect(gradeForPercentage(NCTB, 32.5).grade).toBe('F');
      expect(gradeForPercentage(NCTB, 32.99).grade).toBe('F');
    });

    it('clamps outside 0–100 rather than returning undefined', () => {
      expect(gradeForPercentage(NCTB, -5).grade).toBe('F');
      expect(gradeForPercentage(NCTB, 140).grade).toBe('A+');
      expect(gradeForPercentage(NCTB, Number.NaN).grade).toBe('F');
    });
  });

  describe('gradeForGpa', () => {
    it.each([
      [5, 'A+'],
      [4.83, 'A'],
      [4, 'A'],
      [3.75, 'A-'],
      [3, 'B'],
      [2.5, 'C'],
      [1, 'D'],
      [0, 'F'],
    ])('GPA %s → %s', (gpa, grade) => {
      expect(gradeForGpa(NCTB, gpa).grade).toBe(grade);
    });
  });

  it('finds the failing band and the ceiling from the scale itself', () => {
    expect(failBand(NCTB).grade).toBe('F');
    expect(failBand(NCTB).point).toBe(0);
    expect(maxGradePoint(NCTB)).toBe(5);
  });

  it('rounds to two decimals without float drift', () => {
    expect(round2(4.005)).toBe(4.01);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});
