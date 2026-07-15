import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * user_roles join table. Composite PK ⇒ doesn't fit BaseRepository's
 * single-id contract; still the only place that touches the ORM for
 * this entity (repository-pattern rule holds).
 */
@Injectable()
export class UserRolesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Effective permission codes for a user: union over their non-deleted
   * roles, orphaned permissions excluded (registry-removed codes deny
   * gracefully — roadmap M03 §8).
   */
  async findPermissionCodesForUser(userId: string): Promise<string[]> {
    const grants = await this.prisma.userRole.findMany({
      where: { userId, role: { deletedAt: null } },
      select: {
        role: {
          select: {
            rolePermissions: {
              where: { permission: { isOrphaned: false } },
              select: { permission: { select: { code: true } } },
            },
          },
        },
      },
    });
    const codes = new Set<string>();
    for (const g of grants) {
      for (const rp of g.role.rolePermissions) {
        codes.add(rp.permission.code);
      }
    }
    return [...codes].sort();
  }

  /** Non-deleted roles a user holds. */
  async findRolesForUser(userId: string): Promise<Role[]> {
    const rows = await this.prisma.userRole.findMany({
      where: { userId, role: { deletedAt: null } },
      select: { role: true },
      orderBy: { role: { name: 'asc' } },
    });
    return rows.map((r) => r.role);
  }

  /** Everyone holding a role (for cache invalidation on role change). */
  async findUserIdsForRole(roleId: string): Promise<string[]> {
    const rows = await this.prisma.userRole.findMany({
      where: { roleId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  async countUsersWithRole(roleId: string): Promise<number> {
    return this.prisma.userRole.count({ where: { roleId } });
  }

  /** Holders of a role other than one user (last-super-admin check). */
  async countOtherHolders(roleId: string, userId: string): Promise<number> {
    return this.prisma.userRole.count({
      where: { roleId, userId: { not: userId } },
    });
  }

  /** Replace a user's role set atomically. */
  async replaceUserRoles(userId: string, roleIds: string[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({
        where: { userId, roleId: { notIn: roleIds } },
      });
      if (roleIds.length > 0) {
        await tx.userRole.createMany({
          data: roleIds.map((roleId) => ({ userId, roleId })),
          skipDuplicates: true,
        });
      }
    });
  }
}
