import { Weekday } from '../../../common/constants';

/**
 * The routine conflict engine (roadmap M13 §4), a dependency-free pure
 * module so the rule matrix is unit-testable without a database.
 *
 * The central decision: bookings are compared by their **wall-clock
 * window**, never by `period_slot_id`. Slots belong to a shift, so the
 * morning shift's "Period 3" and the day shift's "Period 1" are
 * different rows that can cover the same minutes — a part-time teacher
 * working across both shifts is exactly the clash schools care about
 * (roadmap M13 §8), and an id comparison would miss it. It also means a
 * school can define irregular per-shift slots and still get correct
 * answers.
 */

/** The minimum needed to ask "do these two collide in time?". */
export interface TimeWindow {
  day: Weekday;
  startMinutes: number;
  endMinutes: number;
}

/** One occupied cell, flattened out of the timetable/section joins. */
export interface Booking extends TimeWindow {
  /** Owning timetable — candidates from the edited routine share one. */
  timetableId: string;
  sectionId: string;
  /** Human label for conflict messages, e.g. "Class 7 — B". */
  sectionLabel: string;
  slotId: string;
  slotName: string;
  teacherId: string;
  teacherName: string;
  roomNo: string | null;
  /** Explicit combined-class marker (roadmap M13 §8). */
  combinedWithSectionId: string | null;
}

export type ConflictKind =
  'TEACHER' | 'ROOM' | 'DUPLICATE_CELL' | 'TEACHER_DAILY_CAP';

export interface Conflict {
  kind: ConflictKind;
  day: Weekday;
  slotId: string;
  /** Section the offending candidate belongs to. */
  sectionId: string;
  /** Ready-to-render explanation ("Mr. X busy in 7-B"). */
  message: string;
  /** The booking clashed with, when the conflict is a pairwise one. */
  clashesWith?: {
    sectionId: string;
    sectionLabel: string;
    slotName: string;
    teacherId: string;
    roomNo: string | null;
  };
}

export interface ConflictOptions {
  /** `academic.timetable_room_conflict_check`. */
  checkRooms: boolean;
  /** `academic.timetable_allow_combined_classes` — off means the marker
   *  stops excusing a shared teacher and every overlap is a conflict. */
  allowCombined: boolean;
  /** `academic.timetable_max_periods_per_teacher_per_day`; 0 = unlimited. */
  maxPeriodsPerTeacherPerDay: number;
}

/** Half-open overlap: 08:00–08:45 and 08:45–09:30 do NOT collide. */
export function overlaps(a: TimeWindow, b: TimeWindow): boolean {
  return (
    a.day === b.day &&
    a.startMinutes < b.endMinutes &&
    b.startMinutes < a.endMinutes
  );
}

/** Rooms match case- and padding-insensitively ("101" === " 101 "). */
function sameRoom(a: Booking, b: Booking): boolean {
  if (!a.roomNo || !b.roomNo) return false;
  return a.roomNo.trim().toLowerCase() === b.roomNo.trim().toLowerCase();
}

/**
 * A legitimate combined class: the two sections sit the same lesson, and
 * at least one side declares the other. One-sided is enough — the
 * builder marks the cell it is editing, and requiring both routines to
 * be saved in lockstep would make the first save impossible.
 */
function isCombinedPair(a: Booking, b: Booking): boolean {
  return (
    a.combinedWithSectionId === b.sectionId ||
    b.combinedWithSectionId === a.sectionId
  );
}

/**
 * Every conflict raised by `candidates` — the cells about to be written —
 * against `existing`, the live bookings of every OTHER section in the
 * same session. Candidates are also checked against each other, which is
 * what catches a bulk payload that books one teacher twice at once.
 *
 * `existing` must already exclude the timetable being edited: entry
 * upsert replaces that routine wholesale, so its own old rows are not
 * competition.
 */
