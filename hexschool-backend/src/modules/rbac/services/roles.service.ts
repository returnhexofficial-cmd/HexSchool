import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { UsersRepository } from '../../auth/repositories/users.repository';
import {
  CreateRoleDto,
  SetUserRolesDto,
  UpdateRoleDto,
  UpdateRolePermissionsDto,
} from '../dto';
import { coreLockedPermissions } from '../registry/system-roles';
import { PermissionsRepository } from '../repositories/permissions.repository';
import {
  RolesRepository,
  RoleWithStats,
} from '../repositories/roles.repository';
import { UserRolesRepository } from '../repositories/user-roles.repository';
import { PermissionsService } from './permissions.service';

const SUPER_ADMIN_SLUG = 'super-admin';

export interface RoleDetail extends Role {
  permissionCodes: string[];
  /** System-role core codes the editor must render as non-removable. */
  lockedCodes: string[];
}

/**
 * Role lifecycle + grant/assignment management (roadmap M03 §6):
 * system roles are non-deletable/non-renamable with locked core
 * permissions; every user keeps ≥1 role; the last super-admin holder is
 * protected; every change invalidates the permission cache immediately
 * and records a real old/new diff via the audit context.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly roles: RolesRepository,
    private readonly permissions: PermissionsRepository,
    private readonly userRoles: UserRolesRepository,
    private readonly users: UsersRepository,
    private readonly permissionCache: PermissionsService,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(
    query: PaginationQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<RoleWithStats>> {
    return this.roles.paginateWithStats(query, schoolId);
  }

  async getById(id: string, schoolId: string): Promise<RoleDetail> {
    const role = await this.roles.findByIdOrFail(id, schoolId);
    const permissionCodes = await this.roles.findPermissionCodes(id);
    const lockedCodes = role.isSystem
      ? [...coreLockedPermissions(role.slug)].sort()
      : [];
    return { ...role, permissionCodes, lockedCodes };
  }

  async create(dto: CreateRoleDto, actor: AccessTokenPayload): Promise<Role> {
    const existing = await this.roles.findBySlug(actor.schoolId, dto.slug);
    if (existing) {
      throw new ConflictException(`Role slug "${dto.slug}" already exists`);
    }
    const role = await this.roles.create({
      schoolId: actor.schoolId,
      name: dto.name,
      slug: dto.slug,
      description: dto.description,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'Role',
      entityId: role.id,
      newValues: {
        name: role.name,
        slug: role.slug,
        description: role.description,
      },
    });
    return role;
  }

  async update(
    id: string,
    dto: UpdateRoleDto,
    actor: AccessTokenPayload,
  ): Promise<Role> {
    const role = await this.roles.findByIdOrFail(id, actor.schoolId);
    this.assertNotStale(role, dto.expectedUpdatedAt);
    if (role.isSystem && dto.name !== undefined && dto.name !== role.name) {
      throw new BadRequestException('System roles cannot be renamed');
    }

    const updated = await this.roles.update(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'Role',
      entityId: id,
      oldValues: { name: role.name, description: role.description },
      newValues: { name: updated.name, description: updated.description },
    });
    return updated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const role = await this.roles.findByIdOrFail(id, actor.schoolId);
    if (role.isSystem) {
      throw new BadRequestException('System roles cannot be deleted');
    }
    const holders = await this.userRoles.countUsersWithRole(id);
    if (holders > 0) {
      throw new ConflictException(
        `Role is assigned to ${holders} user(s) — reassign them first`,
      );
    }
    await this.roles.softDelete(id);
    await this.permissionCache.invalidateRole(id);
    this.auditContext.set({
      entityType: 'Role',
      entityId: id,
      oldValues: { name: role.name, slug: role.slug },
    });
  }

  async setPermissions(
    id: string,
    dto: UpdateRolePermissionsDto,
    actor: AccessTokenPayload,
  ): Promise<RoleDetail> {
    const role = await this.roles.findByIdOrFail(id, actor.schoolId);
    this.assertNotStale(role, dto.expectedUpdatedAt);

    // Codes must exist in the registry-synced catalog and not be orphaned.
    const found = await this.permissions.findByCodes(dto.permissionCodes);
    const usable = new Map(
      found.filter((p) => !p.isOrphaned).map((p) => [p.code, p.id]),
    );
    const unknown = dto.permissionCodes.filter((code) => !usable.has(code));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown or orphaned permission code(s): ${unknown.join(', ')}`,
      );
    }

    // System roles: seeded core set is locked — extend-only (M03 §6).
    if (role.isSystem) {
      const requested = new Set(dto.permissionCodes);
      const missingCore = [...coreLockedPermissions(role.slug)].filter(
        (code) => !requested.has(code),
      );
      if (missingCore.length > 0) {
        throw new BadRequestException(
          `Core permissions of system role "${role.slug}" cannot be removed: ${missingCore.join(', ')}`,
        );
      }
    }

    const oldCodes = await this.roles.findPermissionCodes(id);
    await this.roles.replacePermissions(id, [...usable.values()], actor.sub);
    // Role change ⇒ affected users' cached permission sets die now.
    await this.permissionCache.invalidateRole(id);

    this.auditContext.set({
      entityType: 'Role',
      entityId: id,
      oldValues: { permissionCodes: oldCodes },
      newValues: { permissionCodes: [...dto.permissionCodes].sort() },
    });
    return this.getById(id, actor.schoolId);
  }

  async getUserRoles(userId: string, schoolId: string): Promise<Role[]> {
    await this.users.findByIdOrFail(userId, schoolId);
    return this.userRoles.findRolesForUser(userId);
  }

  async setUserRoles(
    userId: string,
    dto: SetUserRolesDto,
    actor: AccessTokenPayload,
  ): Promise<Role[]> {
    await this.users.findByIdOrFail(userId, actor.schoolId);

    const targetRoles = await this.roles.findAll(
      { id: { in: dto.roleIds } },
      actor.schoolId,
    );
    if (targetRoles.length !== dto.roleIds.length) {
      const foundIds = new Set(targetRoles.map((r) => r.id));
      const missing = dto.roleIds.filter((rid) => !foundIds.has(rid));
      throw new BadRequestException(
        `Unknown role id(s): ${missing.join(', ')}`,
      );
    }

    // The last super-admin holder cannot be demoted (M03 §6).
    const currentRoles = await this.userRoles.findRolesForUser(userId);
    const superAdminRole = currentRoles.find(
      (r) => r.slug === SUPER_ADMIN_SLUG,
    );
    if (superAdminRole && !dto.roleIds.includes(superAdminRole.id)) {
      const others = await this.userRoles.countOtherHolders(
        superAdminRole.id,
        userId,
      );
      if (others === 0) {
        throw new ConflictException(
          'Cannot remove the super-admin role from its last holder',
        );
      }
    }

    await this.userRoles.replaceUserRoles(userId, dto.roleIds);
    await this.permissionCache.invalidateUser(userId);

    this.auditContext.set({
      entityType: 'UserRoles',
      entityId: userId,
      oldValues: { roles: currentRoles.map((r) => r.slug).sort() },
      newValues: { roles: targetRoles.map((r) => r.slug).sort() },
    });
    return this.userRoles.findRolesForUser(userId);
  }

  /** Optimistic concurrency: 409 when the client edited a stale copy. */
  private assertNotStale(role: Role, expectedUpdatedAt?: string): void {
    if (
      expectedUpdatedAt &&
      new Date(expectedUpdatedAt).getTime() !== role.updatedAt.getTime()
    ) {
      throw new ConflictException(
        'Role was modified by someone else — reload and try again',
      );
    }
  }
}
