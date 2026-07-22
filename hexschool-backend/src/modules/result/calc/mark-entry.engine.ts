/**
 * Mark-entry validation (roadmap M15 §6/§7): what a teacher may type
 * into the grid before anything is stored.
 *
 * The bound that matters — "a mark may not exceed its component's
 * allocation" — is one join away from the `marks` row (the allocation
 * lives on `exam_subjects`), so a DB CHECK cannot express it. This
 * engine is therefore the enforcement point, and the frontend grid
 * mirrors it so a bad cell turns red before a request is sent.
 *
 * Dependency-free, and it returns **every** violation rather than
 * throwing on the first: a bulk save of forty students must be able to
 * paint all the bad cells at once.
 */

import { round2 } from './grading-snapshot';
import {
  Component,
  COMPONENTS,
  COMPONENT_LABELS,
  PaperSpec,
} from './subject-result.engine';

export interface MarkInput {
  enrollmentId: string;
  cq?: number | null;
  mcq?: number | null;
  practical?: number | null;
  ca?: number | null;
  /** Only read for a FLAT paper; a split paper's total is derived. */
  total?: number | null;
  isAbsent?: boolean;
}

export interface MarkError {
  enrollmentId: string;
  field: string;
  message: string;
}

/** Components this paper allocates marks to (empty ⇒ a flat paper). */
export function allocatedComponents(paper: PaperSpec): Component[] {
  return COMPONENTS.filter((c) => {
    const allocation = paper.componentMarks[c];
    return allocation !== null && allocation !== undefined;
  });
}

/**
 * The stored `total` for one entry. For a split paper it is the sum of
 * the components — the teacher never types it, so it can never disagree
 * with them; for a flat paper it is the single number typed.
 */
export function resolveTotal(paper: PaperSpec, input: MarkInput): number {
  if (input.isAbsent) return 0;
  const allocated = allocatedComponents(paper);
  if (allocated.length === 0) return round2(Number(input.total ?? 0));
  return round2(allocated.reduce((sum, c) => sum + Number(input[c] ?? 0), 0));
}

/** Every rule this entry breaks, as a flat list. */
export function validateMark(paper: PaperSpec, input: MarkInput): MarkError[] {
  const errors: MarkError[] = [];
  const push = (field: string, message: string) =>
    errors.push({ enrollmentId: input.enrollmentId, field, message });

  const allocated = allocatedComponents(paper);

  if (input.isAbsent) {
    // Absent means absent — a mark alongside the flag is a typo, and
    // silently discarding it would hide the teacher's mistake.
    const stray = [...COMPONENTS, 'total' as const].filter((field) => {
      const value = input[field as keyof MarkInput];
      return typeof value === 'number' && value > 0;
    });
    if (stray.length > 0) {
      push(
        'isAbsent',
        `Absent candidates cannot carry marks — clear ${stray.join(', ')}`,
      );
    }
    return errors;
  }

  for (const component of COMPONENTS) {
    const value = input[component];
    const allocation = paper.componentMarks[component];

    if (value === null || value === undefined) continue;

    if (!Number.isFinite(value) || value < 0) {
      push(component, `${COMPONENT_LABELS[component]} must be 0 or more`);
      continue;
    }
    if (round2(value) !== value) {
      push(
        component,
        `${COMPONENT_LABELS[component]} allows at most 2 decimal places`,
      );
    }
    if (allocation === null || allocation === undefined) {
      push(
        component,
        `This paper allocates no ${COMPONENT_LABELS[component]} marks`,
      );
      continue;
    }
    if (value > allocation) {
      push(
        component,
        `${COMPONENT_LABELS[component]} ${value} exceeds its ${allocation} marks`,
      );
    }
  }

  if (allocated.length === 0) {
    const total = input.total;
    if (total === null || total === undefined) {
      push('total', 'Enter a mark or tick absent');
    } else if (!Number.isFinite(total) || total < 0) {
      push('total', 'Marks must be 0 or more');
    } else if (round2(total) !== total) {
      push('total', 'Marks allow at most 2 decimal places');
    } else if (total > paper.fullMarks) {
      push('total', `${total} exceeds the paper's ${paper.fullMarks} marks`);
    }
  } else if (input.total !== null && input.total !== undefined) {
    // A split paper's total is derived; accepting one from the client
    // invites a row whose parts and whole disagree.
    const derived = resolveTotal(paper, input);
    if (round2(input.total) !== derived) {
      push(
        'total',
        `Total is derived from the components (${derived}) — do not send it`,
      );
    }
  }

  return errors;
}
