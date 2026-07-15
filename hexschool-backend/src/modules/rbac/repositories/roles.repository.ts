import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { PrismaService } from '../../../database/prisma/prisma.service';

export interface RoleWithStats extends Role {
  permissionCount: number;
  userCount: number;
}

@Injectable()
export class RolesRepository extends BaseRepository<
  Role,
  Prisma.RoleWhereInput,
  Prisma.RoleUncheckedCreateInput,
  Prisma.RoleUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.role, 'Role');
  }

  /** List page: standard pagination + grant/assignment counts per role. */
  async paginateWithStats(
    query: PaginationQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<RoleWithStats>> {
    const { data, meta } = await this.paginate(query, {
      schoolId,
      searchColumns: ['name', 'slug'],
      sortableColumns: ['name', 'slug', 'isSystem', 'createdAt', 'updatedAt'],
    });

    const ids = data.map((r) => r.id);
    const [permissionCounts, userCounts] = await Promise.all([
      this.prisma.rolePermission.groupBy({
        by: ['roleId'],
        where: { roleId: { in: ids } },
        _count: { roleId: true },
      }),
      this.prisma.userRole.groupBy({
        by: ['roleId'],
        where: { roleId: { in: ids } },
        _count: { roleId: true },
      }),
    ]);
    const permByRole = new Map(
      permissionCounts.map((c) => [c.roleId, c._count.roleId]),
    );
    const usersByRole = new Map(
      userCounts.map((c) => [c.roleId, c._count.roleId]),
    );

    return {
      data: data.map((role) => ({
        ...role,
        permissionCount: permByRole.get(role.id) ?? 0,
        userCount: usersByRole.get(role.id) ?? 0,
      })),
      meta,
    };
  }

  /** Active (non-deleted) role by slug within a school. */
  async findBySlug(schoolId: string, slug: string): Promise<Role | null> {
    return this.findOne({ slug }, schoolId);
  }

  /** Permission codes currently granted to a role (orphaned included —
   *  the editor must show them so an admin can clean them up). */
  async findPermissionCodes(roleId: string): Promise<string[]> {
    const grants = await this.prisma.rolePermission.findMany({
      where: { roleId },
      select: { permission: { select: { code: true } } },
      orderBy: { permission: { code: 'asc' } },
    });
    return grants.map((g) => g.permission.code);
  }

  /**
   * Replace a role's grant set (single transaction) and bump
   * updated_at/updated_by so optimistic concurrency sees the change.
   */
  async replacePermissions(
    roleId: string,
    permissionIds: string[],
    updatedBy: string,
  ): Promise<void> {
    await this.withTransaction(async (tx) => {
      await tx.rolePermission.deleteMany({
        where: { roleId, permissionId: { notIn: permissionIds } },
      });
      if (permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({
            roleId,
            permissionId,
          })),
          skipDuplicates: true,
        });
      }
      await tx.role.update({
        where: { id: roleId },
        data: { updatedBy },
      });
    });
  }
}
