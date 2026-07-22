import { rank, rankScopes, Rankable } from './merit.engine';

const row = (
  key: string,
  gpa: number,
  obtainedMarks: number,
  rollNo: number,
): Rankable => ({ key, gpa, obtainedMarks, rollNo });

describe('merit engine', () => {
  it('ranks by GPA, then by obtained marks', () => {
    const positions = rank([
      row('a', 4.5, 800, 3),
      row('b', 5, 900, 7),
      row('c', 4.5, 850, 1),
    ]);

    expect(positions.get('b')).toBe(1);
    expect(positions.get('c')).toBe(2);
    expect(positions.get('a')).toBe(3);
  });

  it('shares a position and skips the next (1, 2, 2, 4)', () => {
    const positions = rank([
      row('a', 5, 900, 1),
      row('b', 4.5, 850, 2),
      row('c', 4.5, 850, 3),
      row('d', 4, 800, 4),
    ]);

    expect([...positions.values()]).toEqual(
      expect.arrayContaining([1, 2, 2, 4]),
    );
    expect(positions.get('b')).toBe(2);
    expect(positions.get('c')).toBe(2);
    expect(positions.get('d')).toBe(4);
  });

  it('separates a full tie outright under ROLL_ASC', () => {
    const positions = rank(
      [row('a', 4.5, 850, 9), row('b', 4.5, 850, 2)],
      'ROLL_ASC',
    );

    expect(positions.get('b')).toBe(1);
    expect(positions.get('a')).toBe(2);
  });

  it('orders by roll but still shares the position under NONE', () => {
    // The roll decides the display order; whether it also separates the
    // two students is the school's policy, and NONE says it does not.
    const positions = rank([row('a', 4.5, 850, 9), row('b', 4.5, 850, 2)]);

    expect(positions.get('a')).toBe(1);
    expect(positions.get('b')).toBe(1);
  });

  it('is stable for a single candidate and for none at all', () => {
    expect(rank([]).size).toBe(0);
    expect(rank([row('a', 5, 900, 1)]).get('a')).toBe(1);
  });

  describe('rankScopes', () => {
    it('gives a student a section rank and a different class rank', () => {
      const positions = rankScopes([
        { ...row('a', 5, 900, 1), sectionId: 'sec-1', classId: 'cls-1' },
        { ...row('b', 4.5, 850, 2), sectionId: 'sec-1', classId: 'cls-1' },
        { ...row('c', 4.8, 880, 1), sectionId: 'sec-2', classId: 'cls-1' },
      ]);

      // 'c' tops its own section but sits second in the class.
      expect(positions.get('c')).toEqual({ section: 1, class: 2 });
      expect(positions.get('a')).toEqual({ section: 1, class: 1 });
      expect(positions.get('b')).toEqual({ section: 2, class: 3 });
    });
  });
});
