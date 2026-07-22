import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import {
  NOTIFICATIONS_QUEUE,
  RESULTS_QUEUE,
} from '../../queues/queues.constants';
import { AcademicModule } from '../academic/academic.module';
import { ClassSubjectsRepository } from '../academic/repositories/class-subjects.repository';
import { StudentAttendancesRepository } from '../attendance/repositories/student-attendances.repository';
import { EnrollmentModule } from '../enrollment/enrollment.module';
import { ExamModule } from '../exam/exam.module';
import { RbacModule } from '../rbac/rbac.module';
import { SchoolModule } from '../school/school.module';
import { GradingSystemsRepository } from '../school/repositories/grading-systems.repository';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { StudentGuardiansRepository } from '../student/repositories/student-guardians.repository';
import { StudentModule } from '../student/student.module';
import { CombinedResultsController } from './controllers/combined-results.controller';
import { MarksController } from './controllers/marks.controller';
import {
  ExamResultsController,
  ResultsController,
} from './controllers/results.controller';
import {
  PublicResultsController,
  StudentResultsController,
} from './controllers/student-results.controller';
import { ResultProcessingProcessor } from './jobs/result-processing.processor';
import { CombinedResultsRepository } from './repositories/combined-results.repository';
import { MarkCorrectionsRepository } from './repositories/mark-corrections.repository';
import { MarksRepository } from './repositories/marks.repository';
import { ResultPublicationsRepository } from './repositories/result-publications.repository';
import { ResultRunsRepository } from './repositories/result-runs.repository';
import { ResultsRepository } from './repositories/results.repository';
import { CombinedResultsService } from './services/combined-results.service';
import { MarksService } from './services/marks.service';
import { ResultAnalyticsService } from './services/result-analytics.service';
import { ResultCandidatesService } from './services/result-candidates.service';
import { ResultExportService } from './services/result-export.service';
import { ResultProcessingService } from './services/result-processing.service';
import { ResultPublicationService } from './services/result-publication.service';
import { ResultQueueService } from './services/result-queue.service';
import { ResultReadinessGate } from './services/result-readiness.gate';
import { ResultReportsService } from './services/result-reports.service';
import { ResultSettingsService } from './services/result-settings.service';
import { ResultsService } from './services/results.service';

/**
 * Module 15 — Marks & Result Processing: the mark-entry lifecycle, the
 * calculation engines, processing runs, publication, report cards,
 * tabulation, transcripts, analytics and combined results.
 *
 * `ExamModule` supplies the exam aggregate and its papers (and is where
 * this module's `EXAM_RESULT_GATE` provider is bound — see
 * `result-readiness.gate.ts` for why it is bound *there* rather than
 * here); `EnrollmentModule` the canonical roster; `AcademicModule`
 * sessions and the curriculum's optional flag; `SchoolModule` settings
 * and grading systems; `StudentModule` the primary-guardian lookup the
 * result SMS needs; `RbacModule` the runtime permission checks.
 *
 * `StudentAttendancesRepository` and the academic/school repositories
 * are stateless re-provisions (the M07 convention) — importing
 * `AttendanceModule` for one percentage on a report card would be the
 * wrong dependency, and the shared pure engine does the arithmetic.
 */
@Module({
  imports: [
    AcademicModule,
    EnrollmentModule,
    ExamModule,
    SchoolModule,
    StudentModule,
    RbacModule,
    // `results` carries processing runs; `notifications` carries the
    // "GPA 4.83, Merit 3" SMS at publication (M02's shared queue).
    BullModule.registerQueue(
      { name: RESULTS_QUEUE },
      { name: NOTIFICATIONS_QUEUE },
    ),
  ],
  controllers: [
    MarksController,
    ExamResultsController,
    ResultsController,
    CombinedResultsController,
    StudentResultsController,
    PublicResultsController,
  ],
  providers: [
    MarksService,
    ResultsService,
    ResultProcessingService,
    ResultQueueService,
    ResultPublicationService,
    ResultReportsService,
    ResultExportService,
    ResultAnalyticsService,
    ResultCandidatesService,
    ResultSettingsService,
    CombinedResultsService,
    // Also provided (and bound to EXAM_RESULT_GATE) inside ExamModule.
    // Re-providing it here lets the publication service consult it
    // directly — a republish never reaches the exam status machine, so
    // that was the only way to gate one.
    ResultReadinessGate,
    ResultProcessingProcessor,
    MarksRepository,
    MarkCorrectionsRepository,
    ResultsRepository,
    ResultRunsRepository,
    ResultPublicationsRepository,
    CombinedResultsRepository,
    // Stateless re-provisions (only need PrismaService).
    ClassSubjectsRepository,
    GradingSystemsRepository,
    SchoolsRepository,
    StudentAttendancesRepository,
    // The result SMS needs each student's primary guardian phone.
    // StudentModule keeps this repository internal, so it is
    // re-provisioned here exactly as M12's absent-SMS job does.
    StudentGuardiansRepository,
  ],
  // M18 portals render a student's results; M16 reads publication state
  // to decide whether a dues block should hide one.
  exports: [
    ResultsService,
    ResultsRepository,
    MarksRepository,
    ResultReportsService,
  ],
})
export class ResultModule {}