export function detectConflicts(
  candidates: Booking[],
  existing: Booking[],
  options: ConflictOptions,
): Conflict[] {
  const conflicts: Conflict[] = [];

  // Two candidates aimed at the same cell — the DB unique would reject
  // the write with an opaque 500, so name it properly first.
  const seen = new Map<string, Booking>();
  for (const candidate of candidates) {
    const key = `${candidate.timetableId}|${candidate.day}|${candidate.slotId}`;
    const previous = seen.get(key);
    if (previous) {
      conflicts.push({
        kind: 'DUPLICATE_CELL',
        day: candidate.day,
        slotId: candidate.slotId,
        sectionId: candidate.sectionId,
        message: `${candidate.day} ${candidate.slotName} is listed twice in this submission`,
      });
      continue;
    }
    seen.set(key, candidate);
  }

  // Pairwise checks. Candidates compete with the rest of the school and
  // with each other; `index + 1` keeps candidate pairs from being
  // reported from both directions.
  for (const [index, candidate] of candidates.entries()) {
    const others = [...existing, ...candidates.slice(index + 1)];
    for (const other of others) {
      if (!overlaps(candidate, other)) continue;
      if (candidate.sectionId === other.sectionId) continue;

      const combined =
        options.allowCombined && isCombinedPair(candidate, other);

      if (candidate.teacherId === other.teacherId && !combined) {
        conflicts.push({
          kind: 'TEACHER',
          day: candidate.day,
          slotId: candidate.slotId,
          sectionId: candidate.sectionId,
          message: `${candidate.teacherName} is busy in ${other.sectionLabel} (${other.slotName})`,
          clashesWith: describe(other),
        });
      }

      if (options.checkRooms && sameRoom(candidate, other) && !combined) {
        conflicts.push({
          kind: 'ROOM',
          day: candidate.day,
          slotId: candidate.slotId,
          sectionId: candidate.sectionId,
          message: `Room ${candidate.roomNo} is taken by ${other.sectionLabel} (${other.slotName})`,
          clashesWith: describe(other),
        });
      }
    }
  }

  conflicts.push(...dailyCapConflicts(candidates, existing, options));
  return conflicts;
}

/**
 * Workload guard: a teacher may not exceed N periods on one day.
 * Combined classes count once — the teacher stands in one room.
 */
function dailyCapConflicts(
  candidates: Booking[],
  existing: Booking[],
  options: ConflictOptions,
): Conflict[] {
  const cap = options.maxPeriodsPerTeacherPerDay;
  if (cap <= 0) return [];

  const conflicts: Conflict[] = [];
  const editedTimetables = new Set(candidates.map((c) => c.timetableId));
  const pool = [
    ...existing.filter((b) => !editedTimetables.has(b.timetableId)),
    ...candidates,
  ];

  for (const candidate of candidates) {
    const sameDay = pool.filter(
      (b) => b.teacherId === candidate.teacherId && b.day === candidate.day,
    );
    // Distinct wall-clock windows: a combined class booked twice at the
    // same minutes is one period of work, not two.
    const windows = new Set(
      sameDay.map((b) => `${b.startMinutes}-${b.endMinutes}`),
    );
    if (windows.size > cap) {
      conflicts.push({
        kind: 'TEACHER_DAILY_CAP',
        day: candidate.day,
        slotId: candidate.slotId,
        sectionId: candidate.sectionId,
        message: `${candidate.teacherName} would teach ${windows.size} periods on ${candidate.day} (limit ${cap})`,
      });
    }
  }

  // One row per teacher+day is enough — the cap is not per cell.
  return dedupe(conflicts);
}

function describe(booking: Booking): Conflict['clashesWith'] {
  return {
    sectionId: booking.sectionId,
    sectionLabel: booking.sectionLabel,
    slotName: booking.slotName,
    teacherId: booking.teacherId,
    roomNo: booking.roomNo,
  };
}

function dedupe(conflicts: Conflict[]): Conflict[] {
  const seen = new Set<string>();
  return conflicts.filter((c) => {
    const key = `${c.kind}|${c.day}|${c.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
