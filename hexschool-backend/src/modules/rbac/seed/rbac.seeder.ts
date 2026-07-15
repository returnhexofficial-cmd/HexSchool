import type { PrismaClient } from '@prisma/client';
import { PERMISSION_REGISTRY } from '../registry/permission.registry';
import { SYSTEM_ROLES } from '../registry/system-roles';

/**
 * Module 03 seeders, exported as plain functions so both the seed runner
 * (src/database/seeds/seed.ts) and the e2e suites can run them. All are
 * idempotent and non-destructive: re-running upserts/extends, never
 * revokes grants an admin added by hand.
 */

/**
 * Sync the TS permission registry → `permissions` table: upsert every
 * registry code (reviving `is_orphaned` if the code returned) and flag
 * DB codes that no longer exist in the registry as orphaned (roadmap
 * M03 §8 — the guard ignores orphaned codes; rows are never deleted
 * because role_permissions may still reference them).
 */
export async function syncPermissionRegistry(
  prisma: PrismaClient,
): Promise<{ synced: number; orphaned: number }> {
  for (const def of PERMISSION_REGISTRY) {
    await prisma.permission.upsert({
      where: { code: def.code },
      create: {
        code: def.code,
        module: def.module,
        description: def.description,
      },
      update: {
        module: def.module,
        description: def.description,
        isOrphaned: false,
      },
    });
  }

  const { count: orphaned } = await prisma.permission.updateMany({
    where: {
      code: { notIn: PERMISSION_REGISTRY.map((p) => p.code) },
      isOrphaned: false,
    },
    data: { isOrphaned: true },
  });

  return { synced: PERMISSION_REGISTRY.length, orphaned };
}

/**
 * Seed the system roles for one school and grant each its core
 * permission set. Extend-only: new core codes are granted on re-run;
 * grants an admin added beyond the core are left untouched.
 */
export async function seedSystemRoles(
  prisma: PrismaClient,
  schoolId: string,
): Promise<void> {
  const permissions = await prisma.permission.findMany({
    select: { id: true, code: true },
  });
  const idByCode = new Map(permissions.map((p) => [p.code, p.id]));

  for (const def of SYSTEM_ROLES) {
    const existing = await prisma.role.findFirst({
      where: { schoolId, slug: def.slug, deletedAt: null },
    });
    const role =
      existing ??
      (await prisma.role.create({
        data: {
          schoolId,
          name: def.name,
          slug: def.slug,
          description: def.description,
          isSystem: true,
        },
      }));

    const grants = def.corePermissions.flatMap((code) => {
      const permissionId = idByCode.get(code);
      if (!permissionId) {
        throw new Error(
          `System role "${def.slug}" references unknown permission "${code}" — sync the registry first`,
        );
      }
      return [{ roleId: role.id, permissionId }];
    });
    if (grants.length > 0) {
      await prisma.rolePermission.createMany({
        data: grants,
        skipDuplicates: true,
      });
    }
  }
}

/**
 * Ensure a user holds a role (used to attach `super-admin` to the
 * bootstrap Super Admin so the "every user retains ≥1 role" invariant
 * holds from day one).
 */
export async function ensureUserRole(
  prisma: PrismaClient,
  userId: string,
  schoolId: string,
  roleSlug: string,
): Promise<void> {
  const role = await prisma.role.findFirst({
    where: { schoolId, slug: roleSlug, deletedAt: null },
  });
  if (!role) throw new Error(`Role "${roleSlug}" not seeded yet`);
  await prisma.userRole.createMany({
    data: [{ userId, roleId: role.id }],
    skipDuplicates: true,
  });
}
