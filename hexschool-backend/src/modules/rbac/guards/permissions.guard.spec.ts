import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserType } from '../../../common/constants';
import {
  REQUIRE_ANY_PERMISSION_KEY,
  REQUIRE_PERMISSIONS_KEY,
} from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  let held: string[];
  let getUserPermissionCodes: jest.Mock;
  let metadata: Record<string, string[] | undefined>;

  const reflector = {
    getAllAndOverride: jest.fn((key: string) => metadata[key]),
  } as unknown as Reflector;

  const context = (user?: Partial<AccessTokenPayload>): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const admin: Partial<AccessTokenPayload> = {
    sub: 'user-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };

  let guard: PermissionsGuard;

  beforeEach(() => {
    held = [];
    metadata = {};
    getUserPermissionCodes = jest
      .fn()
      .mockImplementation(() => Promise.resolve(held));
    guard = new PermissionsGuard(reflector, {
      getUserPermissionCodes,
    } as never);
  });

  it('allows undecorated routes without any lookup', async () => {
    await expect(guard.canActivate(context(admin))).resolves.toBe(true);
    expect(getUserPermissionCodes).not.toHaveBeenCalled();
  });

  it('AND semantics: every listed code must be held', async () => {
    metadata[REQUIRE_PERMISSIONS_KEY] = ['role.view', 'role.update'];

    held = ['role.view', 'role.update'];
    await expect(guard.canActivate(context(admin))).resolves.toBe(true);

    held = ['role.view'];
    await expect(guard.canActivate(context(admin))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('OR semantics: one listed code suffices', async () => {
    metadata[REQUIRE_ANY_PERMISSION_KEY] = ['permission.view', 'role.view'];

    held = ['role.view'];
    await expect(guard.canActivate(context(admin))).resolves.toBe(true);

    held = ['audit.view'];
    await expect(guard.canActivate(context(admin))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('combined AND + OR must both pass', async () => {
    metadata[REQUIRE_PERMISSIONS_KEY] = ['role.view'];
    metadata[REQUIRE_ANY_PERMISSION_KEY] = ['audit.view', 'permission.view'];

    held = ['role.view', 'audit.view'];
    await expect(guard.canActivate(context(admin))).resolves.toBe(true);

    held = ['role.view'];
    await expect(guard.canActivate(context(admin))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('Super Admin bypasses without a permission lookup', async () => {
    metadata[REQUIRE_PERMISSIONS_KEY] = ['role.delete'];
    const superAdmin = { ...admin, userType: UserType.SUPER_ADMIN };

    await expect(guard.canActivate(context(superAdmin))).resolves.toBe(true);
    expect(getUserPermissionCodes).not.toHaveBeenCalled();
  });

  it('denies decorated routes with no authenticated user', async () => {
    metadata[REQUIRE_PERMISSIONS_KEY] = ['role.view'];
    await expect(guard.canActivate(context(undefined))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
