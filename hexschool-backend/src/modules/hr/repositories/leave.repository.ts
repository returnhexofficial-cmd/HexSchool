import { Injectable } from '@nestjs/common';
import {
  AttendancePersonType,
  LeaveApplication,
  LeaveBalance,
  LeaveStatus,
  LeaveType,
  Prisma,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

export type LeaveApplicationWithType = LeaveApplication & {
  leaveType: LeaveType;
};

export type LeaveBalanceWithType = LeaveBalance & { leaveType: LeaveType };

export interface LeaveApplicationFilter {
  personType?: AttendancePersonType;
  personId?: string;
  leaveTypeId?: string;
  status?: LeaveStatus;
  from?: Date;
  to?: Date;
}

@Injectable()
export class LeaveTypesRepository extends BaseRepository<
  LeaveType,
  Prisma.LeaveTypeWhereInput,
  Prisma.LeaveTypeUncheckedCreateInput,
  Prisma.LeaveTypeUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.leaveType, 'LeaveType');
  }

  async findAllForSchool(
    schoolId: string,
    options: { activeOnly?: boolean } = {},
  ): Promise<LeaveType[]> {
    return this.prisma.leaveType.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(options.activeOnly ? { isActive: true } : {}),
      },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findByCode(schoolId: string, code: string): Promise<LeaveType | null> {
    return this.prisma.leaveType.findFirst({
      where: { schoolId, code, deletedAt: null },
    });
  }

  /** Live applications referencing a type — the delete guard reads it. */
  async countApplications(leaveTypeId: string): Promise<number> {
    return this.prisma.leaveApplication.count({
      where: { leaveTypeId, deletedAt: null },
    });
  }
}

@Injectable()
export class LeaveBalancesRepository extends BaseRepository<
  LeaveBalance,
  Prisma.LeaveBalanceWhereInput,
  Prisma.LeaveBalanceUncheckedCreateInput,
  Prisma.LeaveBalanceUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.leaveBalance, 'LeaveBalance');
  }

  async findForPerson(
    schoolId: string,
    sessionId: string,
    personType: AttendancePersonType,
    personId: string,
  ): Promise<LeaveBalanceWithType[]> {
    return this.prisma.leaveBalance.findMany({
      where: { schoolId, sessionId, personType, personId, deletedAt: null },
      include: { leaveType: true },
      orderBy: { leaveType: { displayOrder: 'asc' } },
    });
  }

  async findOneFor(
    schoolId: string,
    sessionId: string,
    personType: AttendancePersonType,
    personId: string,
    leaveTypeId: string,
    tx?: PrismaClientLike,
  ): Promise<LeaveBalance | null> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.leaveBalance.findFirst({
      where: {
        schoolId,
        sessionId,
        personType,
        personId,
        leaveTypeId,
        deletedAt: null,
      },
    });
  }

  async findForSession(
    schoolId: string,
    sessionId: string,
  ): Promise<LeaveBalanceWithType[]> {
    return this.prisma.leaveBalance.findMany({
      where: { schoolId, sessionId, deletedAt: null },
      include: { leaveType: true },
    });
  }

  /**
   * Create or update the identity row, inside the caller's transaction.
   *
   * `uq_leave_balances_identity` is what stops the allocation job from
   * adding a second row on its next run and quietly doubling somebody's
   * quota; this is the read-then-write that keeps the job idempotent, and
   * the index is what holds if two runs race.
   */
  async upsertBalance(
    key: {
      schoolId: string;
      sessionId: string;
      personType: AttendancePersonType;
      personId: string;
      leaveTypeId: string;
    },
    data: { allocated?: number; carried?: number; used?: number },
    actorId: string | null,
    tx?: PrismaClientLike,
  ): Promise<LeaveBalance> {
    const client = (tx ?? this.prisma) as PrismaService;
    const existing = await client.leaveBalance.findFirst({
      where: { ...key, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      return client.leaveBalance.update({
        where: { id: existing.id },
        data: { ...data, updatedBy: actorId },
      });
    }
    return client.leaveBalance.create({
      data: { ...key, ...data, createdBy: actorId, updatedBy: actorId },
    });
  }

  /**
   * Move `used` by a signed delta.
   *
   * An approval adds days and a cancellation gives them back, so this is
   * a relative update rather than a write of a computed total — two
   * approvals landing at once must not each write "what used was plus
   * mine" over the other.
   */
  async addUsed(
    id: string,
    delta: number,
    tx?: PrismaClientLike,
  ): Promise<void> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.leaveBalance.update({
      where: { id },
      data: { used: { increment: delta } },
    });
  }
}

@Injectable()
export class LeaveApplicationsRepository extends BaseRepository<
  LeaveApplication,
  Prisma.LeaveApplicationWhereInput,
  Prisma.LeaveApplicationUncheckedCreateInput,
  Prisma.LeaveApplicationUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.leaveApplication, 'LeaveApplication');
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<LeaveApplicationWithType | null> {
    return this.prisma.leaveApplication.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: { leaveType: true },
    });
  }

  async findMany(
    schoolId: string,
    filter: LeaveApplicationFilter,
    page: number,
    limit: number,
  ): Promise<{ rows: LeaveApplicationWithType[]; total: number }> {
    const where: Prisma.LeaveApplicationWhereInput = {
      schoolId,
      deletedAt: null,
      ...(filter.personType ? { personType: filter.personType } : {}),
      ...(filter.personId ? { personId: filter.personId } : {}),
      ...(filter.leaveTypeId ? { leaveTypeId: filter.leaveTypeId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      // Overlap, not containment: a leave that started last month and ends
      // inside the window is part of this window's picture.
      ...(filter.to ? { fromDate: { lte: filter.to } } : {}),
      ...(filter.from ? { toDate: { gte: filter.from } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.leaveApplication.findMany({
        where,
        include: { leaveType: true },
        orderBy: [{ fromDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.leaveApplication.count({ where }),
    ]);
    return { rows, total };
  }

  /** Every live application of one person that touches [from, to]. */
  async findOverlapping(
    schoolId: string,
    personType: AttendancePersonType,
    personId: string,
    from: Date,
    to: Date,
    statuses: LeaveStatus[],
  ): Promise<LeaveApplication[]> {
    return this.prisma.leaveApplication.findMany({
      where: {
        schoolId,
        personType,
        personId,
        deletedAt: null,
        status: { in: statuses },
        fromDate: { lte: to },
        toDate: { gte: from },
      },
    });
  }

  /**
   * Approved leave inside a month, for the whole workforce — what payroll
   * reads to split paid from unpaid days. One query, not one per person.
   */
  async findApprovedInRange(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<LeaveApplicationWithType[]> {
    return this.prisma.leaveApplication.findMany({
      where: {
        schoolId,
        deletedAt: null,
        status: LeaveStatus.APPROVED,
        fromDate: { lte: to },
        toDate: { gte: from },
      },
      include: { leaveType: true },
    });
  }
}
