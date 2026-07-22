/**
 * Mark distribution rules for one paper (roadmap M14 §6/§7).
 *
 * Dependency-free on purpose: the same validation runs on the wizard's
 * bulk distribution grid, on a single-paper edit, and in unit tests
 * without a database or a Nest container in sight.
 *
 * A paper is either **flat** (one `fullMarks` bucket) or **split** into
 * CQ / MCQ / practical / CA. When it is split the parts must add up to
 * `fullMarks` exactly — a 100-mark paper whose components sum to 90 is
 * the single most common data-entry error in this domain, and it only
 * surfaces months later as an unexplainable result.
 *
 * The per-component `*PassMarks` are the roadmap's "per-component pass
 * flags" expressed as thresholds: non-null means that component must be
 * cleared on its own (how BD boards treat a practical), and the number is
 * the bar. A bare boolean could not carry the bar.
 */

export interface MarkDistribution {
  fullMarks: number;
  passMarks: number;
  cqMarks?: number | null;
  mcqMarks?: number | null;
  practicalMarks?: number | null;
  caMarks?: number | null;
  cqPassMarks?: number | null;
  mcqPassMarks?: number | null;
  practicalPassMarks?: number | null;
  caPassMarks?: number | null;
}

export interface DistributionError {
  field: string;
  message: string;
}

/** The four splittable components, in the order report cards print them. */
export const COMPONENTS = ['cq', 'mcq', 'practical', 'ca'] as const;
export type Component = (typeof COMPONENTS)[number];

const COMPONENT_LABELS: Record<Component, string> = {
  cq: 'CQ',
  mcq: 'MCQ',
  practical: 'Practical',
  ca: 'Continuous assessment',
};

const marksField = (c: Component): keyof MarkDistribution =>
  `${c}Marks` as keyof MarkDistribution;
const passField = (c: Component): keyof MarkDistribution =>
  `${c}PassMarks` as keyof MarkDistribution;

const value = (
  d: MarkDistribution,
  key: keyof MarkDistribution,
): number | null => {
  const raw = d[key];
  return raw === null || raw === undefined ? null : Number(raw);
};

/** Components that carry a mark allocation on this paper. */
export function usedComponents(d: MarkDistribution): Component[] {
  return COMPONENTS.filter((c) => value(d, marksField(c)) !== null);
}

/** A paper is split as soon as one component is allocated marks. */
export function isSplit(d: MarkDistribution): boolean {
  return usedComponents(d).length > 0;
}

/** Sum of the allocated components (0 for a flat paper). */
export function componentTotal(d: MarkDistribution): number {
  return usedComponents(d).reduce(
    (sum, c) => sum + (value(d, marksField(c)) ?? 0),
    0,
  );
}

/**
 * Every rule violated by this distribution, as a flat list so a bulk grid
 * can show all bad rows at once instead of failing on the first.
 */
export function validateDistribution(d: MarkDistribution): DistributionError[] {
  const errors: DistributionError[] = [];

  if (!Number.isInteger(d.fullMarks) || d.fullMarks <= 0) {
    errors.push({
      field: 'fullMarks',
      message: 'Full marks must be a whole number above 0',
    });
  }
  if (!Number.isInteger(d.passMarks) || d.passMarks < 0) {
    errors.push({
      field: 'passMarks',
      message: 'Pass marks must be a whole number of 0 or more',
    });
  }
  if (
    Number.isInteger(d.fullMarks) &&
    Number.isInteger(d.passMarks) &&
    d.passMarks > d.fullMarks
  ) {
    errors.push({
      field: 'passMarks',
      message: `Pass marks (${d.passMarks}) cannot exceed full marks (${d.fullMarks})`,
    });
  }

  for (const c of COMPONENTS) {
    const marks = value(d, marksField(c));
    if (marks !== null && (!Number.isInteger(marks) || marks < 0)) {
      errors.push({
        field: `${c}Marks`,
        message: `${COMPONENT_LABELS[c]} marks must be a whole number of 0 or more`,
      });
    }
  }

  if (isSplit(d)) {
    const total = componentTotal(d);
    if (Number.isInteger(d.fullMarks) && total !== d.fullMarks) {
      const parts = usedComponents(d)
        .map((c) => `${COMPONENT_LABELS[c]} ${value(d, marksField(c))}`)
        .join(' + ');
      errors.push({
        field: 'components',
        message: `Components must add up to full marks — ${parts} = ${total}, expected ${d.fullMarks}`,
      });
    }
  }

  for (const c of COMPONENTS) {
    const pass = value(d, passField(c));
    if (pass === null) continue;

    const marks = value(d, marksField(c));
    if (marks === null) {
      errors.push({
        field: `${c}PassMarks`,
        message: `${COMPONENT_LABELS[c]} has a pass mark but no marks allocated`,
      });
      continue;
    }
    if (!Number.isInteger(pass) || pass < 0) {
      errors.push({
        field: `${c}PassMarks`,
        message: `${COMPONENT_LABELS[c]} pass mark must be a whole number of 0 or more`,
      });
      continue;
    }
    if (pass > marks) {
      errors.push({
        field: `${c}PassMarks`,
        message: `${COMPONENT_LABELS[c]} pass mark (${pass}) cannot exceed its ${marks} marks`,
      });
    }
  }

  return errors;
}

/**
 * A default split for a brand-new paper: theory-only subjects stay flat,
 * anything with a practical gets the conventional 75/25 BD layout. The
 * wizard seeds the grid with this and the user edits from there.
 */
export function defaultDistribution(
  fullMarks: number,
  passMarks: number,
  hasPractical: boolean,
): MarkDistribution {
  if (!hasPractical) return { fullMarks, passMarks };
  const practical = Math.round(fullMarks * 0.25);
  return {
    fullMarks,
    passMarks,
    cqMarks: fullMarks - practical,
    practicalMarks: practical,
  };
}
