import { Injectable } from '@nestjs/common';
import { Prisma, StaffProfile } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../common/dto/paginated.dto';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { StaffQueryDto } from '../dto';

const LIST_INCLUDE = {
  department: { select: { id: true, name: true, code: true } },
  user: {
    select: {
      id: true,
      email: true,
      phone: true,
      status: true,
      userType: true,
      lastLoginAt: true,
      mustChangePassword: true,
    },
  },
} satisfies Prisma.StaffProfileInclude;

export type StaffWithRelations = Prisma.StaffProfileGetPayload<{
  include: typeof LIST_INCLUDE;
}>;

const SORTABLE = new Set([
  'employeeId',
  'firstName',
  'lastName',
  'designation',
  'joiningDate',
  'status',
  'createdAt',
]);

@Injectable()
export class StaffProfilesRepository extends BaseRepository<
  StaffProfile,
  Prisma.StaffProfileWhereInput,
  Prisma.StaffProfileUncheckedCreateInput,
  Prisma.StaffProfileUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.staffProfile, 'Staff member');
  }

  /** List page: filters + search + relations (BaseRepository.paginate
   *  can't include relations, so the list query lives here). */
  async paginateList(
    query: StaffQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<StaffWithRelations>> {
    const { page, limit } = query;

    const where: Prisma.StaffProfileWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.designation ? { designation: query.designation } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { nameBn: { contains: query.search, mode: 'insensitive' } },
              { employeeId: { contains: query.search, mode: 'insensitive' } },
              {
                user: {
                  is: {
                    OR: [
                      {
                        email: { contains: query.search, mode: 'insensitive' },
                      },
                      { phone: { contains: query.search } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [field, dir] = (query.sort ?? '').split(':');
    const orderBy: Prisma.StaffProfileOrderByWithRelationInput =
      field && SORTABLE.has(field)
        ? { [field]: dir?.toLowerCase() === 'desc' ? 'desc' : 'asc' }
        : { createdAt: 'desc' };

    const [items, total] = await Promise.all([
      this.prisma.staffProfile.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.staffProfile.count({ where }),
    ]);
    return { data: items, meta: buildPaginationMeta(page, limit, total) };
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<StaffWithRelations | null> {
    return this.prisma.staffProfile.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: LIST_INCLUDE,
    });
  }

  async findByUserId(userId: string): Promise<StaffProfile | null> {
    return this.findOne({ userId });
  }

  /** Duplicate-NID soft check (warn, never block — roadmap M07 §8). */
  async countByNid(
    nid: string,
    schoolId: string,
    excludeId?: string,
  ): Promise<number> {
    return this.count(
      {
        nidNumber: nid,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      schoolId,
    );
  }
}
