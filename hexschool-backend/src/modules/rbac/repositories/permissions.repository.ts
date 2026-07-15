import { Injectable } from '@nestjs/common';
import { Permission, Prisma } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/** Global catalog (not school-scoped, no soft delete — registry-synced). */
@Injectable()
export class PermissionsRepository extends BaseRepository<
  Permission,
  Prisma.PermissionWhereInput,
  Prisma.PermissionUncheckedCreateInput,
  Prisma.PermissionUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.permission, 'Permission', {
      softDeletable: false,
      schoolScoped: false,
    });
  }

  /** Catalog for UIs and /auth/me — orphaned codes excluded by default. */
  async findCatalog(includeOrphaned = false): Promise<Permission[]> {
    return this.prisma.permission.findMany({
      where: includeOrphaned ? {} : { isOrphaned: false },
      orderBy: [{ module: 'asc' }, { code: 'asc' }],
    });
  }

  /** Resolve codes → rows (used to validate PUT /roles/:id/permissions). */
  async findByCodes(codes: string[]): Promise<Permission[]> {
    if (codes.length === 0) return [];
    return this.prisma.permission.findMany({ where: { code: { in: codes } } });
  }
}
