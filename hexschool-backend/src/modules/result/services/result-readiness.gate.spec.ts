import { ResultRunStatus, ResultStatus } from '../../../common/constants';
import { ResultReadinessGate } from './result-readiness.gate';

describe('ResultReadinessGate (the real EXAM_RESULT_GATE)', () => {
  let results: {
    countForExam: jest.Mock;
    countByStatus: jest.Mock;
  };
  let runs: { findLatest: jest.Mock; findLatestCompleted: jest.Mock };
  let marks: { lastChangedAt: jest.Mock };
  let gate: ResultReadinessGate;

  const processedAt = new Date('2026-07-22T10:00:00Z');

  beforeEach(() => {
    results = {
      countForExam: jest.fn().mockResolvedValue(40),
      countByStatus: jest
        .fn()
        .mockResolvedValue([{ status: ResultStatus.PASSED, count: 40 }]),
    };
    runs = {
      findLatest: jest.fn().mockResolvedValue({
        id: 'run-1',
        status: ResultRunStatus.COMPLETED,
        finishedAt: processedAt,
      }),
      findLatestCompleted: jest
        .fn()
        .mockResolvedValue({ id: 'run-1', finishedAt: processedAt }),
    };
    // Marks last touched before the run finished — the normal case.
    marks = {
      lastChangedAt: jest
        .fn()
        .mockResolvedValue(new Date('2026-07-22T09:00:00Z')),
    };

    gate = new ResultReadinessGate(
      results as never,
      runs as never,
      marks as never,
    );
  });

  it('allows publication once a run has completed and nothing moved since', async () => {
    const verdict = await gate.canPublish('exam-1');

    expect(verdict.ready).toBe(true);
    expect(verdict.detail).toMatchObject({ results: 40, incomplete: 0 });
  });

  it('refuses when nothing has been processed', async () => {
    results.countForExam.mockResolvedValue(0);

    const verdict = await gate.canPublish('exam-1');

    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toMatch(/no results have been processed/i);
  });

  it('refuses while a run is still in flight', async () => {
    runs.findLatest.mockResolvedValue({
      id: 'run-2',
      status: ResultRunStatus.RUNNING,
    });

    const verdict = await gate.canPublish('exam-1');

    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toMatch(/still RUNNING/);
  });

  it('refuses after a failed run, quoting the error', async () => {
    runs.findLatest.mockResolvedValue({
      id: 'run-3',
      status: ResultRunStatus.FAILED,
      error: 'grading snapshot has no grade bands',
    });

    const verdict = await gate.canPublish('exam-1');

    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toMatch(/grading snapshot has no grade bands/);
  });

  it('refuses when a mark changed after the last run — the stale case', async () => {
    // This is the check that matters most: without it a correction made
    // after processing would be published with the OLD computed result.
    marks.lastChangedAt.mockResolvedValue(new Date('2026-07-22T11:00:00Z'));

    const verdict = await gate.canPublish('exam-1');

    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toMatch(/reprocess before publishing/i);
    expect(verdict.detail).toMatchObject({
      lastProcessedAt: processedAt.toISOString(),
    });
  });

  it('lets INCOMPLETE results through but reports how many', async () => {
    // A transferred-out student will never have a full sheet; the school
    // still has to publish the rest of the class.
    results.countByStatus.mockResolvedValue([
      { status: ResultStatus.PASSED, count: 38 },
      { status: ResultStatus.INCOMPLETE, count: 2 },
    ]);

    const verdict = await gate.canPublish('exam-1');

    expect(verdict.ready).toBe(true);
    expect(verdict.detail).toMatchObject({ incomplete: 2 });
  });
});
