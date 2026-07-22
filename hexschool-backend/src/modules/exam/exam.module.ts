import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module';
import { ClassesRepository } from '../academic/repositories/classes.repository';
import { ClassSubjectsRepository } from '../academic/repositories/class-subjects.repository';
import { SubjectsRepository } from '../academic/repositories/subjects.repository';
import { EnrollmentModule } from '../enrollment/enrollment.module';
import { RbacModule } from '../rbac/rbac.module';
import { SchoolModule } from '../school/school.module';
import { GradingSystemsRepository } from '../school/repositories/grading-systems.repository';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { StorageModule } from '../storage/storage.module';
import { ExamTypesController } from './controllers/exam-types.controller';
import { ExamsController } from './controllers/exams.controller';
import { ExamSubjectsRepository } from './repositories/exam-subjects.repository';
import { ExamTypesRepository } from './repositories/exam-types.repository';
import { ExamsRepository } from './repositories/exams.repository';
import { SeatPlansRepository } from './repositories/seat-plans.repository';
import { AdmitCardService } from './services/admit-card.service';
import { ExamClashService } from './services/exam-clash.service';
import { ExamExportService } from './services/exam-export.service';
import { ExamRoutineService } from './services/exam-routine.service';
import { ExamSettingsService } from './services/exam-settings.service';
import { ExamSubjectsService } from './services/exam-subjects.service';
import { ExamTypesService } from './services/exam-types.service';
import { ExamsService } from './services/exams.service';
import {
  EXAM_DUES_GATE,
  EXAM_RESULT_GATE,
  NoopExamDuesGate,
  NoopExamResultGate,
} from './services/exam.gates';
import { SeatPlansService } from './services/seat-plans.service';

/**
 * Module 14 — Examination Management: exam types, the exam aggregate and
 * its status machine, per-paper mark distribution, the sitting routine
 * with clash detection, seat plans, and admit cards.
 *
 * AcademicModule supplies SessionsService + CalendarService (both
 * exported); EnrollmentModule the canonical roster repository the seat
 * plan and admit cards draw candidates from; SchoolModule the
 * SettingsService behind `exam.*`; RbacModule the runtime permission
 * checks behind the two overrides; StorageModule the student photos and
 * school logo printed on admit cards. The remaining repositories are
 * stateless re-provisions (the M07 convention).
 *
 * Two DI tokens are declared here and bound to no-ops on purpose:
 * `EXAM_RESULT_GATE` (Module 15 decides when results may be published)
 * and `EXAM_DUES_GATE` (Module 16 decides who owes money). This is the
 * same shape M08 used for `TIMETABLE_CONFLICT_CHECKER`, which M13 later
 * bound for real.
 */
@Module({
  imports: [
    AcademicModule,
    EnrollmentModule,
    SchoolModule,
    RbacModule,
    StorageModule,
  ],
  controllers: [ExamTypesController, ExamsController],
  providers: [
    ExamTypesService,
    ExamsService,
    ExamSubjectsService,
    ExamRoutineService,
    ExamClashService,
    SeatPlansService,
    AdmitCardService,
    ExamExportService,
    ExamSettingsService,
    ExamTypesRepository,
    ExamsRepository,
    ExamSubjectsRepository,
    SeatPlansRepository,
    // Stateless re-provisions (only need PrismaService).
    ClassesRepository,
    ClassSubjectsRepository,
    SubjectsRepository,
    GradingSystemsRepository,
    SchoolsRepository,
    { provide: EXAM_RESULT_GATE, useClass: NoopExamResultGate },
    { provide: EXAM_DUES_GATE, useClass: NoopExamDuesGate },
  ],
  // Module 15 consumes the exam aggregate and its papers for mark entry;
  // M18 renders the routine in the portals.
  exports: [
    ExamsService,
    ExamsRepository,
    ExamSubjectsRepository,
    ExamRoutineService,
  ],
})
export class ExamModule {}
