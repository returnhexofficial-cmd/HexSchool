import {
  componentTotal,
  defaultDistribution,
  isSplit,
  MarkDistribution,
  usedComponents,
  validateDistribution,
} from './mark-distribution';

/** Roadmap M14 §6/§9: "pass ≤ full; components sum = full when used". */
describe('mark distribution', () => {
  const flat = (over: Partial<MarkDistribution> = {}): MarkDistribution => ({
    fullMarks: 100,
    passMarks: 33,
    ...over,
  });

  const fields = (d: MarkDistribution): string[] =>
    validateDistribution(d).map((e) => e.field);

  describe('flat papers', () => {
    it('accepts a plain full/pass pair', () => {
      expect(validateDistribution(flat())).toEqual([]);
      expect(isSplit(flat())).toBe(false);
      expect(componentTotal(flat())).toBe(0);
    });

    it('refuses pass marks above full marks', () => {
      expect(fields(flat({ passMarks: 120 }))).toContain('passMarks');
    });

    it('accepts pass marks exactly equal to full marks', () => {
      // A 20-mark practical where every candidate must score 20 is odd but
      // legal — the boundary must not be off-by-one.
      expect(
        validateDistribution(flat({ fullMarks: 20, passMarks: 20 })),
      ).toEqual([]);
    });

    it('refuses non-positive or fractional full marks', () => {
      expect(fields(flat({ fullMarks: 0 }))).toContain('fullMarks');
      expect(fields(flat({ fullMarks: -10 }))).toContain('fullMarks');
      expect(fields(flat({ fullMarks: 50.5 }))).toContain('fullMarks');
    });
  });

  describe('split papers', () => {
    it('accepts components that add up to full marks', () => {
      const d = flat({ cqMarks: 70, mcqMarks: 30 });
      expect(validateDistribution(d)).toEqual([]);
      expect(isSplit(d)).toBe(true);
      expect(componentTotal(d)).toBe(100);
      expect(usedComponents(d)).toEqual(['cq', 'mcq']);
    });

    it('refuses components that do NOT add up — the classic 90-of-100 slip', () => {
      const errors = validateDistribution(flat({ cqMarks: 60, mcqMarks: 30 }));
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('components');
      expect(errors[0].message).toContain('= 90');
      expect(errors[0].message).toContain('expected 100');
    });

    it('counts all four components including practical and CA', () => {
      const d = flat({
        cqMarks: 40,
        mcqMarks: 30,
        practicalMarks: 20,
        caMarks: 10,
      });
      expect(validateDistribution(d)).toEqual([]);
      expect(usedComponents(d)).toEqual(['cq', 'mcq', 'practical', 'ca']);
    });

    it('treats a zero-mark component as present, not absent', () => {
      // 0 is a real allocation ("MCQ exists but carries no weight this
      // term") and must not be read as "flat paper" by a falsy check.
      const d = flat({ cqMarks: 100, mcqMarks: 0 });
      expect(isSplit(d)).toBe(true);
      expect(usedComponents(d)).toEqual(['cq', 'mcq']);
      expect(validateDistribution(d)).toEqual([]);
    });

    it('refuses a negative component', () => {
      expect(fields(flat({ cqMarks: -1, mcqMarks: 101 }))).toContain('cqMarks');
    });
  });

  describe('per-component pass thresholds', () => {
    it('accepts a practical that must be passed on its own', () => {
      const d = flat({
        cqMarks: 75,
        practicalMarks: 25,
        practicalPassMarks: 10,
      });
      expect(validateDistribution(d)).toEqual([]);
    });

    it('refuses a pass threshold on a component with no marks', () => {
      expect(fields(flat({ practicalPassMarks: 10 }))).toContain(
        'practicalPassMarks',
      );
    });

    it('refuses a threshold above its own component', () => {
      const errors = validateDistribution(
        flat({ cqMarks: 75, practicalMarks: 25, practicalPassMarks: 30 }),
      );
      expect(errors.map((e) => e.field)).toEqual(['practicalPassMarks']);
      expect(errors[0].message).toContain('cannot exceed its 25 marks');
    });
  });

  it('reports every violation at once so a bulk grid can show all bad rows', () => {
    const errors = validateDistribution({
      fullMarks: 100,
      passMarks: 200,
      cqMarks: 10,
      practicalPassMarks: 5,
    });
    expect(errors.map((e) => e.field).sort()).toEqual([
      'components',
      'passMarks',
      'practicalPassMarks',
    ]);
  });

  describe('defaults seeded into the wizard grid', () => {
    it('leaves a theory subject flat', () => {
      expect(defaultDistribution(100, 33, false)).toEqual({
        fullMarks: 100,
        passMarks: 33,
      });
    });

    it('splits a practical subject 75/25 and the split still validates', () => {
      const d = defaultDistribution(100, 33, true);
      expect(d).toMatchObject({ cqMarks: 75, practicalMarks: 25 });
      expect(validateDistribution(d)).toEqual([]);
    });

    it('keeps the split summing to full marks for odd totals', () => {
      const d = defaultDistribution(50, 17, true);
      expect(componentTotal(d)).toBe(50);
      expect(validateDistribution(d)).toEqual([]);
    });
  });
});
