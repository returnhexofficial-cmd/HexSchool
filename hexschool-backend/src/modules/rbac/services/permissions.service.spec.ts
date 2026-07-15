import { UserType } from '../../../common/constants';
import { PermissionsService } from './permissions.service';

describe('PermissionsService', () => {
  let cache: Record<'get' | 'set' | 'invalidate', jest.Mock>;
  let userRoles: {
    findPermissionCodesForUser: jest.Mock;
    findUserIdsForRole: jest.Mock;
  };
  let permissions: { findCatalog: jest.Mock };
  let service: PermissionsService;

  beforeEach(() => {
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
    };
    userRoles = {
      findPermissionCodesForUser: jest
        .fn()
        .mockResolvedValue(['role.view', 'audit.view']),
      findUserIdsForRole: jest.fn().mockResolvedValue(['u1', 'u2']),
    };
    permissions = {
      findCatalog: jest
        .fn()
        .mockResolvedValue([{ code: 'role.view' }, { code: 'role.create' }]),
    };
    service = new PermissionsService(
      userRoles as never,
      permissions as never,
      cache as never,
    );
  });

  it('cache miss → resolves from DB and caches the result', async () => {
    const codes = await service.getUserPermissionCodes('u1');
    expect(codes).toEqual(['role.view', 'audit.view']);
    expect(userRoles.findPermissionCodesForUser).toHaveBeenCalledWith('u1');
    expect(cache.set).toHaveBeenCalledWith('u1', ['role.view', 'audit.view']);
  });

  it('cache hit → skips the DB entirely', async () => {
    cache.get.mockResolvedValue(['student.view']);
    const codes = await service.getUserPermissionCodes('u1');
    expect(codes).toEqual(['student.view']);
    expect(userRoles.findPermissionCodesForUser).not.toHaveBeenCalled();
  });

  it('Super Admin gets the whole non-orphaned catalog for /auth/me', async () => {
    const codes = await service.getEffectivePermissionCodes(
      'u1',
      UserType.SUPER_ADMIN,
    );
    expect(codes).toEqual(['role.view', 'role.create']);
    expect(userRoles.findPermissionCodesForUser).not.toHaveBeenCalled();
  });

  it('invalidateRole drops every holder of that role', async () => {
    await service.invalidateRole('r1');
    expect(userRoles.findUserIdsForRole).toHaveBeenCalledWith('r1');
    expect(cache.invalidate).toHaveBeenCalledWith(['u1', 'u2']);
  });
});
