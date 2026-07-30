import { Module } from '@nestjs/common';
import { AcademicModule } from '../academic/academic.module';
import { CommunicationModule } from '../communication/communication.module';
import { EnrollmentModule } from '../enrollment/enrollment.module';
import { RbacModule } from '../rbac/rbac.module';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { StorageModule } from '../storage/storage.module';
import {
  ATTACHMENT_SCANNER,
  PassThroughAttachmentScanner,
} from './assignment.constants';
import {
  AssignmentsController,
  SubmissionsController,
} from './controllers/assignments.controller';
import { LearningMaterialsController } from './controllers/learning-materials.controller';
import { AssignmentRemindersJob } from './jobs/assignment-reminders.job';
import { AssignmentsRepository } from './repositories/assignments.repository';
import { LearningMaterialsRepository } from './repositories/learning-materials.repository';
import { SubmissionsRepository } from './repositories/submissions.repository';
import { AssignmentExportService } from './services/assignment-export.service';
import { AssignmentNotificationsService } from './services/assignment-notifications.service';
import { AssignmentPolicyService } from './services/assignment-policy.service';
import { AssignmentSettingsService } from './services/assignment-settings.service';
import { AssignmentUploadsService } from './services/assignment-uploads.service';
import { AssignmentsService } from './services/assignments.service';
import { LearningMaterialsService } from './services/learning-materials.service';
import { StudentAssignmentsService } from './services/student-assignments.service';
import { SubmissionsService } from './services/submissions.service';

/**
 * Module 22 — Assignments & Homework: teachers set work for their own
 * section-subjects, students submit text or files, teachers mark and
 * return, and the class-notes library sits beside it.
 *
 * **Direction of the integrations.** Everything this module needs, it
 * imports:
 *
 *   - `EnrollmentModule` for the canonical roster
 *     (`getSectionStudents` / `getStudentCurrentEnrollment`) — every
 *     submission keys on the `enrollment_id` those return.
 *   - `AcademicModule` for `SessionsService`, so a portal read that names
 *     no session resolves the current one the same way every other
 *     session-scoped module does.
 *   - `CommunicationModule` for `NotificationService.send()`, the single
 *     send entry point (M17).
 *   - `SchoolModule` for settings, `RbacModule` for the two runtime
 *     permission checks (`assignment.all`,
 *     `assignment.evaluate.override`), `StorageModule` for attachments.
 *
 * It deliberately does **not** import `TeacherModule`. The ownership
 * policy needs one query against `teacher_section_subjects`, which
 * TeacherModule does not export — so `AssignmentPolicyService` reads it
 * directly over PrismaService, the M17 `AudienceRepository` / M18
 * `DashboardRepository` / M19 `PublicSiteRepository` precedent. That also
 * keeps the graph honest about what this module actually depends on: the
 * *duty roster*, not teacher management.
 *
 * Nothing imports AssignmentModule back except the leaf `PortalModule`
 * (M18), which composes `StudentAssignmentsService` into
 * `/portal/assignments` — the same way it already composes every other
 * feature module.
 */
@Module({
  imports: [
    SchoolModule,
    RbacModule,
    AcademicModule,
    EnrollmentModule,
    CommunicationModule,
    StorageModule,
  ],
  controllers: [
    AssignmentsController,
    SubmissionsController,
    LearningMaterialsController,
  ],
  providers: [
    AssignmentSettingsService,
    AssignmentPolicyService,
    AssignmentsService,
    SubmissionsService,
    LearningMaterialsService,
    StudentAssignmentsService,
    AssignmentNotificationsService,
    AssignmentExportService,
    AssignmentUploadsService,
    AssignmentRemindersJob,
    AssignmentsRepository,
    SubmissionsRepository,
    LearningMaterialsRepository,
    // Roadmap §4's virus-scan placeholder, as a swappable binding rather
    // than a comment — see `assignment.constants.ts`.
    { provide: ATTACHMENT_SCANNER, useClass: PassThroughAttachmentScanner },
    // Stateless re-provision (PrismaService only) — the M07 convention.
    SchoolsRepository,
  ],
  // For M18's portal panels. `StudentAssignmentsService` is the composed
  // read; the three underlying services are exported because the portal's
  // materials tab and M29's analytics will want them, and because a
  // service a consumer injects but the module does not export compiles
  // cleanly and then fails to boot — the M18/M21 lesson, twice learned.
  exports: [
    StudentAssignmentsService,
    AssignmentsService,
    SubmissionsService,
    LearningMaterialsService,
    AssignmentSettingsService,
    // The portal's submission upload goes through the same scanner and
    // the same size limits the admin upload does — one code path, so a
    // student cannot get past a rule a teacher cannot.
    AssignmentUploadsService,
  ],
})
export class AssignmentModule {}
