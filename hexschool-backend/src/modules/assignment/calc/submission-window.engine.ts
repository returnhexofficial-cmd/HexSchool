/**
 * Module 22 — the submission window: may this candidate hand this work in
 * right now, and is it late?
 *
 * Dependency-free and golden-tested (PROJECT_CONTEXT §4). Every "can they
 * submit" decision in the module funnels through `submissionVerdict`, so
 * the portal endpoint, the resubmission path and the UI's disabled-button
 * logic cannot disagree about the rules — which is what happened to M16's
 * invoice status before `deriveStatus` became the single source.
 */

export type AssignmentLifecycle = 'DRAFT' | 'PUBLISHED' | 'CLOSED';

export type SubmissionState =
  'SUBMITTED' | 'RESUBMITTED' | 'EVALUATED' | 'RETURNED';

export interface SubmissionWindowInput {
  status: AssignmentLifecycle;
  /** Epoch ms. */
  dueAt: number;
  /** Epoch ms — "now" is passed in so the engine stays pure. */
  now: number;
  allowLate: boolean;
  /** School-wide knob `assignment.allow_resubmission`. */
  allowResubmission: boolean;
  /**
   * School-wide knob `assignment.resubmission_until_due`: when true a
   * resubmission is only accepted before the deadline, so "resubmit" is
   * a correction rather than a second bite after everyone else's marks
   * are in.
   */
  resubmissionUntilDue: boolean;
  /** The candidate's existing submission, if any. */
  existing?: { status: SubmissionState } | null;
}

export type SubmissionRefusal =
  | 'NOT_PUBLISHED'
  | 'CLOSED'
  | 'PAST_DUE'
  | 'ALREADY_EVALUATED'
  | 'RESUBMISSION_DISABLED'
  | 'RESUBMISSION_PAST_DUE';

export interface SubmissionVerdict {
  allowed: boolean;
  /** Why not — a stable code the API turns into a message and the UI reads. */
  reason?: SubmissionRefusal;
  /** What the resulting row's status would be. */
  nextStatus: SubmissionState;
  /** Whether the resulting row would be flagged late. */
  late: boolean;
  /** 1 for a first submission, existing attempt + 1 otherwise. */
  attempt: number;
}

/** Whether an instant falls after the deadline. The deadline itself is on time. */
export function isLate(dueAt: number, submittedAt: number): boolean {
  return submittedAt > dueAt;
}

/**
 * Milliseconds until the deadline (negative once past it). The due-soon
 * reminder job compares this against its window.
 */
export function timeToDue(dueAt: number, now: number): number {
  return dueAt - now;
}

/**
 * True when `now` sits inside the reminder window before the deadline —
 * i.e. the deadline is still ahead but no further than `hours` away.
 * Deliberately excludes work already overdue: a reminder that arrives
 * after the fact is not a reminder, it is a reproach.
 */
export function isWithinReminderWindow(
  dueAt: number,
  now: number,
  hours: number,
): boolean {
  const remaining = timeToDue(dueAt, now);
  return remaining > 0 && remaining <= hours * 3_600_000;
}

export function submissionVerdict(
  input: SubmissionWindowInput,
): SubmissionVerdict {
  const late = isLate(input.dueAt, input.now);
  const existing = input.existing ?? null;
  const attempt = existing ? 2 : 1;
  const nextStatus: SubmissionState = existing ? 'RESUBMITTED' : 'SUBMITTED';
  const refuse = (reason: SubmissionRefusal): SubmissionVerdict => ({
    allowed: false,
    reason,
    nextStatus,
    late,
    attempt,
  });

  // A DRAFT does not exist as far as a student is concerned (the M19
  // "only PUBLISHED is public" rule, applied to a section).
  if (input.status === 'DRAFT') return refuse('NOT_PUBLISHED');
  if (input.status === 'CLOSED') return refuse('CLOSED');

  if (existing) {
    // An evaluated submission is a decision about a person's work; a
    // silent overwrite would leave the mark on file describing something
    // nobody can read any more. The teacher's `return` is the door back.
    if (existing.status === 'EVALUATED') return refuse('ALREADY_EVALUATED');
    // RETURNED is the teacher explicitly asking for the work again, so
    // it bypasses the resubmission knob entirely — refusing there would
    // make the return-for-revision flow unusable.
    if (existing.status !== 'RETURNED') {
      if (!input.allowResubmission) return refuse('RESUBMISSION_DISABLED');
      if (input.resubmissionUntilDue && late) {
        return refuse('RESUBMISSION_PAST_DUE');
      }
    }
  }

  if (late && !input.allowLate) return refuse('PAST_DUE');

  return { allowed: true, nextStatus, late, attempt };
}

/** Human-readable reason, shared by the API error and the portal. */
export const REFUSAL_MESSAGES: Record<SubmissionRefusal, string> = {
  NOT_PUBLISHED: 'This assignment has not been published yet',
  CLOSED: 'This assignment is closed and no longer accepts submissions',
  PAST_DUE: 'The deadline has passed and late submissions are not allowed',
  ALREADY_EVALUATED:
    'Your submission has already been evaluated — ask your teacher to return it if you need to change it',
  RESUBMISSION_DISABLED: 'Resubmission is switched off for this school',
  RESUBMISSION_PAST_DUE:
    'Resubmission is only allowed before the deadline has passed',
};
