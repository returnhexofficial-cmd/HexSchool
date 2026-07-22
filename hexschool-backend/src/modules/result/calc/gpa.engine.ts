/**
 * NCTB GPA aggregation (roadmap M15 §4, second half): a candidate's
 * subject outcomes → one GPA, one letter grade and one verdict.
 *
 * The Bangladeshi rules this encodes, each of which is a place a naive
 * average gets it wrong:
 *
 *   - **GPA is the mean of grade points, not of marks.** Two students on
 *     79 and 80 are a whole grade apart; averaging their percentages
 *     hides that.
 *   - **The optional (4th) subject is a bonus, never a divisor.** Points
 *     *above* the bonus base (2.00 by convention) are added to the
 *     numerator, and the denominator stays the compulsory subject count.
 *     A student who takes a 4th subject and does badly at it is never
 *     worse off than one who never took it — which is exactly why
 *     `gpa_without_optional` is reported alongside.
 *   - **One compulsory F is a fail, and a fail is GPA 0.00.** Not the
 *     arithmetic mean including a zero: the board prints 0.00.
 *   - **An optional-subject F never fails anybody** (roadmap M15 §6).
 *
 * Dependency-free; the snapshot supplies both the letter for a GPA and
 * the scale's ceiling, so nothing here hard-codes 5.00.
 */

import { ResultStatus } from '../../../common/constants';
import {
  failBand,
  gradeForGpa,
  GradingSnapshot,
  maxGradePoint,
  round2,
} from './grading-snapshot';
import { SubjectOutcome } from './subject-result.engine';

export interface GpaOptions {
  /**
   * Grade points above this are added as the 4th-subject bonus
   * (`result.optional_bonus_base`, 2.00 by BD convention).
   */
  optionalBonusBase: number;
}

export interface CandidateResult {
  totalMarks: number;
  obtainedMarks: number;
  gpa: number;
  gpaWithoutOptional: number;
  grade: string;
  subjectsCount: number;
  failedSubjects: number;
  status: ResultStatus;
  /** Papers with no mark row — why the status may be INCOMPLETE. */
  missingSubjects: string[];
}

export function aggregate(
  outcomes: SubjectOutcome[],
  snapshot: GradingSnapshot,
  options: GpaOptions,
): CandidateResult {
  const fail = failBand(snapshot);
  const ceiling = maxGradePoint(snapshot);

  const compulsory = outcomes.filter((o) => !o.isOptional);
  const optional = outcomes.filter((o) => o.isOptional);
  const missing = outcomes.filter((o) => o.missing);

  const totalMarks = round2(outcomes.reduce((sum, o) => sum + o.fullMarks, 0));
  const obtainedMarks = round2(
    outcomes.reduce((sum, o) => sum + o.obtained, 0),
  );
  const failedSubjects = outcomes.filter((o) => !o.passed).length;

  const base = {
    totalMarks,
    obtainedMarks,
    subjectsCount: outcomes.length,
    failedSubjects,
    missingSubjects: missing.map((o) => o.subjectName),
  };

  // Nothing compulsory to average — a class with only optional papers is
  // a data error, not a 0.00 student.
  if (compulsory.length === 0) {
    return {
      ...base,
      gpa: 0,
      gpaWithoutOptional: 0,
      grade: fail.grade,
      status: ResultStatus.INCOMPLETE,
    };
  }

  // A missing paper is not a zero — the school has not finished marking,
  // so the honest answer is INCOMPLETE with no GPA rather than a number
  // that would rank the student against fully-marked classmates.
  if (missing.length > 0) {
    return {
      ...base,
      gpa: 0,
      gpaWithoutOptional: 0,
      grade: fail.grade,
      status: ResultStatus.INCOMPLETE,
    };
  }

  const failedCompulsory = compulsory.filter((o) => !o.passed);
  const sumPoints = compulsory.reduce((sum, o) => sum + o.gradePoint, 0);
  const withoutOptional = round2(sumPoints / compulsory.length);

  if (failedCompulsory.length > 0) {
    return {
      ...base,
      gpa: 0,
      gpaWithoutOptional: 0,
      grade: fail.grade,
      status: ResultStatus.FAILED,
    };
  }

  // The 4th-subject bonus. Only a PASSED optional contributes, and only
  // the part above the base — an optional graded exactly at the base
  // adds nothing, which is the convention's whole design.
  const bonus = optional.reduce(
    (sum, o) =>
      o.passed
        ? sum + Math.max(0, o.gradePoint - options.optionalBonusBase)
        : sum,
    0,
  );

  const gpa = Math.min(
    ceiling,
    round2((sumPoints + bonus) / compulsory.length),
  );

  return {
    ...base,
    gpa,
    gpaWithoutOptional: withoutOptional,
    grade: gradeForGpa(snapshot, gpa).grade,
    status: ResultStatus.PASSED,
  };
}
