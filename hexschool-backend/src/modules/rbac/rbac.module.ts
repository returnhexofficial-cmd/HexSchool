import { Module } from '@nestjs/common';
import { UsersRepository } from '../auth/repositories/users.repository';
import { PermissionsController } from './controllers/permissions.controller';
import { RolesController } from './controllers/roles.controller';
import { UserRolesController } from './controllers/user-roles.controller';
import { PermissionsRepository } from './repositories/permissions.repository';
import { RolesRepository } from './repositories/roles.repository';
import { UserRolesRepository } from './repositories/user-roles.repository';
import { PermissionsCacheService } from './services/permissions-cache.service';
import { PermissionsService } from './services/permissions.service';
import { RolesService } from './services/roles.service';

/**
 * Module 03 — RBAC. Deliberately does NOT import AuthModule (AuthModule
 * imports THIS module so /auth/me can report permission codes);
 * UsersRepository is stateless and re-provided here to keep the graph
 * acyclic. The global PermissionsGuard is registered in AppModule —
 * after JwtAuthGuard — with PermissionsService exported from here.
 */
@Module({
  controllers: [RolesController, PermissionsController, UserRolesController],
  providers: [
    RolesService,
    PermissionsService,
    PermissionsCacheService,
    RolesRepository,
    PermissionsRepository,
    UserRolesRepository,
    UsersRepository,
  ],
  exports: [PermissionsService],
})
export class RbacModule {}
