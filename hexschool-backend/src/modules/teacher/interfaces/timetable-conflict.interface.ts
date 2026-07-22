/**
 * Timetable conflict hook (roadmap M08 §4): the assignment service calls
 * this before claiming a slot. It was a no-op until Module 13; that
 * module's `RoutineConflictChecker` is now bound to the token and refuses
 * a reassignment whose published routine cells would put the incoming
 * teacher in two places at once. The no-op below is kept for unit tests
 * that exercise M08 in isolation.
 */
export const TIMETABLE_CONFLICT_CHECKER = Symbol('TIMETABLE_CONFLICT_CHECKER');

export interface TimetableConflictCheck {
  /** Tenant scope — the checker reads routine cells across sections. */
  schoolId: string;
  sessionId: string;
  sectionId: string;
  subjectId: string;
  teacherId: string;
}

export interface TimetableConflictChecker {
  /** Throws ConflictException when the assignment collides with the routine. */
  assertNoConflict(check: TimetableConflictCheck): Promise<void>;
}

export class NoopTimetableConflictChecker implements TimetableConflictChecker {
  async assertNoConflict(): Promise<void> {
    // No timetable until M13 — nothing can conflict.
  }
}
