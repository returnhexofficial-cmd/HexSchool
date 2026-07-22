import { ExamStatus } from '../../../common/constants';

/**
 * The exam lifecycle as an explicit machine (roadmap M14 §4).
 *
 * Forward moves follow the enum order. Backward moves exist but are
 * deliberately short-ranged — one step back, to undo a mis-click — and
 * stop dead at PUBLISHED: once results are announced the exam is history,
 * and a correction is a Module 15 re-issue with its own audit trail, not
 * a quiet rewind of the status column.
 *
 * ARCHIVED is reachable from anywhere except itself: an exam that was
 * cancelled mid-cycle still has to go somewhere.
 */
const TRANSITIONS: Record<ExamStatus, ExamStatus[]> = {
  [ExamStatus.DRAFT]: [ExamStatus.SCHEDULED, ExamStatus.ARCHIVED],
  [ExamStatus.SCHEDULED]: [
    ExamStatus.ONGOING,
    ExamStatus.DRAFT,
    ExamStatus.ARCHIVED,
  ],
  [ExamStatus.ONGOING]: [
    ExamStatus.MARK_ENTRY,
    ExamStatus.SCHEDULED,
    ExamStatus.ARCHIVED,
  ],
  [ExamStatus.MARK_ENTRY]: [
    ExamStatus.PROCESSING,
    ExamStatus.ONGOING,
    ExamStatus.ARCHIVED,
  ],
  [ExamStatus.PROCESSING]: [
    ExamStatus.PUBLISHED,
    ExamStatus.MARK_ENTRY,
    ExamStatus.ARCHIVED,
  ],
  [ExamStatus.PUBLISHED]: [ExamStatus.ARCHIVED],
  [ExamStatus.ARCHIVED]: [],
};

/** Statuses after which the exam's shape (classes, papers) is frozen. */
const SHAPE_FROZEN_AFTER: ExamStatus[] = [
  ExamStatus.MARK_ENTRY,
  ExamStatus.PROCESSING,
  ExamStatus.PUBLISHED,
  ExamStatus.ARCHIVED,
];

export function allowedTransitions(from: ExamStatus): ExamStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: ExamStatus, to: ExamStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Papers and attached classes may only change while the exam is still
 * being built. After mark entry opens, changing the shape would orphan
 * marks that already exist.
 */
export function isShapeEditable(status: ExamStatus): boolean {
  return !SHAPE_FROZEN_AFTER.includes(status);
}

/** Marks may be entered/edited in these states (Module 15 consumes this). */
export function isMarkEntryOpen(status: ExamStatus): boolean {
  return status === ExamStatus.MARK_ENTRY || status === ExamStatus.PROCESSING;
}

/** Human-readable reason a transition is refused, or null when it is legal. */
export function transitionRefusal(
  from: ExamStatus,
  to: ExamStatus,
): string | null {
  if (from === to) return `Exam is already ${from}`;
  if (canTransition(from, to)) return null;

  const options = allowedTransitions(from);
  if (options.length === 0) {
    return `${from} is a terminal state — no further transitions are possible`;
  }
  return `Cannot move an exam from ${from} to ${to}; allowed: ${options.join(', ')}`;
}
