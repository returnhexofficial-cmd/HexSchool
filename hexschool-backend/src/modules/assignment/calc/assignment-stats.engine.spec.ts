import {
  pendingFor,
  summarizeAssignment,
  type StatSubmission,
} from './assignment-stats.engine';

const sub = (
  over: Partial<StatSubmission> & { enrollmentId: string },
): StatSubmission => ({
  status: 'SUBMITTED',
  isLate: false,
  marks: null,
  ...over,
});

describe('summarizeAssignment', () => {
  it('counts an untouched assignment', () => {
    const stats = summarizeAssignment(['e1', 'e2', 'e3'], []);
    expect(stats).toMatchObject({
      expected: 3,
      submitted: 0,
      pending: 3,
      submissionRate: 0,
      averageMarks: null,
    });
  });

  it('computes the submission rate to one decimal', () => {
    const stats = summarizeAssignment(
      ['e1', 'e2', 'e3'],
      [sub({ enrollmentId: 'e1' })],
    );
    expect(stats.submissionRate).toBe(33.3);
    expect(stats.pending).toBe(2);
  });

  it('reports 0 % for an empty section rather than dividing by zero', () => {
    expect(summarizeAssignment([], []).submissionRate).toBe(0);
  });

  it('counts a transferred student on BOTH sides, so the rate never exceeds 100 %', () => {
    // e9 handed the work in and then moved section, so the current roster
    // read no longer returns them. Counting the submission without the
    // expectation would print 3/2 = 150 %.
    const stats = summarizeAssignment(
      ['e1', 'e2'],
      [
        sub({ enrollmentId: 'e1' }),
        sub({ enrollmentId: 'e2' }),
        sub({ enrollmentId: 'e9' }),
      ],
    );
    expect(stats.expected).toBe(3);
    expect(stats.submitted).toBe(3);
    expect(stats.submissionRate).toBe(100);
    expect(stats.pending).toBe(0);
  });

  it('de-duplicates a doubled row from a joined query', () => {
    const stats = summarizeAssignment(
      ['e1', 'e2'],
      [sub({ enrollmentId: 'e1' }), sub({ enrollmentId: 'e1' })],
    );
    expect(stats.submitted).toBe(1);
    expect(stats.submissionRate).toBe(50);
  });

  it('counts late, evaluated and returned separately', () => {
    const stats = summarizeAssignment(
      ['e1', 'e2', 'e3', 'e4'],
      [
        sub({ enrollmentId: 'e1', isLate: true }),
        sub({ enrollmentId: 'e2', status: 'EVALUATED', marks: 18 }),
        sub({ enrollmentId: 'e3', status: 'RETURNED' }),
      ],
    );
    expect(stats).toMatchObject({
      late: 1,
      evaluated: 1,
      returned: 1,
      submitted: 3,
      pending: 1,
    });
  });

  it('averages only EVALUATED marks — an unmarked submission is not a zero', () => {
    // The M15 rule: a missing mark means the teacher has not finished, and
    // averaging it as 0 would report a class that did worse than it did.
    const stats = summarizeAssignment(
      ['e1', 'e2', 'e3'],
      [
        sub({ enrollmentId: 'e1', status: 'EVALUATED', marks: 20 }),
        sub({ enrollmentId: 'e2', status: 'EVALUATED', marks: 10 }),
        sub({ enrollmentId: 'e3' }),
      ],
    );
    expect(stats.averageMarks).toBe(15);
    expect(stats.highestMarks).toBe(20);
    expect(stats.lowestMarks).toBe(10);
  });

  it('ignores a mark left on a row that is not EVALUATED', () => {
    const stats = summarizeAssignment(
      ['e1'],
      [sub({ enrollmentId: 'e1', status: 'RETURNED', marks: 5 })],
    );
    expect(stats.averageMarks).toBeNull();
  });

  it('rounds the average to two decimals', () => {
    const stats = summarizeAssignment(
      ['e1', 'e2', 'e3'],
      [
        sub({ enrollmentId: 'e1', status: 'EVALUATED', marks: 10 }),
        sub({ enrollmentId: 'e2', status: 'EVALUATED', marks: 10 }),
        sub({ enrollmentId: 'e3', status: 'EVALUATED', marks: 11 }),
      ],
    );
    expect(stats.averageMarks).toBe(10.33);
  });

  it('handles a genuine zero without treating it as missing', () => {
    const stats = summarizeAssignment(
      ['e1'],
      [sub({ enrollmentId: 'e1', status: 'EVALUATED', marks: 0 })],
    );
    expect(stats.averageMarks).toBe(0);
    expect(stats.lowestMarks).toBe(0);
  });
});

describe('pendingFor', () => {
  const NOW = Date.UTC(2026, 6, 30, 12, 0, 0);
  const HOUR = 3_600_000;

  it('lists what has not been handed in, soonest first', () => {
    const summary = pendingFor(
      [
        { id: 'a1', dueAt: NOW + 72 * HOUR },
        { id: 'a2', dueAt: NOW + 10 * HOUR },
        { id: 'a3', dueAt: NOW - 24 * HOUR },
      ],
      [],
      NOW,
    );
    expect(summary.pending.map((p) => p.assignmentId)).toEqual([
      'a3',
      'a2',
      'a1',
    ]);
    expect(summary.overdue).toBe(1);
    expect(summary.dueSoon).toBe(1);
  });

  it('drops a submitted assignment', () => {
    const summary = pendingFor(
      [{ id: 'a1', dueAt: NOW + HOUR }],
      [{ assignmentId: 'a1', status: 'SUBMITTED' }],
      NOW,
    );
    expect(summary.pending).toEqual([]);
  });

  it('keeps an EVALUATED assignment out of the pending list', () => {
    const summary = pendingFor(
      [{ id: 'a1', dueAt: NOW - HOUR }],
      [{ assignmentId: 'a1', status: 'EVALUATED' }],
      NOW,
    );
    expect(summary.pending).toEqual([]);
  });

  it('puts a RETURNED assignment BACK on the pending list', () => {
    // The teacher has asked for it again, so from the student's side
    // there is work outstanding.
    const summary = pendingFor(
      [{ id: 'a1', dueAt: NOW + HOUR }],
      [{ assignmentId: 'a1', status: 'RETURNED' }],
      NOW,
    );
    expect(summary.pending.map((p) => p.assignmentId)).toEqual(['a1']);
  });

  it('does not count an overdue item as due-soon', () => {
    const summary = pendingFor([{ id: 'a1', dueAt: NOW - HOUR }], [], NOW);
    expect(summary.overdue).toBe(1);
    expect(summary.dueSoon).toBe(0);
  });

  it('honours a custom due-soon window', () => {
    const summary = pendingFor(
      [{ id: 'a1', dueAt: NOW + 30 * HOUR }],
      [],
      NOW,
      24,
    );
    expect(summary.dueSoon).toBe(0);
    expect(
      pendingFor([{ id: 'a1', dueAt: NOW + 30 * HOUR }], [], NOW).dueSoon,
    ).toBe(1);
  });
});
