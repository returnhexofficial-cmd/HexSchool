import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const RELATIONS = {
  entries: {
    include: {
      enrollment: {
        select: {
          id: true,
          rollNo: true,
          classId: true,
          sectionId: true,
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
          class: { select: { id: true, name: true } },
          section: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { seatNo: 'asc' },
  },
} satisfies Prisma.SeatPlanInclude;

export type SeatPlanWithEntries = Prisma.SeatPlanGetPayload<{
  include: typeof RELATIONS;
}>;

/**
 * Seat plans and their entries. Generated artifacts, replaced per date
 * wholesale — hard-deleted rather than soft-deleted (see the schema note
 * on `SeatPlan`), so regeneration cannot leave half a stale plan behind.
 */
@Injectable()
export class SeatPlansRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findForExam(
    examId: string,
    date?: Date,
  ): Promise<SeatPlanWithEntries[]> {
    return this.prisma.seatPlan.findMany({
      where: { examId, ...(date ? { date } : {}) },
      include: RELATIONS,
      orderBy: [{ date: 'asc' }, { room: 'asc' }],
    });
  }

  async findById(
    id: string,
    schoolId: string,
  ): Promise<SeatPlanWithEntries | null> {
    return this.prisma.seatPlan.findFirst({
      where: { id, schoolId },
      include: RELATIONS,
    });
  }

  async countForExam(examId: string): Promise<number> {
    return this.prisma.seatPlan.count({ where: { examId } });
  }

  /** Enrollments already seated on a date, across every room of it. */
  async findSeatedEnrollmentIds(
    examId: string,
    date: Date,
  ): Promise<Set<string>> {
    const rows = await this.prisma.seatPlanEntry.findMany({
      where: { seatPlan: { is: { examId, date } } },
      select: { enrollmentId: true },
    });
    return new Set(rows.map((r) => r.enrollmentId));
  }

  /**
   * Replace every room of one exam date in a single transaction — the
   * only writer of a full plan, and what makes "a candidate sits once per
   * date" true without a cross-room DB constraint.
   */
  async replaceForDate(
    examId: string,
    schoolId: string,
    date: Date,
    rooms: Array<{
      room: string;
      capacity: number;
      strategy: Prisma.SeatPlanUncheckedCreateInput['strategy'];
      seats: Array<{ enrollmentId: string; seatNo: number }>;
    }>,
    actorId: string,
  ): Promise<{ rooms: number; seats: number }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.seatPlan.deleteMany({ where: { examId, date } });

      let seats = 0;
      for (const spec of rooms) {
        const plan = await tx.seatPlan.create({
          data: {
            schoolId,
            examId,
            room: spec.room,
            date,
            capacity: spec.capacity,
            strategy: spec.strategy,
            createdBy: actorId,
            updatedBy: actorId,
          },
        });
        if (spec.seats.length === 0) continue;
        const { count } = await tx.seatPlanEntry.createMany({
          data: spec.seats.map((seat) => ({
            schoolId,
            seatPlanId: plan.id,
            enrollmentId: seat.enrollmentId,
            seatNo: seat.seatNo,
          })),
        });
        seats += count;
      }
      return { rooms: rooms.length, seats };
    });
  }

  async addEntry(
    data: Prisma.SeatPlanEntryUncheckedCreateInput,
    tx?: PrismaClientLike,
  ): Promise<void> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.seatPlanEntry.create({ data });
  }

  async deleteForDate(examId: string, date: Date): Promise<number> {
    const { count } = await this.prisma.seatPlan.deleteMany({
      where: { examId, date },
    });
    return count;
  }

  /** A candidate's seat for one exam date — printed on the admit card. */
  async findSeatsForEnrollments(
    examId: string,
    enrollmentIds: string[],
  ): Promise<
    Array<{ enrollmentId: string; date: Date; room: string; seatNo: number }>
  > {
    if (enrollmentIds.length === 0) return [];
    const rows = await this.prisma.seatPlanEntry.findMany({
      where: {
        enrollmentId: { in: enrollmentIds },
        seatPlan: { is: { examId } },
      },
      select: {
        enrollmentId: true,
        seatNo: true,
        seatPlan: { select: { room: true, date: true } },
      },
    });
    return rows.map((r) => ({
      enrollmentId: r.enrollmentId,
      date: r.seatPlan.date,
      room: r.seatPlan.room,
      seatNo: r.seatNo,
    }));
  }
}
