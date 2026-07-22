import { Injectable } from '@nestjs/common';
import { Prisma, TimetableStatus, Weekday } from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const RELATIONS = {
  subject: { select: { id: true, name: true, code: true, type: true } },
  teacher: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeId: true,
      photoUrl: true,
    },
  },
  periodSlot: {
    select: {
      id: true,
      name: true,
      startTime: true,
      endTime: true,
      type: true,
      displayOrder: true,
      shiftId: true,
    },
  },
  combinedWithSection: {
    select: { id: true, name: true, class: { select: { name: true } } },
  },
  timetable: {
    select: {
      id: true,
      status: true,
      version: true,
      sessionId: true,
      sectionId: true,
      section: {
        select: {
          id: true,
          name: true,
          roomNo: true,
          class: { select: { id: true, name: true, numericLevel: true } },
          shift: { select: { id: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.TimetableEntryInclude;

export type EntryWithRelations = Prisma.TimetableEntryGetPayload<{
  include: typeof RELATIONS;
}>;

/**
 * Routine cells. Composite-identity child rows with no soft delete — the
 * bulk endpoint replaces a timetable's cells wholesale and the audit log
 * keeps the diff (the M06 `class_subjects` pattern).
 */
@Injectable()
export class TimetableEntriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findForTimetable(
    timetableId: string,
    tx?: PrismaClientLike,
  ): Promise<EntryWithRelations[]> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.timetableEntry.findMany({
      where: { timetableId },
      include: RELATIONS,
      orderBy: [{ periodSlot: { displayOrder: 'asc' } }],
    });
  }

  /**
   * Every cell of a session in the given lifecycle states — the conflict
   * engine's competition set and the master grid's source.
   * `excludeTimetableId` drops the routine being edited, whose old rows
   * are about to be replaced and must not clash with their successors.
   */
  async findForSession(
    schoolId: string,
    sessionId: string,
    statuses: TimetableStatus[],
    options: { excludeTimetableId?: string; teacherId?: string } = {},
    tx?: PrismaClientLike,
  ): Promise<EntryWithRelations[]> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.timetableEntry.findMany({
      where: {
        schoolId,
        ...(options.teacherId ? { teacherId: options.teacherId } : {}),
        timetable: {
          is: {
            sessionId,
            status: { in: statuses },
            deletedAt: null,
            ...(options.excludeTimetableId
              ? { id: { not: options.excludeTimetableId } }
              : {}),
          },
        },
      },
      include: RELATIONS,
      orderBy: [{ periodSlot: { displayOrder: 'asc' } }],
    });
  }

  /** One teacher's cells across every section of a session (their routine). */
  async findForTeacher(
    teacherId: string,
    sessionId: string,
    schoolId: string,
    statuses: TimetableStatus[],
  ): Promise<EntryWithRelations[]> {
    return this.findForSession(schoolId, sessionId, statuses, { teacherId });
  }

  /** Periods/week per teacher — finalizes the M08 workload stub. */
  async periodsPerWeek(
    sessionId: string,
    schoolId: string,
    statuses: TimetableStatus[] = [TimetableStatus.PUBLISHED],
  ): Promise<Array<{ teacherId: string; periods: number }>> {
    const rows = await this.prisma.timetableEntry.groupBy({
      by: ['teacherId'],
      where: {
        schoolId,
        timetable: {
          is: { sessionId, status: { in: statuses }, deletedAt: null },
        },
      },
      _count: { _all: true },
    });
    return rows.map((r) => ({
      teacherId: r.teacherId,
      periods: r._count._all,
    }));
  }

  /** Cells a teacher holds on one day (the M08 assignment-time check). */
  async findForTeacherDay(
    teacherId: string,
    sessionId: string,
    day: Weekday,
    statuses: TimetableStatus[],
  ): Promise<EntryWithRelations[]> {
    return this.prisma.timetableEntry.findMany({
      where: {
        teacherId,
        day,
        timetable: {
          is: { sessionId, status: { in: statuses }, deletedAt: null },
        },
      },
      include: RELATIONS,
    });
  }

  /** Replace a routine's cells in one transaction (bulk entry upsert). */
  async replaceForTimetable(
    timetableId: string,
    rows: Prisma.TimetableEntryUncheckedCreateInput[],
    tx?: PrismaClientLike,
  ): Promise<number> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.timetableEntry.deleteMany({ where: { timetableId } });
    if (rows.length === 0) return 0;
    const { count } = await client.timetableEntry.createMany({ data: rows });
    return count;
  }

  /** Copy every cell of one routine onto another (publish → new draft). */
  async cloneInto(
    fromTimetableId: string,
    toTimetableId: string,
    actorId: string,
    tx?: PrismaClientLike,
  ): Promise<number> {
    const client = (tx ?? this.prisma) as PrismaService;
    const source = await client.timetableEntry.findMany({
      where: { timetableId: fromTimetableId },
    });
    if (source.length === 0) return 0;
    const { count } = await client.timetableEntry.createMany({
      data: source.map((entry) => ({
        schoolId: entry.schoolId,
        timetableId: toTimetableId,
        day: entry.day,
        periodSlotId: entry.periodSlotId,
        subjectId: entry.subjectId,
        teacherId: entry.teacherId,
        roomNo: entry.roomNo,
        combinedWithSectionId: entry.combinedWithSectionId,
        createdBy: actorId,
        updatedBy: actorId,
      })),
    });
    return count;
  }

  async countForTimetable(timetableId: string): Promise<number> {
    return this.prisma.timetableEntry.count({ where: { timetableId } });
  }
}
