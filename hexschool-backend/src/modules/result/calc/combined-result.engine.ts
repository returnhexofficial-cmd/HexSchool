/**
 * Weighted merge of several exams into one final result (roadmap M15 §3
 * `combined_results`): "Annual = 30 % Half-Yearly + 70 % Annual".
 *
 * Two decisions worth stating, because both are places a reasonable
 * implementation quietly goes wrong:
 *
 *   - **GPAs are weighted, not re-derived from marks.** Re-averaging the
 *     raw marks of two exams with different full marks and different
 *     subject sets produces a number nobody can reconcile with either
 *     report card. Weighting the GPAs each exam already published is
 *     both explainable and reversible.
 *   - **The merged mark total is a percentage out of 100.** Half-yearly
 *     papers out of 100 and annual papers out of 150 have no common raw
 *     total, so the merge normalises each exam to a percentage first and
 *     reports the weighted percentage. The alternative — inventing a
 *     total — reads as precision the number does not have.
 *
 * The weight set is frozen onto every generated row: an exam type's
 * `weight` may be edited afterwards without restating a final result
 * already issued, the same argument that freezes the grading snapshot.
 */

import { ResultStatus } from '../../../common/constants';
import {
  failBand,
  gradeForGpa,
  GradingSnapshot,
  maxGradePoint,
  round2,
} from './grading-snapshot';

export interface CombinedComponent {
  examId: string;
  examName: string;
  /** Share of the final result, 0–100. */
  weight: number;
  gpa: number;
  obtainedMarks: number;
  totalMarks: number;
  status: ResultStatus;
}

export interface CombinedOutcome {
  gpa: number;
  grade: string;
  /** Weighted percentage — see the note above on why this is out of 100. */
  obtainedMarks: number;
  totalMarks: number;
  status: ResultStatus;
  components: CombinedComponent[];
}

/** Weights must sum to 100 (roadmap M15 §7). Returns the deviation. */
export function weightError(weights: number[]): string | null {
  if (weights.length === 0) return 'At least one exam must be weighted';
  if (weights.some((w) => !Number.isFinite(w) || w <= 0)) {
    return 'Every weight must be a positive number';
  }
  const total = round2(weights.reduce((sum, w) => sum + w, 0));
  return total === 100
    ? null
    : `Weights must sum to 100 — they sum to ${total}`;
}

export function combine(
  components: CombinedComponent[],
  snapshot: GradingSnapshot,
): CombinedOutcome {
  const fail = failBand(snapshot);
  const ceiling = maxGradePoint(snapshot);

  // A merge is only as complete as its worst part: a missing or withheld
  // component makes the final result unpublishable, not merely lower.
  const status = mergedStatus(components);

  if (status !== ResultStatus.PASSED) {
    return {
      gpa: 0,
      grade: fail.grade,
      obtainedMarks: 0,
      totalMarks: 100,
      status,
      components,
    };
  }

  const gpa = Math.min(
    ceiling,
    round2(components.reduce((sum, c) => sum + (c.weight / 100) * c.gpa, 0)),
  );

  const percentage = round2(
    components.reduce(
      (sum, c) =>
        sum +
        (c.weight / 100) *
          (c.totalMarks > 0 ? (c.obtainedMarks / c.totalMarks) * 100 : 0),
      0,
    ),
  );

  return {
    gpa,
    grade: gradeForGpa(snapshot, gpa).grade,
    obtainedMarks: percentage,
    totalMarks: 100,
    status: ResultStatus.PASSED,
    components,
  };
}

function mergedStatus(components: CombinedComponent[]): ResultStatus {
  if (components.length === 0) return ResultStatus.INCOMPLETE;
  if (components.some((c) => c.status === ResultStatus.WITHHELD)) {
    return ResultStatus.WITHHELD;
  }
  if (components.some((c) => c.status === ResultStatus.INCOMPLETE)) {
    return ResultStatus.INCOMPLETE;
  }
  if (components.some((c) => c.status === ResultStatus.FAILED)) {
    return ResultStatus.FAILED;
  }
  return ResultStatus.PASSED;
}
