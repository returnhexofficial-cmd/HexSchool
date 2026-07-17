import { Module } from '@nestjs/common';
import { QueuesModule } from '../../queues/queues.module';
import { AcademicModule } from '../academic/academic.module';
import { DepartmentsRepository } from '../academic/repositories/departments.repository';
import { SubjectsRepository } from '../academic/repositories/subjects.repository';
import { AuthModule } from '../auth/auth.module';
import { RefreshTokensRepository } from '../auth/repositories/refresh-tokens.repository';
import { UsersRepository } from '../auth/repositories/users.repository';
import { RbacModule } from '../rbac/rbac.module';
import { RolesRepository } from '../rbac/repositories/roles.repository';
import { UserRolesRepository } from '../rbac/repositories/user-roles.repository';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { SequenceModule } from '../sequence/sequence.module';
import { TeacherAssignmentsController } from './controllers/teacher-assignments.controller';
import { TeacherLeavesController } from './controllers/teacher-leaves.controller';
import { TeachersController } from './controllers/teachers.controller';
import { TeacherListener } from './events/teacher.listener';
import {
  NoopTimetableConflictChecker,
  TIMETABLE_CONFLICT_CHECKER,
} from './interfaces/timetable-conflict.interface';
import { TeacherAssignmentsRepository } from './repositories/teacher-assignments.repository';
import { TeacherDocumentsRepository } from './repositories/teacher-documents.repository';
import { TeacherEvaluationsRepository } from './repositories/teacher-evaluations.repository';
import { TeacherLeavesRepository } from './repositories/teacher-leaves.repository';
import { TeacherQualificationsRepository } from './repositories/teacher-qualifications.repository';
import { TeacherSubjectsRepository } from './repositories/teacher-subjects.repository';
import { TeachersRepository } from './repositories/teachers.repository';
import { TeacherAssignmentsService } from './services/teacher-assignments.service';
import { TeacherDocumentsService } from './services/teacher-documents.service';
import { TeacherEvaluationsService } from './services/teacher-evaluations.service';
import { TeacherLeavesService } from './services/teacher-leaves.service';
import { TeachersService } from './services/teachers.service';

/**
 * Module 08 — Teacher Management: the M07 staff pattern plus expertise
 * mapping, section-subject assignments (one holder per slot, timetable
 * hook no-op until M13), interim leaves (HR M21 absorbs them), and
 * evaluations. AcademicModule supplies SessionsService +
 * SectionsRepository (exported); other cross-module repositories are
 * stateless re-provisions (M07 convention). The timetable conflict
 * checker is bound to a no-op — M13 swaps the provider.
 */
@Module({
  imports: [
    AuthModule, // PasswordService
    RbacModule, // PermissionsService (override checks)
    SchoolModule, // SettingsService (ID pattern)
    AcademicModule, // SessionsService + SectionsRepository (exported)
    SequenceModule,
    QueuesModule, // notifications queue (welcome message)
  ],
  controllers: [
    TeachersController,
    TeacherAssignmentsController,
    TeacherLeavesController,
  ],
  providers: [
    TeachersService,
    TeacherAssignmentsService,
    TeacherLeavesService,
    TeacherEvaluationsService,
    TeacherDocumentsService,
    TeacherListener,
    {
      provide: TIMETABLE_CONFLICT_CHECKER,
      useClass: NoopTimetableConflictChecker,
    },
    TeachersRepository,
    TeacherQualificationsRepository,
    TeacherSubjectsRepository,
    TeacherAssignmentsRepository,
    TeacherLeavesRepository,
    TeacherEvaluationsRepository,
    TeacherDocumentsRepository,
    // Stateless re-provisions (see class doc).
    UsersRepository,
    RefreshTokensRepository,
    RolesRepository,
    UserRolesRepository,
    SchoolsRepository,
    DepartmentsRepository,
    SubjectsRepository,
  ],
  exports: [TeachersRepository],
})
export class TeacherModule {}
