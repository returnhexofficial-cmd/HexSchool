/**
 * Merit ranking (roadmap M15 §4): GPA desc → obtained marks desc → a
 * configurable tiebreak, as **competition ranking** — 1, 2, 2, 4. The
 * position after a shared one skips, because three students cannot be
 * "second, second and third".
 *
 * Two things are deliberate:
 *
 *   - **Only PASSED candidates are ranked.** A failed, incomplete or
 *     withheld result has no merit position (NULL), rather than being
 *     stacked at the bottom of the list — a school does not publish
 *     "37th out of 40, failed".
 *   - **The tiebreak is a policy, not an implementation detail.** With
 *     `NONE` (the default) two students who tie on GPA *and* marks share
 *     a position, which is what roadmap §8 asks for. With `ROLL_ASC` the
 *     lower roll takes the higher position outright. Both are real
 *     school policies; `result.merit_tiebreak` picks.
 *
 * Dependency-free: it ranks anything with the three comparison fields,
 * which is why the combined-result generator reuses it unchanged.
 */

export type MeritTiebreak = 'NONE' | 'ROLL_ASC';

export interface Rankable {
  /** Whatever the caller keys results by — usually the enrollment id. */
  key: string;
  gpa: number;
  obtainedMarks: number;
  rollNo: number;
}

/**
 * Positions by key. Candidates absent from the input (unranked ones)
 * simply have no entry, which the caller writes as NULL.
 */
export function rank(
  rows: Rankable[],
  tiebreak: MeritTiebreak = 'NONE',
): Map<string, number> {
  const ordered = [...rows].sort(
    (a, b) =>
      b.gpa - a.gpa ||
      b.obtainedMarks - a.obtainedMarks ||
      // The roll only ever ORDERS the output; whether it also SEPARATES
      // two tied students is the policy question above.
      a.rollNo - b.rollNo,
  );

  const positions = new Map<string, number>();
  let position = 0;
  let seen = 0;
  let previous: Rankable | null = null;

  for (const row of ordered) {
    seen += 1;
    if (previous === null || !tied(previous, row, tiebreak)) {
      position = seen;
    }
    positions.set(row.key, position);
    previous = row;
  }

  return positions;
}

/**
 * Rank both scopes at once. Section rankings compare a student against
 * their own section, class rankings against every section of the class —
 * which is why the same student holds two different positions and both
 * columns exist on `results`.
 */
export function rankScopes(
  rows: Array<Rankable & { sectionId: string; classId: string }>,
  tiebreak: MeritTiebreak = 'NONE',
): Map<string, { section: number | null; class: number | null }> {
  const bySection = groupBy(rows, (r) => r.sectionId);
  const byClass = groupBy(rows, (r) => r.classId);

  const sectionPositions = new Map<string, number>();
  for (const group of bySection.values()) {
    for (const [key, value] of rank(group, tiebreak)) {
      sectionPositions.set(key, value);
    }
  }

  const classPositions = new Map<string, number>();
  for (const group of byClass.values()) {
    for (const [key, value] of rank(group, tiebreak)) {
      classPositions.set(key, value);
    }
  }

  const merged = new Map<
    string,
    { section: number | null; class: number | null }
  >();
  for (const row of rows) {
    merged.set(row.key, {
      section: sectionPositions.get(row.key) ?? null,
      class: classPositions.get(row.key) ?? null,
    });
  }
  return merged;
}

function tied(a: Rankable, b: Rankable, tiebreak: MeritTiebreak): boolean {
  if (a.gpa !== b.gpa || a.obtainedMarks !== b.obtainedMarks) return false;
  // ROLL_ASC separates everyone, so nothing is ever tied under it.
  return tiebreak === 'NONE';
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const list = groups.get(id) ?? [];
    list.push(row);
    groups.set(id, list);
  }
  return groups;
}
