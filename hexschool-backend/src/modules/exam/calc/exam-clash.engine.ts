/**
 * Exam routine clash detection (roadmap M14 §4).
 *
 * Dependency-free like the M13 `conflict.engine` it is modelled on, and
 * for the same reason: the rules are pure arithmetic over a list of
 * sittings, so they are unit-testable without a database and reusable by
 * the scheduler, the bulk routine save, and the pre-flight probe.
 *
 * The important design echo from M13: **windows are compared as
 * wall-clock minutes, never as slot ids.** Exam sittings deliberately do
 * not reuse M13 `period_slots` (a 3-hour paper does not fit a 40-minute
 * bell), so a shared vocabulary of slots does not exist here at all —
 * minutes are the only thing two sittings have in common.
 */

export type ExamClashKind =
  | 'ROOM'
  | 'CLASS_OVERLAP'
  | 'CLASS_SAME_DAY'
  | 'OUTSIDE_WINDOW'
  | 'DUPLICATE_PAPER';

export interface Sitting {
  /** `exam_subjects.id`; `null` for a not-yet-saved probe. */
  examSubjectId: string | null;
  examId: string;
  classId: string;
  classLabel: string;
  subjectId: string;
  subjectName: string;
  /** YYYY-MM-DD. */
  date: string;
  startMinutes: number;
  endMinutes: number;
  room: string | null;
}

export interface ExamClash {
  kind: ExamClashKind;
  examSubjectId: string | null;
  date: string;
  classId: string;
  subjectId: string;
  message: string;
  clashesWith?: {
    examSubjectId: string | null;
    classLabel: string;
    subjectName: string;
    room: string | null;
    window: string;
  };
}

export interface ClashOptions {
  /** `exam.room_conflict_check`. */
  checkRooms: boolean;
  /** `exam.allow_multiple_papers_per_day` — off makes same-day a clash. */
  allowMultiplePapersPerDay: boolean;
  /** The exam window; sittings outside it are always refused. */
  window: { startDate: string; endDate: string };
}

const label = (s: Sitting): string =>
  `${s.date} ${clock(s.startMinutes)}–${clock(s.endMinutes)}`;

/** Minutes-of-day → "HH:mm" for human-facing clash messages. */
export function clock(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

/** Half-open overlap: a sitting ending at 12:00 does not clash with 12:00. */
function overlaps(a: Sitting, b: Sitting): boolean {
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

const sameRoom = (a: Sitting, b: Sitting): boolean =>
  a.room !== null &&
  b.room !== null &&
  a.room.trim().toLowerCase() === b.room.trim().toLowerCase();

/**
 * Every clash between the candidate sittings and each other, plus against
 * `existing` (sittings already saved elsewhere — other exams of the same
 * session competing for the same rooms).
 *
 * Candidates are compared pairwise among themselves so a single bulk save
 * cannot smuggle in a self-inconsistent routine; `existing` is only ever
 * on the right-hand side of a comparison.
 */
export function detectClashes(
  candidates: Sitting[],
  existing: Sitting[],
  options: ClashOptions,
): ExamClash[] {
  const clashes: ExamClash[] = [];
  const seenPaper = new Set<string>();

  for (const s of candidates) {
    // A payload may not schedule the same paper twice.
    const paperKey = `${s.examId}|${s.classId}|${s.subjectId}`;
    if (seenPaper.has(paperKey)) {
      clashes.push({
        kind: 'DUPLICATE_PAPER',
        examSubjectId: s.examSubjectId,
        date: s.date,
        classId: s.classId,
        subjectId: s.subjectId,
        message: `${s.classLabel} — ${s.subjectName} appears more than once in this routine`,
      });
    }
    seenPaper.add(paperKey);

    if (s.date < options.window.startDate || s.date > options.window.endDate) {
      clashes.push({
        kind: 'OUTSIDE_WINDOW',
        examSubjectId: s.examSubjectId,
        date: s.date,
        classId: s.classId,
        subjectId: s.subjectId,
        message: `${s.subjectName} is scheduled for ${s.date}, outside the exam window ${options.window.startDate} → ${options.window.endDate}`,
      });
    }
  }

  const compare = (a: Sitting, b: Sitting, bIsCandidate: boolean): void => {
    if (a.date !== b.date) return;

    const witness = {
      examSubjectId: b.examSubjectId,
      classLabel: b.classLabel,
      subjectName: b.subjectName,
      room: b.room,
      window: label(b),
    };

    // A class physically cannot sit two papers at once — never overridable.
    if (a.classId === b.classId && overlaps(a, b)) {
      clashes.push({
        kind: 'CLASS_OVERLAP',
        examSubjectId: a.examSubjectId,
        date: a.date,
        classId: a.classId,
        subjectId: a.subjectId,
        message: `${a.classLabel} sits ${a.subjectName} and ${b.subjectName} at overlapping times on ${a.date}`,
        clashesWith: witness,
      });
    } else if (
      a.classId === b.classId &&
      !options.allowMultiplePapersPerDay &&
      // Only report the pair once when both sides are candidates.
      (!bIsCandidate || (a.examSubjectId ?? '') <= (b.examSubjectId ?? ''))
    ) {
      clashes.push({
        kind: 'CLASS_SAME_DAY',
        examSubjectId: a.examSubjectId,
        date: a.date,
        classId: a.classId,
        subjectId: a.subjectId,
        message: `${a.classLabel} already sits ${b.subjectName} on ${a.date} (exam.allow_multiple_papers_per_day is off)`,
        clashesWith: witness,
      });
    }

    if (options.checkRooms && sameRoom(a, b) && overlaps(a, b)) {
      clashes.push({
        kind: 'ROOM',
        examSubjectId: a.examSubjectId,
        date: a.date,
        classId: a.classId,
        subjectId: a.subjectId,
        message: `Room ${a.room} holds ${b.classLabel} — ${b.subjectName} at ${label(b)}`,
        clashesWith: witness,
      });
    }
  };

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      compare(candidates[i], candidates[j], true);
    }
    for (const other of existing) {
      compare(candidates[i], other, false);
    }
  }

  return clashes;
}

/**
 * Which clashes may be waived with `exam.schedule.override`.
 *
 * Two tiers, the same split M13 settled on: a clash that makes the
 * routine physically impossible (one class in two halls at once, a room
 * double-booked, a date outside the exam) is structural and can never be
 * overridden. "Two papers on one day" is a school policy, and schools
 * routinely break their own policy in the last week of an exam — so that
 * one is waivable.
 */
export const OVERRIDABLE_KINDS: ReadonlySet<ExamClashKind> =
  new Set<ExamClashKind>(['CLASS_SAME_DAY']);

export function splitByOverridability(clashes: ExamClash[]): {
  structural: ExamClash[];
  waivable: ExamClash[];
} {
  return {
    structural: clashes.filter((c) => !OVERRIDABLE_KINDS.has(c.kind)),
    waivable: clashes.filter((c) => OVERRIDABLE_KINDS.has(c.kind)),
  };
}
