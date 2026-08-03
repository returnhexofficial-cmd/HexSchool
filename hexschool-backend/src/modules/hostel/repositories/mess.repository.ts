import { Injectable } from '@nestjs/common';
import {
  MealOff,
  MealOffStatus,
  MessEnrollment,
  MessPlan,
  Prisma,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const MESS_ENROLLMENT_INCLUDE = {
  plan: { select: { id: true, name: true, monthlyCharge: true, status: true } },
  allocation: {
    select: {
      id: true,
      hostelId: true,
      status: true,
      startDate: true,
      endDate: true,
      suspendedAt: true,
      resumedAt: true,
      enrollment: {
        select: {
          id: true,
          rollNo: true,
          student: {
            select: {
              id: true,
              studentUid: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.MessEnrollmentInclude;

export type MessEnrollmentWithRelations = Prisma.MessEnrollmentGetPayload<{
  include: typeof MESS_ENROLLMENT_INCLUDE;
}>;

const MEAL_OFF_INCLUDE = {
  allocation: {
    select: {
      id: true,
      hostelId: true,
      status: true,
      startDate: true,
      endDate: true,
      suspendedAt: true,
      resumedAt: true,
      hostel: { select: { id: true, name: true } },
      enrollment: {
        select: {
          id: true,
          rollNo: true,
          student: {
            select: {
              id: true,
              studentUid: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.MealOffInclude;

export type MealOffWithRelations = Prisma.MealOffGetPayload<{
  include: typeof MEAL_OFF_INCLUDE;
}>;

@Injectable()
export class MessPlansRepository extends BaseRepository<
  MessPlan,
  Prisma.MessPlanWhereInput,
  Prisma.MessPlanUncheckedCreateInput,
  Prisma.MessPlanUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.messPlan, 'MessPlan');
  }

  async findMany(
    schoolId: string,
    filter: { hostelId?: string; status?: MessPlan['status'] },
  ): Promise<MessPlan[]> {
    return this.prisma.messPlan.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(filter.hostelId ? { hostelId: filter.hostelId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ name: 'asc' }],
    });
  }

  async findByName(
    hostelId: string,
    name: string,
    excludeId?: string,
  ): Promise<MessPlan | null> {
    return this.prisma.messPlan.findFirst({
      where: {
        hostelId,
        deletedAt: null,
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  /** Live subscribers — the delete guard. */
  async countSubscribers(planId: string): Promise<number> {
    return this.prisma.messEnrollment.count({
      where: { planId, deletedAt: null, endDate: null },
    });
  }
}

@Injectable()
export class MessEnrollmentsRepository extends BaseRepository<
  MessEnrollment,
  Prisma.MessEnrollmentWhereInput,
  Prisma.MessEnrollmentUncheckedCreateInput,
  Prisma.MessEnrollmentUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.messEnrollment, 'MessEnrollment');
  }

  async findMany(
    schoolId: string,
    filter: { hostelId?: string; allocationId?: string; planId?: string },
  ): Promise<MessEnrollmentWithRelations[]> {
    return this.prisma.messEnrollment.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(filter.hostelId ? { hostelId: filter.hostelId } : {}),
        ...(filter.allocationId ? { allocationId: filter.allocationId } : {}),
        ...(filter.planId ? { planId: filter.planId } : {}),
      },
      include: MESS_ENROLLMENT_INCLUDE,
      orderBy: [{ startDate: 'desc' }],
    });
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<MessEnrollmentWithRelations | null> {
    return this.prisma.messEnrollment.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: MESS_ENROLLMENT_INCLUDE,
    });
  }

  /**
   * The open enrolment for a boarder — what `uq_mess_enrollments_live`
   * allows exactly one of. A closed one is history and may sit beside it.
   */
  async findLive(
    allocationId: string,
    tx?: PrismaClientLike,
  ): Promise<MessEnrollmentWithRelations | null> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.messEnrollment.findFirst({
      where: { allocationId, deletedAt: null, endDate: null },
      include: MESS_ENROLLMENT_INCLUDE,
    });
  }

  /**
   * Every mess enrolment touching these allocations — the M16 billing
   * read. Closed windows are included for the same reason VACATED
   * allocations are: a boarder who came off full board on the 12th still
   * ate for eleven days.
   */
  async findForAllocations(
    schoolId: string,
    allocationIds: string[],
  ): Promise<MessEnrollmentWithRelations[]> {
    if (allocationIds.length === 0) return [];
    return this.prisma.messEnrollment.findMany({
      where: {
        schoolId,
        deletedAt: null,
        allocationId: { in: allocationIds },
      },
      include: MESS_ENROLLMENT_INCLUDE,
    });
  }
}

@Injectable()
export class MealOffsRepository extends BaseRepository<
  MealOff,
  Prisma.MealOffWhereInput,
  Prisma.MealOffUncheckedCreateInput,
  Prisma.MealOffUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.mealOff, 'MealOff');
  }

  async findMany(
    schoolId: string,
    filter: {
      hostelId?: string;
      allocationId?: string;
      status?: MealOffStatus;
      from?: Date;
      to?: Date;
    },
    page: number,
    limit: number,
  ): Promise<{ rows: MealOffWithRelations[]; total: number }> {
    const where: Prisma.MealOffWhereInput = {
      schoolId,
      deletedAt: null,
      ...(filter.allocationId ? { allocationId: filter.allocationId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.hostelId
        ? { allocation: { is: { hostelId: filter.hostelId } } }
        : {}),
      // A meal-off is IN a window when its range touches it at all, so
      // the two bounds are compared crosswise — a request from the 28th
      // to the 3rd belongs to both months it straddles.
      ...(filter.from ? { toDate: { gte: filter.from } } : {}),
      ...(filter.to ? { fromDate: { lte: filter.to } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.mealOff.findMany({
        where,
        include: MEAL_OFF_INCLUDE,
        orderBy: [{ fromDate: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.mealOff.count({ where }),
    ]);
    return { rows, total };
  }

  async findAllFor(
    schoolId: string,
    filter: {
      hostelId?: string;
      from?: Date;
      to?: Date;
      status?: MealOffStatus;
    },
  ): Promise<MealOffWithRelations[]> {
    return this.prisma.mealOff.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.hostelId
          ? { allocation: { is: { hostelId: filter.hostelId } } }
          : {}),
        ...(filter.from ? { toDate: { gte: filter.from } } : {}),
        ...(filter.to ? { fromDate: { lte: filter.to } } : {}),
      },
      include: MEAL_OFF_INCLUDE,
      orderBy: [{ fromDate: 'asc' }],
    });
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<MealOffWithRelations | null> {
    return this.prisma.mealOff.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: MEAL_OFF_INCLUDE,
    });
  }

  /**
   * Requests that still hold their dates — PENDING and APPROVED. Used to
   * refuse a second claim over days already claimed; a REJECTED or
   * CANCELLED one releases them.
   */
  async findLiveInRange(
    allocationId: string,
    excludeId?: string,
  ): Promise<MealOff[]> {
    return this.prisma.mealOff.findMany({
      where: {
        allocationId,
        deletedAt: null,
        status: { in: [MealOffStatus.PENDING, MealOffStatus.APPROVED] },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  async countPending(allocationId: string): Promise<number> {
    return this.prisma.mealOff.count({
      where: {
        allocationId,
        deletedAt: null,
        status: MealOffStatus.PENDING,
      },
    });
  }

  /**
   * Approved meal-offs whose credit belongs to this month — the read the
   * M16 billing handoff makes. `credit_month` was decided once, at
   * approval, precisely so that this query is a plain equality and
   * regenerating a month gives the same answer.
   */
  async findCreditsForMonth(
    schoolId: string,
    allocationIds: string[],
    creditMonth: Date,
  ): Promise<MealOff[]> {
    if (allocationIds.length === 0) return [];
    return this.prisma.mealOff.findMany({
      where: {
        schoolId,
        deletedAt: null,
        allocationId: { in: allocationIds },
        status: MealOffStatus.APPROVED,
        creditMonth,
      },
    });
  }
}
