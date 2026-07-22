import { ResultStatus } from '../../../common/constants';
import { aggregate } from './gpa.engine';
import { NCTB } from './grading-snapshot.spec';
import { SubjectOutcome } from './subject-result.engine';

const options = { optionalBonusBase: 2 };

let counter = 0;
const subject = (
  gradePoint: number,
  over: Partial<SubjectOutcome> = {},
): SubjectOutcome => {
  counter += 1;
  return {
    examSubjectId: `es-${counter}`,
    subjectId: `sub-${counter}`,
    subjectName: `Subject ${counter}`,
    isOptional: false,
    absent: false,
    missing: false,
    fullMarks: 100,
    passMarks: 33,
    rawMarks: 80,
    graceApplied: 0,
    obtained: 80,
    percentage: 80,
    grade: 'A+',
    gradePoint,
    passed: gradePoint > 0,
    failedComponents: [],
    ...over,
  };
};

describe('GPA engine (NCTB)', () => {
  it('averages grade points, not marks', () => {
    // 79 and 80 are one whole grade apart — averaging percentages would
    // hide that, which is why the mean is over points.
    const result = aggregate(
      [subject(4), subject(5), subject(5), subject(4)],
      NCTB,
      options,
    );

    expect(result.gpa).toBe(4.5);
    expect(result.grade).toBe('A');
    expect(result.status).toBe(ResultStatus.PASSED);
  });

  it('adds only the 4th subject points ABOVE the bonus base', () => {
    const compulsory = [subject(5), subject(5), subject(5), subject(5)];
    const withOptional = aggregate(
      [...compulsory, subject(4, { isOptional: true })],
      NCTB,
      options,
    );

    // (20 + max(0, 4 - 2)) / 4 = 5.5, capped at the scale's ceiling.
    expect(withOptional.gpa).toBe(5);
    expect(withOptional.gpaWithoutOptional).toBe(5);
  });

  it('keeps the compulsory count as the divisor', () => {
    const result = aggregate(
      [
        subject(4),
        subject(4),
        subject(4),
        subject(4),
        subject(5, { isOptional: true }),
      ],
      NCTB,
      options,
    );

    // (16 + 3) / 4 = 4.75 — NOT 21/5 = 4.2.
    expect(result.gpa).toBe(4.75);
    expect(result.gpaWithoutOptional).toBe(4);
    expect(result.grade).toBe('A');
  });

  it('gives no bonus for an optional graded at or below the base', () => {
    const result = aggregate(
      [subject(4), subject(4), subject(2, { isOptional: true })],
      NCTB,
      options,
    );

    expect(result.gpa).toBe(4);
    expect(result.gpaWithoutOptional).toBe(4);
  });

  it('never lets a failed optional subject fail the candidate', () => {
    const result = aggregate(
      [
        subject(4),
        subject(4),
        subject(0, { isOptional: true, passed: false, grade: 'F' }),
      ],
      NCTB,
      options,
    );

    expect(result.status).toBe(ResultStatus.PASSED);
    expect(result.gpa).toBe(4);
    // It still counts as a failed subject on the report card.
    expect(result.failedSubjects).toBe(1);
  });

  it('fails the whole exam on one compulsory F, with GPA 0.00', () => {
    const result = aggregate(
      [subject(5), subject(5), subject(0, { passed: false, grade: 'F' })],
      NCTB,
      options,
    );

    expect(result.status).toBe(ResultStatus.FAILED);
    // Not the arithmetic mean of 10/3 — the board prints 0.00.
    expect(result.gpa).toBe(0);
    expect(result.gpaWithoutOptional).toBe(0);
    expect(result.grade).toBe('F');
    expect(result.failedSubjects).toBe(1);
  });

  it('reports INCOMPLETE rather than guessing at a missing paper', () => {
    const result = aggregate(
      [subject(5), subject(5, { missing: true, passed: false, obtained: 0 })],
      NCTB,
      options,
    );

    expect(result.status).toBe(ResultStatus.INCOMPLETE);
    expect(result.gpa).toBe(0);
    expect(result.missingSubjects).toHaveLength(1);
  });

  it('reports INCOMPLETE when nothing compulsory was sat', () => {
    const result = aggregate([subject(5, { isOptional: true })], NCTB, options);
    expect(result.status).toBe(ResultStatus.INCOMPLETE);
  });

  it('totals marks across every subject including the optional', () => {
    const result = aggregate(
      [
        subject(5, { obtained: 90, fullMarks: 100 }),
        subject(4, { obtained: 75, fullMarks: 100 }),
        subject(5, { isOptional: true, obtained: 85, fullMarks: 100 }),
      ],
      NCTB,
      options,
    );

    expect(result.totalMarks).toBe(300);
    expect(result.obtainedMarks).toBe(250);
    expect(result.subjectsCount).toBe(3);
  });

  it('produces the classic 4.83 an A+/A mix earns', () => {
    // Five A+ and one A over six compulsory subjects: 29/6 = 4.83.
    const result = aggregate(
      [subject(5), subject(5), subject(5), subject(5), subject(5), subject(4)],
      NCTB,
      options,
    );

    expect(result.gpa).toBe(4.83);
    expect(result.grade).toBe('A');
  });
});
