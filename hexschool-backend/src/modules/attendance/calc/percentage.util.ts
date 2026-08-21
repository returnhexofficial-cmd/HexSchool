import { AttendanceStatus } from '../../../common/constants';

/**
 * Dependency-free attendance maths (PROJECT_CONTEXT §4: calculation
 * engines stay dependency-free and unit-tested). Roadmap M12 §6:
 *
 *   attendance % = (present + late + 0.5 × half-day) ÷ working days
 *
 * where working days come from the calendar (holidays + weekly off-days
 * excluded) and days before the student's enrollment_date never count.
 * LATE counts as present but is tracked separately; LEAVE is a working
 * day the student did not attend, so it sits in the denominator only.
 * HOLIDAY rows (a date converted after marking) are excluded from both.
 */

export type AttendanceCounts = Record<AttendanceStatus, number>;

export function emptyCounts(): AttendanceCounts {
  return {
    [AttendanceStatus.PRESENT]: 0,
    [AttendanceStatus.ABSENT]: 0,
    [AttendanceStatus.LATE]: 0,
    [AttendanceStatus.LEAVE]: 0,
    [AttendanceStatus.HALF_DAY]: 0,
    [AttendanceStatus.HOLIDAY]: 0,
  };
}

export function countByStatus(
  rows: ReadonlyArray<{ status: AttendanceStatus }>,
): AttendanceCounts {
  const counts = emptyCounts();
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/** Days credited as attended: present + late + half of every half day. */
export function presentEquivalent(counts: AttendanceCounts): number {
  return (
    counts[AttendanceStatus.PRESENT] +
    counts[AttendanceStatus.LATE] +
    counts[AttendanceStatus.HALF_DAY] * 0.5
  );
}

export interface AttendanceSummary {
  workingDays: number;
  presentEquivalent: number;
  /** Marked days that are neither HOLIDAY nor outside the range. */
  markedDays: number;
  unmarkedDays: number;
  percentage: number;
  counts: AttendanceCounts;
}

/**
 * `workingDays` is the calendar count for the window, already clipped to
 * the student's enrollment date by the caller. HOLIDAY-status rows are
 * subtracted from it: a date converted to HOLIDAY after marking stops
 * being a working day (roadmap M12 §8).
 */
export function summarize(
  counts: AttendanceCounts,
  workingDays: number,
): AttendanceSummary {
  const effectiveWorkingDays = Math.max(
    0,
    workingDays - counts[AttendanceStatus.HOLIDAY],
  );
  const attended = presentEquivalent(counts);
  const markedDays =
    counts[AttendanceStatus.PRESENT] +
    counts[AttendanceStatus.ABSENT] +
    counts[AttendanceStatus.LATE] +
    counts[AttendanceStatus.LEAVE] +
    counts[AttendanceStatus.HALF_DAY];

  return {
    workingDays: effectiveWorkingDays,
    presentEquivalent: attended,
    markedDays,
    unmarkedDays: Math.max(0, effectiveWorkingDays - markedDays),
    percentage:
      effectiveWorkingDays === 0
        ? 0
        : round2((attended / effectiveWorkingDays) * 100),
    counts,
  };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Three denominators, named — because the same word meant two things.
 *
 * QA finding F28: `percentage` appeared twice in one student report with two
 * different denominators (42.86% overall, 60% for the only section), because
 * the range-spanning figures were computed by a private helper in the
 * reporting service that divided by **marked days**, while `summarize` above
 * divides by **working days** as the roadmap formula requires. Both were
 * labelled `percentage`, in the same payload.
 *
 * The fix is to make the choice explicit and put it here, where the project's
 * arithmetic belongs and where a golden test can pin it.
 */

/**
 * One **day**, one cohort: of the students actually marked, what share were
 * present? The denominator is marked students, and that is correct — a single
 * day has no "working days" to divide by, and an unmarked student is missing
 * data rather than an absence.
 */
export function sameDayPercentage(counts: AttendanceCounts): number {
  const marked =
    counts[AttendanceStatus.PRESENT] +
    counts[AttendanceStatus.ABSENT] +
    counts[AttendanceStatus.LATE] +
    counts[AttendanceStatus.LEAVE] +
    counts[AttendanceStatus.HALF_DAY];
  if (marked === 0) return 0;
  return round2((presentEquivalent(counts) / marked) * 100);
}

/**
 * One **student** over a range: the roadmap formula. Working days must already
 * be clipped to the window being measured — for a per-section block that is
 * the window the student spent in *that* section, not the whole range.
 */
export function rangePercentage(
  counts: AttendanceCounts,
  workingDays: number,
): number {
  const effective = Math.max(0, workingDays - counts[AttendanceStatus.HOLIDAY]);
  if (effective === 0) return 0;
  return round2((presentEquivalent(counts) / effective) * 100);
}

/**
 * A **cohort** over a range — a section or a school. The denominator is
 * working days × heads, because every student owes an attendance on every
 * working day. Dividing a whole section's present-days by working days alone
 * would exceed 100% as soon as the section held more than one student.
 */
export function cohortPercentage(
  counts: AttendanceCounts,
  workingDays: number,
  headcount: number,
): number {
  const effectiveDays = Math.max(
    0,
    workingDays - Math.ceil(counts[AttendanceStatus.HOLIDAY] / Math.max(1, headcount)),
  );
  const denominator = effectiveDays * headcount;
  if (denominator === 0) return 0;
  return round2((presentEquivalent(counts) / denominator) * 100);
}
