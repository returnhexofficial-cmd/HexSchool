import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module';
import { ClassSubjectsRepository } from '../academic/repositories/class-subjects.repository';
import { ShiftsRepository } from '../academic/repositories/shifts.repository';
import { SubjectsRepository } from '../academic/repositories/subjects.repository';
import { RbacModule } from '../rbac/rbac.module';
import { SchoolModule } from '../school/school.module';
import { TeacherModule } from '../teacher/teacher.module';
import { TeacherAssignmentsRepository } from '../teacher/repositories/teacher-assignments.repository';
import { PeriodSlotsController } from './controllers/period-slots.controller';
import { RoutinesController } from './controllers/routines.controller';
import { TimetablesController } from './controllers/timetables.controller';
import { PeriodSlotsRepository } from './repositories/period-slots.repository';
import { TimetableEntriesRepository } from './repositories/timetable-entries.repository';
import { TimetablesRepository } from './repositories/timetables.repository';
import { PeriodSlotsService } from './services/period-slots.service';
import { RoutineExportService } from './services/routine-export.service';
import { RoutineService } from './services/routine.service';
import { TimetableService } from './services/timetable.service';
import { TimetableSettingsService } from './services/timetable-settings.service';

/**
 * Module 13 — Timetable / Class Routine: the per-shift bell schedule,
 * versioned section routines built as drafts and published behind the
 * conflict engine, teacher/section/master read views, printable PDFs,
 * and `getCurrentPeriod()` for period-mode attendance.
 *
 * AcademicModule supplies SessionsService, CalendarService and
 * SectionsRepository (all exported); TeacherModule supplies
 * TeachersRepository; RbacModule the runtime permission checks behind the
 * assignment override and the draft-preview flag. The remaining
 * repositories are stateless re-provisions (M07 convention).
 *
 * Note the direction of the M08 integration: the real
 * `TIMETABLE_CONFLICT_CHECKER` lives HERE but is bound inside
 * TeacherModule over a re-provisioned `TimetableEntriesRepository` —
 * this module imports TeacherModule, so the reverse import would cycle.
 */
@Module({
  imports: [AcademicModule, TeacherModule, SchoolModule, RbacModule],
  controllers: [
    PeriodSlotsController,
    TimetablesController,
    RoutinesController,
  ],
  providers: [
    PeriodSlotsService,
    TimetableService,
    RoutineService,
    RoutineExportService,
    TimetableSettingsService,
    PeriodSlotsRepository,
    TimetablesRepository,
    TimetableEntriesRepository,
    // Stateless re-provisions (only need PrismaService).
    ShiftsRepository,
    SubjectsRepository,
    ClassSubjectsRepository,
    TeacherAssignmentsRepository,
  ],
  // RoutineService.getCurrentPeriod + the slot repository are what M12
  // period-mode attendance consumes; M14 reuses the slots for exam
  // routines and M18 renders routines in the portals.
  exports: [RoutineService, PeriodSlotsRepository, TimetableEntriesRepository],
})
export class TimetableModule {}
