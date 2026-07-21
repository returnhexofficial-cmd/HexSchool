import { Injectable } from '@nestjs/common';
import { AttendanceStatus, Prisma, StudentAttendance } from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const ROSTER_INCLUDE = {
  enrollment: {
    select: {
      id: true,
      rollNo: true,
      studentId: true,
      sectionId: true,
      classId: true,
      enrollmentDate: true,
      student: {
        select: {
          id: true,
          studentUid: true,
          firstName: true,
          lastName: true,
          nameBn: true,
          photoUrl: true,
        },
      },
    },
  },
} satisfies Prisma.StudentAttendanceInclude;

export type AttendanceWithEnrollment = Prisma.StudentAttendanceGetPayload<{
  include: typeof ROSTER_INCLUDE;
}>;

/** One attendance row's identity (roadmap M12 §7: one per student/date/period). */
export interface AttendanceKey {
  enrollmentId: string;
  date: Date;
  periodId: string | null;
}

@Injectable()
export class StudentAttendancesRepository extends BaseRepository<
  StudentAttendance,
  Prisma.StudentAttendanceWhereInput,
  Prisma.StudentAttendanceUncheckedCreateInput,
  Prisma.StudentAttendanceUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.studentAttendance, 'StudentAttendance');
  }

  /** Existing marks for a section on one date (the marking-sheet source). */
  async findForSectionDate(
    sectionId: string,
    date: Date,
    periodId: string | null,
    tx?: PrismaClientLike,
  ): Promise<StudentAttendance[]> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.studentAttendance.findMany({
      where: { sectionId, date, periodId, deletedAt: null },
    });
  }

  /** Rows for a date range, optionally narrowed to a section or student. */
  async findInRange(
    schoolId: string,
    from: Date,
    to: Date,
    filter: {
      sectionId?: string;
      enrollmentIds?: string[];
      sessionId?: string;
      classId?: string;
    } = {},
  ): Promise<AttendanceWithEnrollment[]> {
    return this.prisma.studentAttendance.findMany({
      where: {
        schoolId,
        deletedAt: null,
        date: { gte: from, lte: to },
        ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
        ...(filter.enrollmentIds
          ? { enrollmentId: { in: filter.enrollmentIds } }
          : {}),
        ...(filter.sessionId || filter.classId
          ? {
              enrollment: {
                is: {
                  ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
                  ...(filter.classId ? { classId: filter.classId } : {}),
                },
              },
            }
          : {}),
      },
      include: ROSTER_INCLUDE,
      orderBy: [{ date: 'asc' }],
    });
  }

  /** Marks of one enrollment (student history / percentage summaries). */
  async findForEnrollments(
    enrollmentIds: string[],
    from: Date,
    to: Date,
  ): Promise<StudentAttendance[]> {
    if (enrollmentIds.length === 0) return [];
    return this.prisma.studentAttendance.findMany({
      where: {
        enrollmentId: { in: enrollmentIds },
        deletedAt: null,
        date: { gte: from, lte: to },
      },
      orderBy: [{ date: 'asc' }],
    });
  }

  /** Upsert on the (enrollment, date, period) identity — re-marking a day
   *  updates in place so the partial unique index is never violated. */
  async upsertEntry(
    key: AttendanceKey,
    data: Omit<
      Prisma.StudentAttendanceUncheckedCreateInput,
      'enrollmentId' | 'date' | 'periodId'
    >,
    tx?: PrismaClientLike,
  ): Promise<StudentAttendance> {
    const client = (tx ?? this.prisma) as PrismaService;
    const existing = await client.studentAttendance.findFirst({
      where: {
        enrollmentId: key.enrollmentId,
        date: key.date,
        periodId: key.periodId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (existing) {
      // createdBy belongs to the original mark; a re-mark only moves
      // updatedBy (and the audit log keeps the full history).
      const updatable = { ...data };
      delete updatable.createdBy;
      return client.studentAttendance.update({
        where: { id: existing.id },
        data: updatable,
      });
    }
    return client.studentAttendance.create({
      data: { ...data, ...key },
    });
  }

  /** Sections that already have at least one mark on a date (auto-absent
   *  only fills sections someone actually started marking). */
  async findMarkedSectionIds(schoolId: string, date: Date): Promise<string[]> {
    const rows = await this.prisma.studentAttendance.groupBy({
      by: ['sectionId'],
      where: { schoolId, date, deletedAt: null },
    });
    return rows.map((r) => r.sectionId);
  }

  /** Today's ABSENT rows whose guardian has not been notified yet. */
  async findPendingAbsentNotifications(
    schoolId: string,
    date: Date,
    limit: number,
  ): Promise<AttendanceWithEnrollment[]> {
    return this.prisma.studentAttendance.findMany({
      where: {
        schoolId,
        date,
        deletedAt: null,
        status: AttendanceStatus.ABSENT,
        absentNotifiedAt: null,
      },
      include: ROSTER_INCLUDE,
      orderBy: [{ createdAt: 'asc' }],
      take: limit,
    });
  }

  async markNotified(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.studentAttendance.updateMany({
      where: { id: { in: ids } },
      data: { absentNotifiedAt: new Date() },
    });
  }

  /** Retro-fix for an approved leave: ABSENT → LEAVE over the range. */
  async convertAbsentToLeave(
    enrollmentIds: string[],
    from: Date,
    to: Date,
    actorId: string,
    tx?: PrismaClientLike,
  ): Promise<number> {
    if (enrollmentIds.length === 0) return 0;
    const client = (tx ?? this.prisma) as PrismaService;
    const result = await client.studentAttendance.updateMany({
      where: {
        enrollmentId: { in: enrollmentIds },
        date: { gte: from, lte: to },
        deletedAt: null,
        status: { in: [AttendanceStatus.ABSENT, AttendanceStatus.HALF_DAY] },
      },
      data: { status: AttendanceStatus.LEAVE, updatedBy: actorId },
    });
    return result.count;
  }

  /** Convert every mark on a date to HOLIDAY (late government holiday). */
  async convertDateToHoliday(
    schoolId: string,
    date: Date,
    sectionId: string | undefined,
    actorId: string,
  ): Promise<number> {
    const result = await this.prisma.studentAttendance.updateMany({
      where: {
        schoolId,
        date,
        deletedAt: null,
        status: { not: AttendanceStatus.HOLIDAY },
        ...(sectionId ? { sectionId } : {}),
      },
      data: { status: AttendanceStatus.HOLIDAY, updatedBy: actorId },
    });
    return result.count;
  }

  /** Distinct dates a section has marks for (monthly register header). */
  async findMarkedDates(
    sectionId: string,
    from: Date,
    to: Date,
  ): Promise<Date[]> {
    const rows = await this.prisma.studentAttendance.groupBy({
      by: ['date'],
      where: { sectionId, date: { gte: from, lte: to }, deletedAt: null },
      orderBy: { date: 'asc' },
    });
    return rows.map((r) => r.date);
  }

  /** Used by the M13 period mode and by tests — the nil-UUID sentinel the
   *  identity index coalesces NULL periods to. */
  static readonly NIL_PERIOD = NIL_UUID;
}
