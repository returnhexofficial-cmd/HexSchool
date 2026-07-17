import { Injectable } from '@nestjs/common';
import { Guardian, Prisma } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../common/dto/paginated.dto';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { GuardianQueryDto } from '../dto';

const LIST_INCLUDE = {
  user: {
    select: { id: true, email: true, phone: true, status: true },
  },
  students: {
    include: {
      student: {
        select: {
          id: true,
          studentUid: true,
          firstName: true,
          lastName: true,
          status: true,
        },
      },
    },
  },
} satisfies Prisma.GuardianInclude;

export type GuardianWithRelations = Prisma.GuardianGetPayload<{
  include: typeof LIST_INCLUDE;
}>;

const SORTABLE = new Set(['name', 'phone', 'relation', 'createdAt']);

@Injectable()
export class GuardiansRepository extends BaseRepository<
  Guardian,
  Prisma.GuardianWhereInput,
  Prisma.GuardianUncheckedCreateInput,
  Prisma.GuardianUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.guardian, 'Guardian');
  }

  async paginateList(
    query: GuardianQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<GuardianWithRelations>> {
    const { page, limit } = query;

    const where: Prisma.GuardianWhereInput = {
      schoolId,
      deletedAt: null,
      // Exact phone → dedup probe from the wizard's search-or-create step.
      ...(query.phone ? { phone: query.phone } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { nameBn: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { nid: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [field, dir] = (query.sort ?? '').split(':');
    const orderBy: Prisma.GuardianOrderByWithRelationInput =
      field && SORTABLE.has(field)
        ? { [field]: dir?.toLowerCase() === 'desc' ? 'desc' : 'asc' }
        : { createdAt: 'desc' };

    const [items, total] = await Promise.all([
      this.prisma.guardian.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.guardian.count({ where }),
    ]);
    return { data: items, meta: buildPaginationMeta(page, limit, total) };
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<GuardianWithRelations | null> {
    return this.prisma.guardian.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: LIST_INCLUDE,
    });
  }

  /** Dedup lookup: guardians are shared across siblings by phone. */
  async findByPhone(
    phone: string,
    schoolId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Guardian | null> {
    const client = tx ?? this.prisma;
    return client.guardian.findFirst({
      where: { phone, schoolId, deletedAt: null },
    });
  }
}
