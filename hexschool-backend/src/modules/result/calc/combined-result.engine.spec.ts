import { ResultStatus } from '../../../common/constants';
import {
  CombinedComponent,
  combine,
  weightError,
} from './combined-result.engine';
import { NCTB } from './grading-snapshot.spec';

const part = (over: Partial<CombinedComponent> = {}): CombinedComponent => ({
  examId: 'ex-1',
  examName: 'Half-Yearly',
  weight: 50,
  gpa: 4,
  obtainedMarks: 700,
  totalMarks: 1000,
  status: ResultStatus.PASSED,
  ...over,
});

describe('combined-result engine', () => {
  describe('weightError', () => {
    it('accepts a set summing to 100', () => {
      expect(weightError([30, 70])).toBeNull();
      expect(weightError([100])).toBeNull();
      expect(weightError([33.33, 33.33, 33.34])).toBeNull();
    });

    it('reports the deviation so the UI can show it', () => {
      expect(weightError([30, 60])).toMatch(/sum to 90/);
      expect(weightError([])).toMatch(/at least one/i);
      expect(weightError([50, -50])).toMatch(/positive/i);
    });
  });

  it('weights the GPAs the exams already published', () => {
    const outcome = combine(
      [
        part({ examId: 'hy', weight: 30, gpa: 4 }),
        part({ examId: 'an', weight: 70, gpa: 5 }),
      ],
      NCTB,
    );

    // 0.3 × 4 + 0.7 × 5 = 4.70
    expect(outcome.gpa).toBe(4.7);
    expect(outcome.grade).toBe('A');
    expect(outcome.status).toBe(ResultStatus.PASSED);
  });

  it('normalises exams with different full marks to a percentage', () => {
    const outcome = combine(
      [
        part({ weight: 50, obtainedMarks: 500, totalMarks: 1000 }), // 50 %
        part({ weight: 50, obtainedMarks: 1200, totalMarks: 1500 }), // 80 %
      ],
      NCTB,
    );

    expect(outcome.obtainedMarks).toBe(65);
    expect(outcome.totalMarks).toBe(100);
  });

  it('fails the merge when any component failed', () => {
    const outcome = combine(
      [part({ weight: 50 }), part({ weight: 50, status: ResultStatus.FAILED })],
      NCTB,
    );

    expect(outcome.status).toBe(ResultStatus.FAILED);
    expect(outcome.gpa).toBe(0);
    expect(outcome.grade).toBe('F');
  });

  it('propagates INCOMPLETE and WITHHELD, worst first', () => {
    expect(
      combine([part(), part({ status: ResultStatus.INCOMPLETE })], NCTB).status,
    ).toBe(ResultStatus.INCOMPLETE);

    expect(
      combine(
        [
          part({ status: ResultStatus.FAILED }),
          part({ status: ResultStatus.WITHHELD }),
        ],
        NCTB,
      ).status,
    ).toBe(ResultStatus.WITHHELD);
  });

  it('keeps the component breakdown for the audit trail', () => {
    const outcome = combine([part({ examName: 'Half-Yearly' })], NCTB);
    expect(outcome.components[0].examName).toBe('Half-Yearly');
  });

  it('reports INCOMPLETE when there is nothing to merge', () => {
    expect(combine([], NCTB).status).toBe(ResultStatus.INCOMPLETE);
  });
});
