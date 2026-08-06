/**
 * Roadmap M27 §4's "Bulk prize certificates (e.g., merit top-3 per class
 * from an exam) wizard endpoint".
 *
 * **The rule that decides everything here is that merit is a competition
 * ranking.** M15 already ranks 1, 2, 2, 4 among PASSED candidates, and the
 * question this engine answers is what "top 3" means when two students tie
 * for second. Cutting at three *rows* would hand a prize to one of the two
 * and not the other, on no basis anybody could explain to their parents.
 * So the cut is on **position**, not on count: `topN = 3` selects every
 * candidate whose position is ≤ 3, which is four students when second is
 * shared, and the caller is told the count differs from what they asked
 * for. That is the same reasoning M15 used to make merit a second pass —
 * a rank is relative, and truncating it arbitrarily makes it a lie.
 *
 * Dependency-free: it takes rows, it returns rows.
 */

export interface PrizeCandidate {
  enrollmentId: string;
  studentId: string;
  classId: string;
  className: string;
  studentName: string;
  /** Competition position within the class (M15 `classPosition`). */
  position: number | null;
  gpa: number | null;
  /** Only PASSED candidates may win a prize — M15's own merit rule. */
  passed: boolean;
}

export interface PrizeSelection {
  classId: string;
  className: string;
  winners: PrizeCandidate[];
  /** Set when a tie made the class's list longer than `topN`. */
  note: string | null;
}

export interface PrizeSelectionResult {
  classes: PrizeSelection[];
  total: number;
  /** Classes where nobody qualified, so the wizard can say why. */
  skipped: Array<{ classId: string; className: string; reason: string }>;
}

/**
 * Select the top `topN` positions per class.
 *
 * A candidate with **no position** is excluded rather than sorted last: a
 * null position means M15 did not rank them (INCOMPLETE, WITHHELD, or a
 * result that was never processed), and printing a prize certificate for a
 * student whose result the school is still holding back is the one mistake
 * this wizard could make that nobody would catch before the ceremony.
 */
export function selectPrizeWinners(
  candidates: readonly PrizeCandidate[],
  topN: number,
): PrizeSelectionResult {
  const cut = Math.max(1, Math.trunc(topN));

  const byClass = new Map<string, PrizeCandidate[]>();
  for (const candidate of candidates) {
    const list = byClass.get(candidate.classId) ?? [];
    list.push(candidate);
    byClass.set(candidate.classId, list);
  }

  const classes: PrizeSelection[] = [];
  const skipped: PrizeSelectionResult['skipped'] = [];

  for (const [classId, rows] of byClass) {
    const className = rows[0].className;
    const eligible = rows.filter(
      (row) => row.passed && row.position !== null && row.position >= 1,
    );

    if (eligible.length === 0) {
      skipped.push({
        classId,
        className,
        reason:
          'No ranked, passed candidate in this class — the exam may not be processed, or every result is withheld.',
      });
      continue;
    }

    const winners = eligible
      .filter((row) => (row.position as number) <= cut)
      .sort(sortWinners);

    if (winners.length === 0) {
      skipped.push({
        classId,
        className,
        reason: `Nobody in this class placed in the top ${cut}.`,
      });
      continue;
    }

    classes.push({
      classId,
      className,
      winners,
      note:
        winners.length > cut
          ? `${winners.length} winners for a top-${cut} cut — positions are shared, and cutting the list at ${cut} would give one of the tied students a prize and not the other.`
          : null,
    });
  }

  classes.sort((a, b) => a.className.localeCompare(b.className));

  return {
    classes,
    total: classes.reduce((sum, entry) => sum + entry.winners.length, 0),
    skipped: skipped.sort((a, b) => a.className.localeCompare(b.className)),
  };
}

/**
 * Position first, then GPA descending, then name — so a tied pair prints
 * in a stable order and re-running the wizard produces the same list (the
 * M20 largest-remainder tie-break reasoning: a re-run must reproduce the
 * same document).
 */
function sortWinners(a: PrizeCandidate, b: PrizeCandidate): number {
  const byPosition = (a.position as number) - (b.position as number);
  if (byPosition !== 0) return byPosition;
  const byGpa = (b.gpa ?? 0) - (a.gpa ?? 0);
  if (byGpa !== 0) return byGpa;
  return a.studentName.localeCompare(b.studentName);
}

/** Ordinal a prize certificate prints — "1st", "2nd", "3rd", "11th". */
export function ordinal(position: number): string {
  const n = Math.trunc(position);
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
