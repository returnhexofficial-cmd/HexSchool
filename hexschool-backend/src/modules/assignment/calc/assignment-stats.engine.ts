/**
 * Module 22 — the numbers a teacher and a principal read: how much of a
 * class handed the work in, how much of it was late, and how the marks
 * came out (roadmap §4 "per-assignment submission %, per-student pending
 * list").
 *
 * Dependency-free and golden-tested. The one decision worth naming: the
 * denominator is the **expected roster**, and a candidate who submitted
 * but is no longer on it still counts on both sides. A student who
 * transfers section mid-assignment keeps their submission (it hangs off
 * the assignment, which carries the old section) but drops off the new
 * roster read, and a percentage computed over the roster alone would
 * print 12/11 or quietly lose the work. Union, then count.
 */

export type StatSubmissionStatus =
  'SUBMITTED' | 'RESUBMITTED' | 'EVALUATED' | 'RETURNED';

export interface StatSubmission {
  enrollmentId: string;
  status: StatSubmissionStatus;
  isLate: boolean;
  marks: number | null;
}

export interface AssignmentStats {
  /** Roster ∪ submitters — what "everyone who was meant to do this" means. */
  expected: number;
  submitted: number;
  /** Expected minus submitted, never negative. */
  pending: number;
  late: number;
  evaluated: number;
  returned: number;
  /** `submitted / expected`, 0–100, one decimal. 0 for an empty roster. */
  submissionRate: number;
  /** Over EVALUATED rows carrying a mark; NULL when nothing is marked yet. */
  averageMarks: number | null;
  highestMarks: number | null;
  lowestMarks: number | null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function summarizeAssignment(
  rosterEnrollmentIds: ReadonlyArray<string>,
  submissions: ReadonlyArray<StatSubmission>,
): AssignmentStats {
  const expectedSet = new Set(rosterEnrollmentIds);
  for (const s of submissions) expectedSet.add(s.enrollmentId);
  const expected = expectedSet.size;

  // De-duplicate defensively: `uq_assignment_submissions_identity` means
  // one row per candidate, but this engine is also fed by report queries
  // that join, and a doubled row would inflate the rate past 100 %.
  const byEnrollment = new Map<string, StatSubmission>();
  for (const s of submissions) byEnrollment.set(s.enrollmentId, s);
  const rows = [...byEnrollment.values()];

  const submitted = rows.length;
  const late = rows.filter((s) => s.isLate).length;
  const evaluated = rows.filter((s) => s.status === 'EVALUATED').length;
  const returned = rows.filter((s) => s.status === 'RETURNED').length;

  const marks = rows
    .filter((s) => s.status === 'EVALUATED' && s.marks !== null)
    .map((s) => s.marks as number);

  return {
    expected,
    submitted,
    pending: Math.max(0, expected - submitted),
    late,
    evaluated,
    returned,
    submissionRate: expected === 0 ? 0 : round1((submitted / expected) * 100),
    averageMarks:
      marks.length === 0
        ? null
        : round2(marks.reduce((a, b) => a + b, 0) / marks.length),
    highestMarks: marks.length === 0 ? null : round2(Math.max(...marks)),
    lowestMarks: marks.length === 0 ? null : round2(Math.min(...marks)),
  };
}

export interface PendingItem {
  assignmentId: string;
  dueAt: number;
  /** True once the deadline has passed with nothing handed in. */
  overdue: boolean;
}

export interface PendingSummary {
  pending: PendingItem[];
  overdue: number;
  /** Due within the next 48 h and still not submitted. */
  dueSoon: number;
}

/**
 * The student/parent "what is outstanding" view (roadmap §5 parent
 * portal). A RETURNED submission counts as pending again — the teacher
 * has asked for it back, so from the student's side there is work to do.
 */
export function pendingFor(
  assignments: ReadonlyArray<{ id: string; dueAt: number }>,
  submissions: ReadonlyArray<{
    assignmentId: string;
    status: StatSubmissionStatus;
  }>,
  now: number,
  dueSoonHours = 48,
): PendingSummary {
  const done = new Set(
    submissions
      .filter((s) => s.status !== 'RETURNED')
      .map((s) => s.assignmentId),
  );

  const pending = assignments
    .filter((a) => !done.has(a.id))
    .map((a) => ({
      assignmentId: a.id,
      dueAt: a.dueAt,
      overdue: a.dueAt < now,
    }))
    .sort((a, b) => a.dueAt - b.dueAt);

  const soonLimit = now + dueSoonHours * 3_600_000;
  return {
    pending,
    overdue: pending.filter((p) => p.overdue).length,
    dueSoon: pending.filter((p) => !p.overdue && p.dueAt <= soonLimit).length,
  };
}
