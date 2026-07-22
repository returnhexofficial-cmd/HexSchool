import { ConflictException, Injectable } from '@nestjs/common';
import { TimetableStatus } from '../../../common/constants';
import type {
  TimetableConflictCheck,
  TimetableConflictChecker,
} from '../../teacher/interfaces/timetable-conflict.interface';
import {
  EntryWithRelations,
  TimetableEntriesRepository,
} from '../repositories/timetable-entries.repository';
import { overlaps, type TimeWindow } from '../calc/conflict.engine';
import { timeColumnMinutes } from '../../../common/utils/clock.util';

/**
 * The real `TIMETABLE_CONFLICT_CHECKER` (M08's hook, no-op until now).
 *
 * The question at assignment time is narrower than the builder's: the
 * routine cells for (section, subject) already exist and name a teacher;
 * handing them to somebody else is only safe if that person is free in
 * every one of those slots. So this walks the published cells the
 * reassignment would move and checks each against the incoming teacher's
 * own week.
 *
 * It is bound in `TeacherModule` over a re-provisioned repository rather
 * than by importing TimetableModule — that module imports TeacherModule
 * for `TeachersRepository`, and the DI graph must stay acyclic (the M07
 * stateless-re-provision convention).
 */
@Injectable()
export class RoutineConflictChecker implements TimetableConflictChecker {
  constructor(private readonly entries: TimetableEntriesRepository) {}

  async assertNoConflict(check: TimetableConflictCheck): Promise<void> {
    const published = [TimetableStatus.PUBLISHED];

    // The cells this assignment would put the new teacher in front of.
    const sessionCells = await this.entries.findForSession(
      check.schoolId,
      check.sessionId,
      published,
    );
    const affected = sessionCells.filter(
      (cell) =>
        cell.timetable.sectionId === check.sectionId &&
        cell.subjectId === check.subjectId,
    );
    if (affected.length === 0) return;

    // Everything the incoming teacher is already doing elsewhere.
    const theirs = sessionCells.filter(
      (cell) =>
        cell.teacherId === check.teacherId &&
        cell.timetable.sectionId !== check.sectionId,
    );
    if (theirs.length === 0) return;

    for (const cell of affected) {
      const clash = theirs.find((other) =>
        overlaps(this.window(cell), this.window(other)),
      );
      if (!clash) continue;
      // A combined class is not a clash — the pair is one lesson.
      if (
        clash.combinedWithSectionId === check.sectionId ||
        cell.combinedWithSectionId === clash.timetable.sectionId
      ) {
        continue;
      }
      throw new ConflictException(
        `The routine puts this teacher in ${cell.timetable.section.class.name} — ${cell.timetable.section.name} on ${cell.day} ${cell.periodSlot.name}, when they already teach ${clash.timetable.section.class.name} — ${clash.timetable.section.name}. Change the routine first.`,
      );
    }
  }

  /** Only the fields `overlaps` reads — the engine's Booking is wider. */
  private window(cell: EntryWithRelations): TimeWindow {
    return {
      day: cell.day,
      startMinutes: timeColumnMinutes(cell.periodSlot.startTime),
      endMinutes: timeColumnMinutes(cell.periodSlot.endTime),
    };
  }
}
