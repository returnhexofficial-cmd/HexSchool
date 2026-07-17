import { Module } from '@nestjs/common';
import { QueuesModule } from '../../queues/queues.module';
import { DepartmentsRepository } from '../academic/repositories/departments.repository';
import { AuthModule } from '../auth/auth.module';
import { RefreshTokensRepository } from '../auth/repositories/refresh-tokens.repository';
import { UsersRepository } from '../auth/repositories/users.repository';
import { RolesRepository } from '../rbac/repositories/roles.repository';
import { UserRolesRepository } from '../rbac/repositories/user-roles.repository';
import { SchoolModule } from '../school/school.module';
import { SchoolsRepository } from '../school/repositories/schools.repository';
import { SequenceModule } from '../sequence/sequence.module';
import { StaffController } from './controllers/staff.controller';
import { UsersController } from './controllers/users.controller';
import { StaffListener } from './events/staff.listener';
import { StaffDocumentsRepository } from './repositories/staff-documents.repository';
import { StaffProfilesRepository } from './repositories/staff-profiles.repository';
import { StaffDocumentsService } from './services/staff-documents.service';
import { StaffService } from './services/staff.service';
import { UsersAdminService } from './services/users-admin.service';

/**
 * Module 07 — Staff & User Management. Staff creation is transactional
 * with the user account (SequenceModule provides gap-free employee IDs);
 * the /users admin surface completes the resource M03 started with
 * /users/:id/roles. Cross-module repositories (users, roles, schools,
 * departments) are stateless and re-provided here to keep the module
 * graph acyclic — same pattern RbacModule uses for UsersRepository.
 */
@Module({
  imports: [
    AuthModule, // PasswordService (exported)
    SchoolModule, // SettingsService (employee-ID pattern)
    SequenceModule,
    QueuesModule, // notifications queue (welcome / reset messages)
  ],
  controllers: [StaffController, UsersController],
  providers: [
    StaffService,
    StaffDocumentsService,
    UsersAdminService,
    StaffListener,
    StaffProfilesRepository,
    StaffDocumentsRepository,
    // Stateless re-provisions (see class doc).
    UsersRepository,
    RefreshTokensRepository,
    RolesRepository,
    UserRolesRepository,
    SchoolsRepository,
    DepartmentsRepository,
  ],
  exports: [StaffProfilesRepository],
})
export class StaffModule {}
