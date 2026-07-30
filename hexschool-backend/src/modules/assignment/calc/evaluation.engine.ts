/**
 * Module 22 — evaluation bounds and the bulk grid.
 *
 * The rule a DB CHECK cannot express: a mark must fit inside the parent
 * assignment's `full_marks`, which is one join away. Exactly the M15
 * `mark-entry.engine.ts` situation, and the same answer — a pure engine
 * the service calls and the frontend mirrors, so a bad cell turns red
 * before a request is sent.
 *
 * The bulk save is **all-or-nothing and returns every bad cell at once**
 * (the M15 rule): a teacher filling a grid of forty needs the whole list,
 * not the first failure forty times.
 */

export interface EvaluationTarget {
  /** The submission being marked. */
  submissionId: string;
  marks?: number | null;
  feedback?: string | null;
}

export interface EvaluationContext {
  /** NULL when the assignment is feedback-only. */
  fullMarks: number | null;
  /** CLOSED locks evaluation (roadmap §6) unless the caller may override. */
  closed: boolean;
  /** Runtime `assignment.evaluate.override` verdict for the actor. */
  mayEditLocked: boolean;
}

export interface EvaluationIssue {
  submissionId: string;
  field: 'marks' | 'feedback' | 'status';
  message: string;
}

/** Marks rounded the way the column stores them — NUMERIC(6,2). */
export function roundMarks(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Validates one cell. Returns the issues rather than throwing, so the
 * bulk path can collect them and the single path can throw on the first.
 */
export function evaluationIssues(
  target: EvaluationTarget,
  ctx: EvaluationContext,
): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  const at = (field: EvaluationIssue['field'], message: string) =>
    issues.push({ submissionId: target.submissionId, field, message });

  if (ctx.closed && !ctx.mayEditLocked) {
    at(
      'status',
      'This assignment is closed — evaluation is locked (needs assignment.evaluate.override)',
    );
    return issues;
  }

  const marks = target.marks;
  if (marks !== undefined && marks !== null) {
    if (!Number.isFinite(marks)) {
      at('marks', 'Marks must be a number');
    } else if (marks < 0) {
      at('marks', 'Marks cannot be negative');
    } else if (ctx.fullMarks === null) {
      // Feedback-only work has no scale to measure against, so a number
      // here is meaningless rather than merely out of range.
      at('marks', 'This assignment is not graded — leave marks empty');
    } else if (roundMarks(marks) > ctx.fullMarks) {
      at('marks', `Marks cannot exceed the full marks (${ctx.fullMarks})`);
    }
  }

  const feedback = target.feedback;
  if (feedback !== undefined && feedback !== null && feedback.length > 4000) {
    at('feedback', 'Feedback cannot exceed 4000 characters');
  }

  return issues;
}

/**
 * The bulk grid: every cell validated, every issue returned. An empty
 * array means the whole batch may be written.
 */
export function bulkEvaluationIssues(
  targets: ReadonlyArray<EvaluationTarget>,
  ctx: EvaluationContext,
): EvaluationIssue[] {
  const seen = new Set<string>();
  const issues: EvaluationIssue[] = [];

  for (const target of targets) {
    if (seen.has(target.submissionId)) {
      issues.push({
        submissionId: target.submissionId,
        field: 'status',
        message: 'Duplicate row in this batch',
      });
      continue;
    }
    seen.add(target.submissionId);
    issues.push(...evaluationIssues(target, ctx));
  }

  return issues;
}

/**
 * Returning work for revision needs a reason. A `return` with no feedback
 * tells the student their work was rejected and nothing else, which is
 * the one outcome that helps nobody — so it is refused here as well as by
 * `chk_assignment_submissions_evaluation`.
 */
export function returnIssues(
  submissionId: string,
  feedback: string | null | undefined,
  ctx: EvaluationContext,
): EvaluationIssue[] {
  if (ctx.closed && !ctx.mayEditLocked) {
    return [
      {
        submissionId,
        field: 'status',
        message:
          'This assignment is closed — evaluation is locked (needs assignment.evaluate.override)',
      },
    ];
  }
  if (!feedback || feedback.trim().length === 0) {
    return [
      {
        submissionId,
        field: 'feedback',
        message:
          'Say what needs revising — feedback is required to return work',
      },
    ];
  }
  return [];
}
