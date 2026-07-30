import {
  bulkEvaluationIssues,
  evaluationIssues,
  returnIssues,
  roundMarks,
  type EvaluationContext,
} from './evaluation.engine';

const open: EvaluationContext = {
  fullMarks: 20,
  closed: false,
  mayEditLocked: false,
};

describe('roundMarks', () => {
  it('rounds to the two decimals the column stores', () => {
    expect(roundMarks(12.3456)).toBe(12.35);
    expect(roundMarks(12.344)).toBe(12.34);
  });
});

describe('evaluationIssues', () => {
  it('accepts a mark inside the range', () => {
    expect(evaluationIssues({ submissionId: 's1', marks: 17.5 }, open)).toEqual(
      [],
    );
  });

  it('accepts exactly full marks', () => {
    expect(evaluationIssues({ submissionId: 's1', marks: 20 }, open)).toEqual(
      [],
    );
  });

  it('refuses a mark above full marks — the bound a CHECK cannot see', () => {
    const issues = evaluationIssues({ submissionId: 's1', marks: 21 }, open);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe('marks');
    expect(issues[0].message).toContain('20');
  });

  it('refuses a mark that only exceeds full marks after rounding', () => {
    expect(
      evaluationIssues({ submissionId: 's1', marks: 20.006 }, open),
    ).toHaveLength(1);
  });

  it('accepts a mark that rounds back down onto full marks', () => {
    expect(
      evaluationIssues({ submissionId: 's1', marks: 20.004 }, open),
    ).toEqual([]);
  });

  it('refuses a negative mark', () => {
    expect(
      evaluationIssues({ submissionId: 's1', marks: -1 }, open),
    ).toHaveLength(1);
  });

  it('refuses a mark on ungraded work rather than silently keeping it', () => {
    const issues = evaluationIssues(
      { submissionId: 's1', marks: 5 },
      { ...open, fullMarks: null },
    );
    expect(issues[0].message).toContain('not graded');
  });

  it('accepts feedback-only evaluation on ungraded work', () => {
    expect(
      evaluationIssues(
        { submissionId: 's1', feedback: 'Well argued.' },
        { ...open, fullMarks: null },
      ),
    ).toEqual([]);
  });

  it('treats null marks as "clear the mark", not as zero', () => {
    expect(evaluationIssues({ submissionId: 's1', marks: null }, open)).toEqual(
      [],
    );
  });

  it('refuses over-long feedback', () => {
    const issues = evaluationIssues(
      { submissionId: 's1', feedback: 'x'.repeat(4001) },
      open,
    );
    expect(issues[0].field).toBe('feedback');
  });

  it('locks evaluation once the assignment is CLOSED', () => {
    const issues = evaluationIssues(
      { submissionId: 's1', marks: 10 },
      { ...open, closed: true },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe('status');
  });

  it('lets an override holder edit a closed assignment', () => {
    expect(
      evaluationIssues(
        { submissionId: 's1', marks: 10 },
        { ...open, closed: true, mayEditLocked: true },
      ),
    ).toEqual([]);
  });

  it('reports the lock without also reporting the marks — one actionable cause', () => {
    const issues = evaluationIssues(
      { submissionId: 's1', marks: 999 },
      { ...open, closed: true },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe('status');
  });
});

describe('bulkEvaluationIssues', () => {
  it('returns EVERY bad cell, not just the first (the M15 rule)', () => {
    const issues = bulkEvaluationIssues(
      [
        { submissionId: 's1', marks: 5 },
        { submissionId: 's2', marks: 99 },
        { submissionId: 's3', marks: -3 },
        { submissionId: 's4', marks: 12 },
      ],
      open,
    );
    expect(issues.map((i) => i.submissionId)).toEqual(['s2', 's3']);
  });

  it('flags a duplicated row rather than silently taking the last write', () => {
    const issues = bulkEvaluationIssues(
      [
        { submissionId: 's1', marks: 5 },
        { submissionId: 's1', marks: 9 },
      ],
      open,
    );
    expect(issues).toEqual([
      {
        submissionId: 's1',
        field: 'status',
        message: 'Duplicate row in this batch',
      },
    ]);
  });

  it('passes a clean grid', () => {
    expect(
      bulkEvaluationIssues(
        [
          { submissionId: 's1', marks: 0 },
          { submissionId: 's2', marks: 20 },
        ],
        open,
      ),
    ).toEqual([]);
  });
});

describe('returnIssues', () => {
  it('requires feedback — handing work back silently helps nobody', () => {
    expect(returnIssues('s1', null, open)).toHaveLength(1);
    expect(returnIssues('s1', '   ', open)).toHaveLength(1);
  });

  it('accepts a return with a reason', () => {
    expect(returnIssues('s1', 'Question 3 is missing.', open)).toEqual([]);
  });

  it('refuses a return on a closed assignment', () => {
    expect(
      returnIssues('s1', 'Redo it', { ...open, closed: true }),
    ).toHaveLength(1);
  });
});
