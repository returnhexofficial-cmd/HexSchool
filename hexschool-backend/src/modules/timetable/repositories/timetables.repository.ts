import { Injectable } from '@nestjs/common';
import { Prisma, Timetable, TimetableStatus } from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const RELATIONS = {
  section: {
    select: {
      id: true,
      name: true,
      shiftId: true,
      groupId: true,
      classId: true,
      roomNo: true,
      class: { select: { id: true, name: true, numericLevel: true } },
      shift: { select: { id: true, name: true } },
    },
  },
  session: { select: { id: true, name: true } },
} satisfies Prisma.TimetableInclude;

export type TimetableWithSection = Prisma.TimetableGetPayload<{
  include: typeof RELATIONS;
}>;

@Injectable()
export class TimetablesRepository extends BaseRepository<
  Timetable,
  Prisma.TimetableWhereInput,
  Prisma.TimetableUncheckedCreateInput,
  Prisma.TimetableUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.timetable, 'Timetable');
  }

  async findDetail(
    id: string,
    schoolId: string,
    tx?: PrismaClientLike,
  ): Promise<TimetableWithSection | null> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.timetable.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: RELATIONS,
    });
  }

  /**
   * The one live routine of a section in a given lifecycle state — the
   * partial unique `uq_timetables_live_version` guarantees at most one
   * DRAFT and one PUBLISHED, so this is a lookup and not a list.
   */
  async findLive(
    sessionId: string,
    sectionId: string,
    status: TimetableStatus,
    tx?: PrismaClientLike,
  ): Promise<TimetableWithSection | null> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.timetable.findFirst({
      where: { sessionId, sectionId, status, deletedAt: null },
      include: RELATIONS,
    });
  }

  /** Routines of a session, newest version first (list + master grid). */
  async findForSession(
    schoolId: string,
    sessionId: string,
    filter: {
      status?: TimetableStatus;
      sectionIds?: string[];
      classId?: string;
    } = {},
  ): Promise<TimetableWithSection[]> {
    return this.prisma.timetable.findMany({
      where: {
        schoolId,
        sessionId,
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.sectionIds ? { sectionId: { in: filter.sectionIds } } : {}),
        ...(filter.classId
          ? { section: { is: { classId: filter.classId } } }
          : {}),
      },
      include: RELATIONS,
      orderBy: [
        { section: { class: { numericLevel: 'asc' } } },
        { section: { name: 'asc' } },
        { version: 'desc' },
      ],
    });
  }

  /** All versions of one section's routine (the effective_from history). */
  async findVersions(
    sessionId: string,
    sectionId: string,
    schoolId: string,
  ): Promise<Timetable[]> {
    return this.prisma.timetable.findMany({
      where: { sessionId, sectionId, schoolId, deletedAt: null },
      orderBy: { version: 'desc' },
    });
  }

  /** Highest version ever issued for a section (publish increments it). */
  async maxVersion(sessionId: string, sectionId: string): Promise<number> {
    const row = await this.prisma.timetable.aggregate({
      where: { sessionId, sectionId },
      _max: { version: true },
    });
    return row._max.version ?? 0;
  }

  async setStatus(
    id: string,
    data: Prisma.TimetableUncheckedUpdateInput,
    tx?: PrismaClientLike,
  ): Promise<Timetable> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.timetable.update({ where: { id }, data });
  }
}
