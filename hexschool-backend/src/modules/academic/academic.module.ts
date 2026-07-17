import { Module } from '@nestjs/common';
import { SchoolModule } from '../school/school.module';
import { TeachersRepository } from '../teacher/repositories/teachers.repository';
import { CalendarController } from './controllers/calendar.controller';
import { CalendarEventsController } from './controllers/calendar-events.controller';
import { ClassesController } from './controllers/classes.controller';
import { HolidaysController } from './controllers/holidays.controller';
import {
  DepartmentsController,
  GroupsController,
  ShiftsController,
  SubjectsController,
} from './controllers/masters.controllers';
import { SectionsController } from './controllers/sections.controller';
import { SessionsController } from './controllers/sessions.controller';
import { StructureController } from './controllers/structure.controller';
import { AcademicSessionsRepository } from './repositories/academic-sessions.repository';
import { CalendarEventsRepository } from './repositories/calendar-events.repository';
import { ClassSubjectsRepository } from './repositories/class-subjects.repository';
import { ClassesRepository } from './repositories/classes.repository';
import { DepartmentsRepository } from './repositories/departments.repository';
import { GroupsRepository } from './repositories/groups.repository';
import { HolidaysRepository } from './repositories/holidays.repository';
import { SectionsRepository } from './repositories/sections.repository';
import { ShiftsRepository } from './repositories/shifts.repository';
import { SubjectsRepository } from './repositories/subjects.repository';
import { CalendarService } from './services/calendar.service';
import { CalendarEventsService } from './services/calendar-events.service';
import { ClassSubjectsService } from './services/class-subjects.service';
import { HolidaysService } from './services/holidays.service';
import { MastersService } from './services/masters.service';
import { SectionsService } from './services/sections.service';
import { SessionsService } from './services/sessions.service';
import { StructureCloneService } from './services/structure-clone.service';

/**
 * Modules 05+06 — the `src/modules/academic` domain: sessions +
 * calendar (M05) and structure (M06: departments/shifts/classes/groups/
 * sections/subjects + curriculum mapping + clone-to-session). Exports
 * CalendarService (`isHoliday` for Attendance/Payroll), SessionsService
 * (current-session resolution), and the roster-side repositories later
 * modules build on (M11 enrollment).
 */
@Module({
  imports: [SchoolModule], // SettingsService → weekly holidays
  controllers: [
    SessionsController,
    HolidaysController,
    CalendarEventsController,
    CalendarController,
    DepartmentsController,
    ShiftsController,
    GroupsController,
    SubjectsController,
    ClassesController,
    SectionsController,
    StructureController,
  ],
  providers: [
    SessionsService,
    HolidaysService,
    CalendarEventsService,
    CalendarService,
    MastersService,
    SectionsService,
    ClassSubjectsService,
    StructureCloneService,
    AcademicSessionsRepository,
    HolidaysRepository,
    CalendarEventsRepository,
    DepartmentsRepository,
    ShiftsRepository,
    ClassesRepository,
    GroupsRepository,
    SectionsRepository,
    SubjectsRepository,
    ClassSubjectsRepository,
    // Stateless re-provision (M07 convention): SectionsService validates
    // class teachers (M08) without importing TeacherModule — that module
    // imports THIS one for SessionsService, so the graph stays acyclic.
    TeachersRepository,
  ],
  exports: [SessionsService, CalendarService, SectionsRepository],
})
export class AcademicModule {}
