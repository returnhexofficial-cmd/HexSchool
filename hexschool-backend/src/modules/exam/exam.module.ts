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
import { EXAM_DUES_GATE, EXAM_RESULT_GATE, NoopExamDuesGate } from './services/exam.gates';
import { MarksRepository } from '../result/repositories/marks.repository';
import { ResultRunsRepository } from '../result/repositories/result-runs.repository';
import { ResultsRepository } from '../result/repositories/results.repository';
import { ResultReadinessGate } from '../result/services/result-readiness.gate';
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
 * Two DI tokens are declared here for other modules to fill.
 * `EXAM_RESULT_GATE` is **live since M15** — bound to
 * `ResultReadinessGate`, which refuses publication until the results
 * have actually been processed and still describe the marks on file.
 * `EXAM_DUES_GATE` is still a no-op until Module 16 binds a ledger.
 *
 * The result gate's code lives in the result module but is bound *here*,
 * over re-provisioned (stateless) result repositories: `ResultModule`
 * imports `ExamModule` for the exam aggregate, so binding it the other
 * way round would close a cycle. This is exactly the shape M13 used to
 * make M08's `TIMETABLE_CONFLICT_CHECKER` real.
 *
 * `MarksRepository` is re-provisioned for a second reason: the M14
 * delete guards on `exam_classes` / `exam_subjects` were slots waiting
 * for a marks table, and now have one.
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
    MarksRepository,
    ResultsRepository,
    ResultRunsRepository,
    { provide: EXAM_RESULT_GATE, useClass: ResultReadinessGate },
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
