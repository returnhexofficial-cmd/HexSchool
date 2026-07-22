/**
 * Subject-level grading (roadmap M15 §4, first half): one candidate's
 * marks for one paper → a grade, a grade point and a pass/fail verdict.
 *
 * Dependency-free and golden-tested, per the project's rule that
 * calculation engines never touch the ORM. Everything it needs about the
 * paper arrives as a plain `PaperSpec` (the Module 14 distribution) and
 * everything it needs about the scale arrives as a frozen snapshot.
 *
 * Three rules carry the domain:
 *
 *   1. **A component threshold can fail an otherwise good total.** A BD
 *      practical requires clearing its own bar; 90/100 overall with 8/25
 *      in the practical is a fail, and the grade must say F rather than
 *      A+ (roadmap M14's per-component thresholds finally biting here).
 *   2. **Absent is not zero-with-a-chance.** All components NULL, total
 *      0, the failing grade — and never rescued by grace marks.
 *   3. **Grace lifts a near-miss to exactly the pass mark, never past
 *      it,** is capped per subject AND in how many subjects it may be
 *      spent, and is recorded separately from the entered mark so the
 *      original number is never rewritten.
 */

import {
  failBand,
  gradeForPercentage,
  GradingSnapshot,
  round2,
} from './grading-snapshot';

/** The four splittable components, in report-card print order. */
export const COMPONENTS = ['cq', 'mcq', 'practical', 'ca'] as const;
export type Component = (typeof COMPONENTS)[number];

export const COMPONENT_LABELS: Record<Component, string> = {
  cq: 'CQ',
  mcq: 'MCQ',
  practical: 'Practical',
  ca: 'CA',
};

/** The Module 14 paper, as far as grading cares. */
export interface PaperSpec {
  examSubjectId: string;
  subjectId: string;
  subjectName: string;
  classId: string;
  fullMarks: number;
  passMarks: number;
  /** Allocation per component; null on a flat paper. */
  componentMarks: Partial<Record<Component, number | null>>;
  /** Non-null = this component must be cleared on its own. */
  componentPassMarks: Partial<Record<Component, number | null>>;
  /** The BD 4th subject — an F here never fails the candidate. */
  isOptional: boolean;
}

/** What the candidate actually scored, as stored on `marks`. */
export interface MarkEntry {
  cq?: number | null;
  mcq?: number | null;
  practical?: number | null;
  ca?: number | null;
  total: number;
  isAbsent: boolean;
}

export interface GraceOptions {
  /** Most marks grace may add to any one subject (`exam.grace_marks`). */
  graceMarks: number;
  /** In how many subjects grace may be spent at all. */
  graceMaxSubjects: number;
}

export interface SubjectOutcome {
  examSubjectId: string;
  subjectId: string;
  subjectName: string;
  isOptional: boolean;
  absent: boolean;
  /** Missing = no mark row exists for this paper yet. */
  missing: boolean;
  fullMarks: number;
  passMarks: number;
  /** Entered total, before grace. */
  rawMarks: number;
  graceApplied: number;
  /** `rawMarks + graceApplied` — what the report card prints. */
  obtained: number;
  percentage: number;
  grade: string;
  gradePoint: number;
  passed: boolean;
  /** Components whose own threshold was missed (labels, for the UI). */
  failedComponents: string[];
}

/**
 * Grade one exam's worth of papers for one candidate.
 *
 * Grace is a two-pass affair on purpose: which subjects deserve it can
 * only be decided once every subject has been evaluated, because the
 * allowance is a budget across the exam ("grace in at most one
 * subject"), not a per-subject entitlement. The cheapest deficits are
 * bought first — a student one mark short in two subjects with a budget
 * of one gets the one that rescues them, which is what a school means by
 * grace.
 */
