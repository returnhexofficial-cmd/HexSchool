import { Injectable } from '@nestjs/common';
import { UserType } from '../../../common/constants';
import { UserRolesRepository } from '../repositories/user-roles.repository';
import { PermissionsRepository } from '../repositories/permissions.repository';
import { PermissionsCacheService } from './permissions-cache.service';

/**
 * Effective-permission resolution: roles → permission codes, cached in
 * Redis for 5 min and invalidated the moment a role's grants or a
 * user's roles change (PROJECT_CONTEXT §10). Used by PermissionsGuard
 * on every guarded request and by /auth/me.
 */
@Injectable()
export class PermissionsService {
  constructor(
    private readonly userRoles: UserRolesRepository,
    private readonly permissions: PermissionsRepository,
    private readonly cache: PermissionsCacheService,
  ) {}

  /** Sorted permission codes a user holds via their roles. */
  async getUserPermissionCodes(userId: string): Promise<string[]> {
    const cached = await this.cache.get(userId);
    if (cached) return cached;

    const codes = await this.userRoles.findPermissionCodesForUser(userId);
    await this.cache.set(userId, codes);
    return codes;
  }

  /**
   * Codes for /auth/me. Super Admins bypass the guard, but the frontend
   * still gates menus/buttons on this list — so they get the full
   * non-orphaned catalog.
   */
  async getEffectivePermissionCodes(
    userId: string,
    userType: UserType,
  ): Promise<string[]> {
    if (userType === UserType.SUPER_ADMIN) {
      const catalog = await this.permissions.findCatalog();
      return catalog.map((p) => p.code);
    }
    return this.getUserPermissionCodes(userId);
  }

  async invalidateUser(userId: string): Promise<void> {
    await this.cache.invalidate([userId]);
  }

  /** Role grants changed → drop every holder's cached set. */
  async invalidateRole(roleId: string): Promise<void> {
    const userIds = await this.userRoles.findUserIdsForRole(roleId);
    await this.cache.invalidate(userIds);
  }
}
