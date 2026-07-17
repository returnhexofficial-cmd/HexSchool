/**
 * Timetable conflict hook (roadmap M08 §4): the assignment service calls
 * this before claiming a slot. Until Module 13 exists there is no
 * timetable to conflict with — the no-op implementation always passes.
 * M13 replaces the provider with a real checker (same token).
 */
export const TIMETABLE_CONFLICT_CHECKER = Symbol('TIMETABLE_CONFLICT_CHECKER');

export interface TimetableConflictCheck {
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
