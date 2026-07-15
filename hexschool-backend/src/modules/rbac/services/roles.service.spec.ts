import { BadRequestException, ConflictException } from '@nestjs/common';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { RolesService } from './roles.service';

/**
 * M03 business rules: system-role locks, ≥1-role / last-super-admin
 * invariants, optimistic concurrency, registry validation, and cache
 * invalidation. Repositories are mocked per the unit-test convention.
 */
describe('RolesService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };

  const systemRole = {
    id: 'role-sys',
    schoolId: 'school-1',
    name: 'Principal',
    slug: 'principal',
    description: null,
    isSystem: true,
    updatedAt: new Date('2026-07-15T10:00:00Z'),
  };
  const customRole = {
    ...systemRole,
    id: 'role-custom',
    name: 'Exam Controller',
    slug: 'exam-controller',
    isSystem: false,
  };

  let roles: Record<string, jest.Mock>;
  let permissions: Record<string, jest.Mock>;
  let userRoles: Record<string, jest.Mock>;
  let users: Record<string, jest.Mock>;
  let permissionCache: Record<string, jest.Mock>;
  let auditContext: { set: jest.Mock };
  let service: RolesService;

  beforeEach(() => {
    roles = {
      findByIdOrFail: jest.fn(),
      findBySlug: jest.fn().mockResolvedValue(null),
      findAll: jest.fn(),
      findPermissionCodes: jest.fn().mockResolvedValue([]),
      create: jest
        .fn()
        .mockImplementation((data: object) =>
          Promise.resolve({ id: 'role-new', ...data }),
        ),
      update: jest
        .fn()
        .mockImplementation((_id: string, data: object) =>
          Promise.resolve({ ...customRole, ...data }),
        ),
      softDelete: jest.fn(),
      replacePermissions: jest.fn(),
      paginateWithStats: jest.fn(),
    };
    permissions = { findByCodes: jest.fn().mockResolvedValue([]) };
    userRoles = {
      countUsersWithRole: jest.fn().mockResolvedValue(0),
      countOtherHolders: jest.fn().mockResolvedValue(0),
      findRolesForUser: jest.fn().mockResolvedValue([]),
      replaceUserRoles: jest.fn(),
    };
    users = { findByIdOrFail: jest.fn().mockResolvedValue({ id: 'u1' }) };
    permissionCache = {
      invalidateRole: jest.fn(),
      invalidateUser: jest.fn(),
    };
    auditContext = { set: jest.fn() };
    service = new RolesService(
      roles as never,
      permissions as never,
      userRoles as never,
      users as never,
      permissionCache as never,
      auditContext as never,
    );
  });

  describe('create / update / delete', () => {
    it('rejects a duplicate slug with 409', async () => {
      roles.findBySlug.mockResolvedValue(customRole);
      await expect(
        service.create({ name: 'X', slug: 'exam-controller' }, actor),
      ).rejects.toThrow(ConflictException);
    });

    it('system roles cannot be renamed', async () => {
      roles.findByIdOrFail.mockResolvedValue(systemRole);
      await expect(
        service.update(systemRole.id, { name: 'Renamed' }, actor),
      ).rejects.toThrow(BadRequestException);
    });

    it('system role description may still be edited', async () => {
      roles.findByIdOrFail.mockResolvedValue(systemRole);
      await expect(
        service.update(systemRole.id, { description: 'clarified' }, actor),
      ).resolves.toBeDefined();
    });

    it('stale expectedUpdatedAt → 409 (two admins editing)', async () => {
      roles.findByIdOrFail.mockResolvedValue(customRole);
      await expect(
        service.update(
          customRole.id,
          { name: 'Y', expectedUpdatedAt: '2026-07-15T09:00:00.000Z' },
          actor,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('system roles cannot be deleted', async () => {
      roles.findByIdOrFail.mockResolvedValue(systemRole);
      await expect(service.remove(systemRole.id, actor)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('a role still assigned to users cannot be deleted', async () => {
      roles.findByIdOrFail.mockResolvedValue(customRole);
      userRoles.countUsersWithRole.mockResolvedValue(3);
      await expect(service.remove(customRole.id, actor)).rejects.toThrow(
        ConflictException,
      );
    });

    it('deleting an unassigned custom role soft-deletes and invalidates', async () => {
      roles.findByIdOrFail.mockResolvedValue(customRole);
      await service.remove(customRole.id, actor);
      expect(roles.softDelete).toHaveBeenCalledWith(customRole.id);
      expect(permissionCache.invalidateRole).toHaveBeenCalledWith(
        customRole.id,
      );
    });
  });

  describe('setPermissions', () => {
    it('rejects codes missing from the registry catalog', async () => {
      roles.findByIdOrFail.mockResolvedValue(customRole);
      permissions.findByCodes.mockResolvedValue([
        { id: 'p1', code: 'role.view', isOrphaned: false },
      ]);
      await expect(
        service.setPermissions(
          customRole.id,
          { permissionCodes: ['role.view', 'nope.nothing'] },
          actor,
        ),
      ).rejects.toThrow(/nope\.nothing/);
    });

    it('rejects orphaned codes (registry-removed)', async () => {
      roles.findByIdOrFail.mockResolvedValue(customRole);
      permissions.findByCodes.mockResolvedValue([
        { id: 'p1', code: 'legacy.thing', isOrphaned: true },
      ]);
      await expect(
        service.setPermissions(
          customRole.id,
          { permissionCodes: ['legacy.thing'] },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('locks the core set of system roles (extend-only)', async () => {
      roles.findByIdOrFail.mockResolvedValue(systemRole); // slug: principal
      permissions.findByCodes.mockResolvedValue([
        { id: 'p1', code: 'role.view', isOrphaned: false },
      ]);
      // principal core includes audit.view etc. — omitting them must fail
      await expect(
        service.setPermissions(
          systemRole.id,
          { permissionCodes: ['role.view'] },
          actor,
        ),
      ).rejects.toThrow(/cannot be removed/);
    });

    it('replaces grants, invalidates holders, records old→new diff', async () => {
      roles.findByIdOrFail.mockResolvedValue(customRole);
      roles.findPermissionCodes
        .mockResolvedValueOnce(['audit.view']) // old set
        .mockResolvedValueOnce(['role.view']); // re-read for the response
      permissions.findByCodes.mockResolvedValue([
        { id: 'p1', code: 'role.view', isOrphaned: false },
      ]);

      await service.setPermissions(
        customRole.id,
        { permissionCodes: ['role.view'] },
        actor,
      );

      expect(roles.replacePermissions).toHaveBeenCalledWith(
        customRole.id,
        ['p1'],
        actor.sub,
      );
      expect(permissionCache.invalidateRole).toHaveBeenCalledWith(
        customRole.id,
      );
      expect(auditContext.set).toHaveBeenCalledWith(
        expect.objectContaining({
          oldValues: { permissionCodes: ['audit.view'] },
          newValues: { permissionCodes: ['role.view'] },
        }),
      );
    });
  });

  describe('setUserRoles', () => {
    const superAdminRole = {
      ...systemRole,
      id: 'role-sa',
      slug: 'super-admin',
    };

    it('rejects unknown role ids', async () => {
      roles.findAll.mockResolvedValue([customRole]);
      await expect(
        service.setUserRoles(
          'u1',
          { roleIds: [customRole.id, 'missing-id'] },
          actor,
        ),
      ).rejects.toThrow(/missing-id/);
    });

    it('blocks removing super-admin from its last holder', async () => {
      roles.findAll.mockResolvedValue([customRole]);
      userRoles.findRolesForUser.mockResolvedValue([superAdminRole]);
      userRoles.countOtherHolders.mockResolvedValue(0);
      await expect(
        service.setUserRoles('u1', { roleIds: [customRole.id] }, actor),
      ).rejects.toThrow(ConflictException);
    });

    it('allows the demotion when another super-admin holder exists', async () => {
      roles.findAll.mockResolvedValue([customRole]);
      userRoles.findRolesForUser
        .mockResolvedValueOnce([superAdminRole]) // current
        .mockResolvedValueOnce([customRole]); // response re-read
      userRoles.countOtherHolders.mockResolvedValue(1);

      await service.setUserRoles('u1', { roleIds: [customRole.id] }, actor);

      expect(userRoles.replaceUserRoles).toHaveBeenCalledWith('u1', [
        customRole.id,
      ]);
      expect(permissionCache.invalidateUser).toHaveBeenCalledWith('u1');
    });
  });
});