export function evaluateSubjects(
  papers: PaperSpec[],
  marksByPaper: Map<string, MarkEntry>,
  snapshot: GradingSnapshot,
  grace: GraceOptions,
): SubjectOutcome[] {
  const first = papers.map((paper) =>
    evaluateSubject(paper, marksByPaper.get(paper.examSubjectId), snapshot),
  );

  const budget = Math.max(0, Math.floor(grace.graceMaxSubjects));
  const perSubject = Math.max(0, grace.graceMarks);
  if (budget === 0 || perSubject === 0) return first;

  // Rescuable = failed on the aggregate only (a missed component
  // threshold is a separate bar and grace does not buy it), by no more
  // than the per-subject allowance.
  const rescuable = first
    .map((outcome, index) => ({ outcome, index }))
    .filter(
      ({ outcome }) =>
        !outcome.passed &&
        !outcome.absent &&
        !outcome.missing &&
        outcome.failedComponents.length === 0 &&
        outcome.passMarks - outcome.rawMarks > 0 &&
        outcome.passMarks - outcome.rawMarks <= perSubject,
    )
    .sort(
      (a, b) =>
        a.outcome.passMarks -
        a.outcome.rawMarks -
        (b.outcome.passMarks - b.outcome.rawMarks),
    )
    .slice(0, budget);

  for (const { outcome, index } of rescuable) {
    const paper = papers[index];
    const granted = round2(outcome.passMarks - outcome.rawMarks);
    first[index] = evaluateSubject(
      paper,
      marksByPaper.get(paper.examSubjectId),
      snapshot,
      granted,
    );
  }

  return first;
}

/** One paper, one candidate. Exported for the unit suite's golden cases. */
export function evaluateSubject(
  paper: PaperSpec,
  mark: MarkEntry | undefined,
  snapshot: GradingSnapshot,
  graceApplied = 0,
): SubjectOutcome {
  const fail = failBand(snapshot);
  const base = {
    examSubjectId: paper.examSubjectId,
    subjectId: paper.subjectId,
    subjectName: paper.subjectName,
    isOptional: paper.isOptional,
    fullMarks: paper.fullMarks,
    passMarks: paper.passMarks,
  };

  // No mark row at all — the candidate joined mid-exam, or the paper was
  // never entered. Distinct from absent: the school still owes a number.
  if (!mark) {
    return {
      ...base,
      absent: false,
      missing: true,
      rawMarks: 0,
      graceApplied: 0,
      obtained: 0,
      percentage: 0,
      grade: fail.grade,
      gradePoint: fail.point,
      passed: false,
      failedComponents: [],
    };
  }

  if (mark.isAbsent) {
    return {
      ...base,
      absent: true,
      missing: false,
      rawMarks: 0,
      graceApplied: 0,
      obtained: 0,
      percentage: 0,
      grade: fail.grade,
      gradePoint: fail.point,
      passed: false,
      failedComponents: [],
    };
  }

  const rawMarks = round2(Number(mark.total) || 0);
  const grace = round2(Math.max(0, graceApplied));
  const obtained = round2(rawMarks + grace);

  const failedComponents: string[] = [];
  for (const component of COMPONENTS) {
    const threshold = paper.componentPassMarks[component];
    if (threshold === null || threshold === undefined) continue;
    const scored = Number(mark[component] ?? 0);
    if (scored < threshold) {
      failedComponents.push(
        `${COMPONENT_LABELS[component]} ${scored}/${threshold}`,
      );
    }
  }

  const passed = failedComponents.length === 0 && obtained >= paper.passMarks;
  const percentage =
    paper.fullMarks > 0 ? round2((obtained / paper.fullMarks) * 100) : 0;

  // A missed component threshold forces the failing grade even when the
  // aggregate would have earned an A+ — the band table only knows about
  // the total, so this correction has to live here.
  const band = passed ? gradeForPercentage(snapshot, percentage) : fail;

  return {
    ...base,
    absent: false,
    missing: false,
    rawMarks,
    graceApplied: grace,
    obtained,
    percentage,
    grade: band.grade,
    gradePoint: band.point,
    passed,
    failedComponents,
  };
}
