import { Injectable } from '@nestjs/common';
import {
  Appointment,
  AppointmentStatus,
  Prisma,
  Visitor,
  VisitorHostType,
  VisitorPurpose,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

export interface VisitorFilter {
  purpose?: VisitorPurpose;
  hostType?: VisitorHostType;
  hostId?: string;
  /** `true` = still in the building, `false` = signed out. */
  inside?: boolean;
  from?: Date;
  to?: Date;
  search?: string;
}

@Injectable()
export class VisitorsRepository extends BaseRepository<
  Visitor,
  Prisma.VisitorWhereInput,
  Prisma.VisitorUncheckedCreateInput,
  Prisma.VisitorUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.visitor, 'Visitor');
  }

  private where(
    schoolId: string,
    filter: VisitorFilter,
  ): Prisma.VisitorWhereInput {
    return {
      schoolId,
      deletedAt: null,
      ...(filter.purpose ? { purpose: filter.purpose } : {}),
      ...(filter.hostType ? { hostType: filter.hostType } : {}),
      ...(filter.hostId ? { hostId: filter.hostId } : {}),
      // **The in-building list is this predicate and nothing else.** There
      // is no status column to fall out of step with it (the M26 bed-status
      // lesson, inverted: here the query IS the truth and no column tries).
      ...(filter.inside === true ? { checkOut: null } : {}),
      ...(filter.inside === false ? { checkOut: { not: null } } : {}),
      ...(filter.from || filter.to
        ? {
            checkIn: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search, mode: 'insensitive' } },
              { phone: { contains: filter.search, mode: 'insensitive' } },
              { gatePassNo: { contains: filter.search, mode: 'insensitive' } },
              { whomToMeet: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  async findMany(
    schoolId: string,
    filter: VisitorFilter,
    page: number,
    limit: number,
  ): Promise<{ rows: Visitor[]; total: number }> {
    const where = this.where(schoolId, filter);
    const [rows, total] = await Promise.all([
      this.prisma.visitor.findMany({
        where,
        orderBy: [{ checkIn: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.visitor.count({ where }),
    ]);
    return { rows, total };
  }

  async findAllFor(
    schoolId: string,
    filter: VisitorFilter,
  ): Promise<Visitor[]> {
    return this.prisma.visitor.findMany({
      where: this.where(schoolId, filter),
      orderBy: [{ checkIn: 'asc' }],
    });
  }

  async findDetail(id: string, schoolId: string): Promise<Visitor | null> {
    return this.prisma.visitor.findFirst({
      where: { id, schoolId, deletedAt: null },
    });
  }

  /** Everybody signed in and not signed out — the live board. */
  async findInside(schoolId: string): Promise<Visitor[]> {
    return this.prisma.visitor.findMany({
      where: { schoolId, deletedAt: null, checkOut: null },
      orderBy: [{ checkIn: 'asc' }],
    });
  }

  async gatePassTaken(schoolId: string, gatePassNo: string): Promise<boolean> {
    // Deliberately NOT `deleted_at`-scoped, matching
    // `uq_visitors_gate_pass`: a pass number printed on a card must never
    // come back attached to a different visit.
    const found = await this.prisma.visitor.findFirst({
      where: { schoolId, gatePassNo },
      select: { id: true },
    });
    return found !== null;
  }

  async withTransaction<R>(
    fn: (tx: PrismaClientLike) => Promise<R>,
  ): Promise<R> {
    return this.prisma.$transaction((tx) => fn(tx));
  }
}

export interface AppointmentFilter {
  status?: AppointmentStatus;
  hostType?: VisitorHostType;
  hostId?: string;
  from?: Date;
  to?: Date;
  search?: string;
}

@Injectable()
export class AppointmentsRepository extends BaseRepository<
  Appointment,
  Prisma.AppointmentWhereInput,
  Prisma.AppointmentUncheckedCreateInput,
  Prisma.AppointmentUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.appointment, 'Appointment');
  }

  private where(
    schoolId: string,
    filter: AppointmentFilter,
  ): Prisma.AppointmentWhereInput {
    return {
      schoolId,
      deletedAt: null,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.hostType ? { hostType: filter.hostType } : {}),
      ...(filter.hostId ? { hostId: filter.hostId } : {}),
      ...(filter.from || filter.to
        ? {
            scheduledAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
      ...(filter.search
        ? {
            OR: [
              { visitorName: { contains: filter.search, mode: 'insensitive' } },
              { phone: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  async findMany(
    schoolId: string,
    filter: AppointmentFilter,
    page: number,
    limit: number,
  ): Promise<{ rows: Appointment[]; total: number }> {
    const where = this.where(schoolId, filter);
    const [rows, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        orderBy: [{ scheduledAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.appointment.count({ where }),
    ]);
    return { rows, total };
  }

  async findDetail(id: string, schoolId: string): Promise<Appointment | null> {
    return this.prisma.appointment.findFirst({
      where: { id, schoolId, deletedAt: null },
    });
  }

  /** The calendar's window — everything scheduled between two instants. */
  async findInWindow(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<Appointment[]> {
    return this.prisma.appointment.findMany({
      where: {
        schoolId,
        deletedAt: null,
        scheduledAt: { gte: from, lte: to },
      },
      orderBy: [{ scheduledAt: 'asc' }],
    });
  }
}
