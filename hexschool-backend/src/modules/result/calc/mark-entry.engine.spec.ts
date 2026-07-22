import {
  allocatedComponents,
  resolveTotal,
  validateMark,
} from './mark-entry.engine';
import { PaperSpec } from './subject-result.engine';

const flat: PaperSpec = {
  examSubjectId: 'es-1',
  subjectId: 'sub-1',
  subjectName: 'Bangla',
  classId: 'cls-1',
  fullMarks: 100,
  passMarks: 33,
  componentMarks: {},
  componentPassMarks: {},
  isOptional: false,
};

const split: PaperSpec = {
  ...flat,
  examSubjectId: 'es-2',
  subjectName: 'Physics',
  componentMarks: { cq: 75, practical: 25 },
  componentPassMarks: { practical: 10 },
};

const entry = (over: Record<string, unknown> = {}) => ({
  enrollmentId: 'en-1',
  ...over,
});

describe('mark-entry engine', () => {
  it('knows which components a paper allocates', () => {
    expect(allocatedComponents(flat)).toEqual([]);
    expect(allocatedComponents(split)).toEqual(['cq', 'practical']);
  });

  describe('resolveTotal', () => {
    it('takes the typed number on a flat paper', () => {
      expect(resolveTotal(flat, entry({ total: 67 }))).toBe(67);
    });

    it('derives the total from the components on a split paper', () => {
      expect(resolveTotal(split, entry({ cq: 60, practical: 20 }))).toBe(80);
    });

    it('is zero for an absent candidate whatever was typed', () => {
      expect(resolveTotal(flat, entry({ total: 90, isAbsent: true }))).toBe(0);
    });
  });

  describe('validateMark', () => {
    it('accepts a valid flat entry', () => {
      expect(validateMark(flat, entry({ total: 67 }))).toEqual([]);
    });

    it('refuses a mark above the paper total', () => {
      const errors = validateMark(flat, entry({ total: 101 }));
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toMatch(/exceeds the paper's 100 marks/);
    });

    it('refuses a component above its own allocation', () => {
      // The bound the DB cannot see: 26 is under the paper's 100 but over
      // the practical's 25.
      const errors = validateMark(split, entry({ cq: 70, practical: 26 }));
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('practical');
      expect(errors[0].message).toMatch(/exceeds its 25 marks/);
    });

    it('refuses a component the paper does not allocate', () => {
      const errors = validateMark(split, entry({ cq: 70, mcq: 5 }));
      expect(errors[0].message).toMatch(/allocates no MCQ marks/);
    });

    it('refuses more than two decimal places', () => {
      expect(validateMark(flat, entry({ total: 67.555 }))[0].field).toBe(
        'total',
      );
    });

    it('refuses negative marks', () => {
      expect(validateMark(flat, entry({ total: -1 }))[0].message).toMatch(
        /0 or more/,
      );
    });

    it('requires a mark or the absent flag', () => {
      expect(validateMark(flat, entry())[0].message).toMatch(
        /Enter a mark or tick absent/,
      );
    });

    it('refuses marks alongside the absent flag', () => {
      const errors = validateMark(flat, entry({ isAbsent: true, total: 40 }));
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('isAbsent');
    });

    it('accepts a clean absence', () => {
      expect(validateMark(split, entry({ isAbsent: true }))).toEqual([]);
    });

    it('refuses a client-supplied total that disagrees with the parts', () => {
      const errors = validateMark(
        split,
        entry({ cq: 60, practical: 20, total: 90 }),
      );
      expect(errors[0].message).toMatch(/derived from the components \(80\)/);
    });

    it('reports every bad cell at once so the grid can paint them', () => {
      const errors = validateMark(split, entry({ cq: 80, practical: 30 }));
      expect(errors).toHaveLength(2);
      expect(errors.map((e) => e.field)).toEqual(['cq', 'practical']);
    });
  });
});
