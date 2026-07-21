import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module';
import { AcademicSessionsRepository } from '../academic/repositories/academic-sessions.repository';
import { ClassSubjectsRepository } from '../academic/repositories/class-subjects.repository';
import { RbacModule } from '../rbac/rbac.module';
import { StudentModule } from '../student/student.module';
import { EnrollmentsController } from './controllers/enrollments.controller';
import { PromotionsController } from './controllers/promotions.controller';
import { SectionStudentsController } from './controllers/section-students.controller';
import { EnrollmentsRepository } from './repositories/enrollments.repository';
import { EnrollmentTransfersRepository } from './repositories/enrollment-transfers.repository';
import { PromotionBatchesRepository } from './repositories/promotion-batches.repository';
import { PromotionItemsRepository } from './repositories/promotion-items.repository';
import { EnrollmentsService } from './services/enrollments.service';
import { PromotionService } from './services/promotion.service';

/**
 * Module 11 — Enrollment & Promotion: binds students to sections with
 * roll numbers (single/bulk, capacity + override, section transfer), the
 * yearly promotion wizard (build/preview/execute/rollback), and the
 * canonical roster queries (`getSectionStudents` /
 * `getStudentCurrentEnrollment`, exported for M12/M14/M16). Also closes
 * the M09 debt: section-scoped batch ID cards.
 *
 * AcademicModule supplies SectionsRepository (exported); the other
 * academic repositories are stateless re-provisions (M07 convention).
 * StudentModule supplies StudentsRepository / StudentStatusHistory /
 * IdCardService; RbacModule supplies PermissionsService (capacity
 * override).
 */
@Module({
  imports: [AcademicModule, StudentModule, RbacModule],
  controllers: [
    EnrollmentsController,
    PromotionsController,
    SectionStudentsController,
  ],
  providers: [
    EnrollmentsService,
    PromotionService,
    EnrollmentsRepository,
    EnrollmentTransfersRepository,
    PromotionBatchesRepository,
    PromotionItemsRepository,
    // Stateless re-provisions (only need PrismaService).
    ClassSubjectsRepository,
    AcademicSessionsRepository,
  ],
  // Canonical roster service for Attendance (M12), Exams (M14), Fees (M16).
  exports: [EnrollmentsService, EnrollmentsRepository],
})
export class EnrollmentModule {}
