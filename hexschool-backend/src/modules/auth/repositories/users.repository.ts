import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../common/dto/paginated.dto';
import { PrismaService } from '../../../database/prisma/prisma.service';

const ADMIN_LIST_INCLUDE = {
  userRoles: {
    select: { role: { select: { id: true, name: true, slug: true } } },
  },
  staffProfile: {
    select: { id: true, employeeId: true, firstName: true, lastName: true },
  },
} satisfies Prisma.UserInclude;

export type UserWithAdminRelations = Prisma.UserGetPayload<{
  include: typeof ADMIN_LIST_INCLUDE;
}>;

const ADMIN_SORTABLE = new Set([
  'email',
  'userType',
  'status',
  'lastLoginAt',
  'createdAt',
]);

@Injectable()
export class UsersRepository extends BaseRepository<
  User,
  Prisma.UserWhereInput,
  Prisma.UserUncheckedCreateInput,
  Prisma.UserUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.user, 'User');
  }

  /** User-admin list (M07): filters by type/status/role, searches
   *  email/phone/linked staff name, includes roles + staff profile. */
  async paginateAdminList(
    query: {
      page: number;
      limit: number;
      sort?: string;
      search?: string;
      userType?: User['userType'];
      status?: User['status'];
      roleId?: string;
    },
    schoolId: string,
  ): Promise<PaginatedResult<UserWithAdminRelations>> {
    const { page, limit } = query;

    const where: Prisma.UserWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.userType ? { userType: query.userType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.roleId
        ? { userRoles: { some: { roleId: query.roleId } } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
              {
                staffProfile: {
                  is: {
                    OR: [
                      {
                        firstName: {
                          contains: query.search,
                          mode: 'insensitive',
                        },
                      },
                      {
                        lastName: {
                          contains: query.search,
                          mode: 'insensitive',
                        },
                      },
                      {
                        employeeId: {
                          contains: query.search,
                          mode: 'insensitive',
                        },
                      },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [field, dir] = (query.sort ?? '').split(':');
    const orderBy: Prisma.UserOrderByWithRelationInput =
      field && ADMIN_SORTABLE.has(field)
        ? { [field]: dir?.toLowerCase() === 'desc' ? 'desc' : 'asc' }
        : { createdAt: 'desc' };

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: ADMIN_LIST_INCLUDE,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data: items, meta: buildPaginationMeta(page, limit, total) };
  }

  /** Other ACTIVE super admins (guard: never deactivate the last one). */
  async countOtherActiveSuperAdmins(userId: string): Promise<number> {
    return this.prisma.user.count({
      where: {
        userType: 'SUPER_ADMIN',
        status: 'ACTIVE',
        deletedAt: null,
        id: { not: userId },
      },
    });
  }

  /**
   * All candidates for a normalized login identifier. Since M09 the same
   * phone/email may back one account PER user type (a guardian can also
   * be staff — uq_users_* moved to (school_id, user_type, contact)), so
   * login verifies the password against every candidate. Ordered by
   * created_at so multi-match flows stay deterministic.
   */
  async findAllByIdentifier(identifier: {
    email?: string;
    phone?: string;
  }): Promise<User[]> {
    const where = identifier.email
      ? { email: identifier.email }
      : identifier.phone
        ? { phone: identifier.phone }
        : null;
    if (!where) return [];
    return this.prisma.user.findMany({
      where: { ...where, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** First candidate (oldest account) — OTP/reset flows, where a single
   *  target is needed. Multi-account holders reset via the older account
   *  (documented M09 limitation until usernames arrive). */
  async findByIdentifier(identifier: {
    email?: string;
    phone?: string;
  }): Promise<User | null> {
    const candidates = await this.findAllByIdentifier(identifier);
    return candidates[0] ?? null;
  }

  /** Atomic failed-attempt bump; returns the new counter value. */
  async incrementFailedAttempts(id: string): Promise<number> {
    const user = await this.prisma.user.update({
      where: { id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    return user.failedLoginAttempts;
  }

  async resetLoginCounters(id: string): Promise<void> {
    await this.update(id, {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    });
  }

  async lock(id: string, until: Date): Promise<void> {
    await this.update(id, { lockedUntil: until });
  }

  async setPassword(id: string, passwordHash: string): Promise<void> {
    await this.update(id, {
      passwordHash,
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
  }

  /** Admin-issued temporary password — user must change it on login (M07). */
  async setTempPassword(id: string, passwordHash: string): Promise<void> {
    await this.update(id, {
      passwordHash,
      passwordChangedAt: new Date(),
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
  }
}
