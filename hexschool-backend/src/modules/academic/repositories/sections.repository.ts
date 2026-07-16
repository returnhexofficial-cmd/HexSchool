import { Injectable } from '@nestjs/common';
import { Prisma, Section } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import {
  PaginatedResult,
  buildPaginationMeta,
} from '../../../common/dto/paginated.dto';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { SectionListQueryDto } from '../dto';

export type SectionWithRelations = Prisma.SectionGetPayload<{
  include: {
    class: { select: { id: true; name: true; numericLevel: true } };
    shift: { select: { id: true; name: true } };
    group: { select: { id: true; name: true } };
  };
}>;

const RELATIONS = {
  class: { select: { id: true, name: true, numericLevel: true } },
  shift: { select: { id: true, name: true } },
  group: { select: { id: true, name: true } },
} as const;

@Injectable()
export class SectionsRepository extends BaseRepository<
  Section,
  Prisma.SectionWhereInput,
  Prisma.SectionUncheckedCreateInput,
  Prisma.SectionUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.section, 'Section');
  }

  /** List with class/shift/group names (session/class filterable). */
  async paginateWithRelations(
    query: SectionListQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<SectionWithRelations>> {
    const where: Prisma.SectionWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.section.findMany({
        where,
        include: RELATIONS,
        orderBy: [{ class: { numericLevel: 'asc' } }, { name: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.section.count({ where }),
    ]);
    return {
      data: items,
      meta: buildPaginationMeta(query.page, query.limit, total),
    };
  }

  /** Identity duplicate check (mirrors uq_sections_identity). */
  async findByIdentity(params: {
    schoolId: string;
    sessionId: string;
    classId: string;
    name: string;
    shiftId: string | null;
    excludeId?: string;
  }): Promise<Section | null> {
    return this.prisma.section.findFirst({
      where: {
        schoolId: params.schoolId,
        sessionId: params.sessionId,
        classId: params.classId,
        name: { equals: params.name, mode: 'insensitive' },
        shiftId: params.shiftId,
        deletedAt: null,
        ...(params.excludeId ? { id: { not: params.excludeId } } : {}),
      },
    });
  }

  /** All live sections of a session (clone source/target). */
  async findForSession(
    schoolId: string,
    sessionId: string,
  ): Promise<Section[]> {
    return this.prisma.section.findMany({
      where: { schoolId, sessionId, deletedAt: null },
    });
  }
}
