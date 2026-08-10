import { Injectable } from '@nestjs/common';
import {
  Alumni,
  AlumniEvent,
  AlumniEventRegistration,
  AlumniRegistrationStatus,
  AlumniStatus,
  Donation,
  Prisma,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

export interface AlumniFilter {
  status?: AlumniStatus;
  batchYear?: number;
  /** Only opted-in profiles — the public directory's filter. */
  publicOnly?: boolean;
  search?: string;
}

@Injectable()
export class AlumniRepository extends BaseRepository<
  Alumni,
  Prisma.AlumniWhereInput,
  Prisma.AlumniUncheckedCreateInput,
  Prisma.AlumniUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.alumni, 'Alumni');
  }

  private where(
    schoolId: string,
    filter: AlumniFilter,
  ): Prisma.AlumniWhereInput {
    return {
      schoolId,
      deletedAt: null,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.batchYear ? { batchYear: filter.batchYear } : {}),
      // **The privacy policy is this clause** (the M19 rule). The public
      // directory never fetches a profile that has not opted in, rather
      // than fetching it and dropping fields — one lock in the query, and
      // `alumni.engine`'s `publicProfile` is the second on the way out.
      ...(filter.publicOnly
        ? { isPublicProfile: true, status: AlumniStatus.APPROVED }
        : {}),
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search, mode: 'insensitive' } },
              { profession: { contains: filter.search, mode: 'insensitive' } },
              {
                organization: { contains: filter.search, mode: 'insensitive' },
              },
              { lastClass: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  async findMany(
    schoolId: string,
    filter: AlumniFilter,
    page: number,
    limit: number,
  ): Promise<{ rows: Alumni[]; total: number }> {
    const where = this.where(schoolId, filter);
    const [rows, total] = await Promise.all([
      this.prisma.alumni.findMany({
        where,
        // Newest batches first, then alphabetical — how a directory reads.
        orderBy: [{ batchYear: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.alumni.count({ where }),
    ]);
    return { rows, total };
  }

  async findAllFor(schoolId: string, filter: AlumniFilter): Promise<Alumni[]> {
    return this.prisma.alumni.findMany({
      where: this.where(schoolId, filter),
      orderBy: [{ batchYear: 'desc' }, { name: 'asc' }],
    });
  }

  async findDetail(id: string, schoolId: string): Promise<Alumni | null> {
    return this.prisma.alumni.findFirst({
      where: { id, schoolId, deletedAt: null },
    });
  }

  /**
   * Student ids somebody already holds an APPROVED claim on — the input
   * to roadmap §8's conflict check, and the same set
   * `uq_alumni_student` enforces at the database.
   */
  async claimedStudentIds(schoolId: string): Promise<Set<string>> {
    const rows = await this.prisma.alumni.findMany({
      where: {
        schoolId,
        deletedAt: null,
        status: AlumniStatus.APPROVED,
        studentId: { not: null },
      },
      select: { studentId: true },
    });
    return new Set(
      rows
        .map((row) => row.studentId)
        .filter((id): id is string => id !== null),
    );
  }

  /** Batch years present, with a count — the directory's filter chips. */
  async batchYears(
    schoolId: string,
    publicOnly: boolean,
  ): Promise<Array<{ batchYear: number; count: number }>> {
    const rows = await this.prisma.alumni.groupBy({
      by: ['batchYear'],
      where: this.where(schoolId, { publicOnly }),
      _count: { _all: true },
      orderBy: { batchYear: 'desc' },
    });
    return rows.map((row) => ({
      batchYear: row.batchYear,
      count: row._count._all,
    }));
  }

  async withTransaction<R>(
    fn: (tx: PrismaClientLike) => Promise<R>,
  ): Promise<R> {
    return this.prisma.$transaction((tx) => fn(tx));
  }
}

@Injectable()
export class AlumniEventsRepository extends BaseRepository<
  AlumniEvent,
  Prisma.AlumniEventWhereInput,
  Prisma.AlumniEventUncheckedCreateInput,
  Prisma.AlumniEventUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.alumniEvent, 'AlumniEvent');
  }

  async findMany(
    schoolId: string,
    filter: { publishedOnly?: boolean; upcomingOnly?: boolean; from?: Date },
    page: number,
    limit: number,
  ): Promise<{ rows: AlumniEvent[]; total: number }> {
    const where: Prisma.AlumniEventWhereInput = {
      schoolId,
      deletedAt: null,
      ...(filter.publishedOnly ? { isPublished: true } : {}),
      ...(filter.upcomingOnly
        ? { eventDate: { gte: filter.from ?? new Date() } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.alumniEvent.findMany({
        where,
        orderBy: [{ eventDate: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.alumniEvent.count({ where }),
    ]);
    return { rows, total };
  }

  async findDetail(id: string, schoolId: string): Promise<AlumniEvent | null> {
    return this.prisma.alumniEvent.findFirst({
      where: { id, schoolId, deletedAt: null },
    });
  }
}

@Injectable()
export class AlumniEventRegistrationsRepository extends BaseRepository<
  AlumniEventRegistration,
  Prisma.AlumniEventRegistrationWhereInput,
  Prisma.AlumniEventRegistrationUncheckedCreateInput,
  Prisma.AlumniEventRegistrationUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(
      prisma,
      (client) => client.alumniEventRegistration,
      'AlumniEventRegistration',
    );
  }

  async findForEvent(
    eventId: string,
    schoolId: string,
  ): Promise<Array<AlumniEventRegistration & { alumni: Alumni }>> {
    return this.prisma.alumniEventRegistration.findMany({
      where: { eventId, schoolId, deletedAt: null },
      include: { alumni: true },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  async findLive(
    eventId: string,
    alumniId: string,
    schoolId: string,
  ): Promise<AlumniEventRegistration | null> {
    return this.prisma.alumniEventRegistration.findFirst({
      where: {
        eventId,
        alumniId,
        schoolId,
        deletedAt: null,
        status: { not: AlumniRegistrationStatus.CANCELLED },
      },
    });
  }

  /**
   * Seats taken: one per live registration, plus their guests. Matches
   * `alumni.engine`'s `seatsFor`, and the CANCELLED exclusion matches
   * `uq_alumni_event_registrations_identity` — a withdrawal frees the seat.
   */
  async seatsTaken(eventId: string, schoolId: string): Promise<number> {
    const rows = await this.prisma.alumniEventRegistration.findMany({
      where: {
        eventId,
        schoolId,
        deletedAt: null,
        status: { not: AlumniRegistrationStatus.CANCELLED },
      },
      select: { guests: true },
    });
    return rows.reduce((sum, row) => sum + 1 + Math.max(0, row.guests), 0);
  }
}

export interface DonationFilter {
  alumniId?: string;
  method?: string;
  from?: Date;
  to?: Date;
  /** Cancelled receipts stay in the register; this hides them on request. */
  liveOnly?: boolean;
  search?: string;
}

@Injectable()
export class DonationsRepository extends BaseRepository<
  Donation,
  Prisma.DonationWhereInput,
  Prisma.DonationUncheckedCreateInput,
  Prisma.DonationUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.donation, 'Donation');
  }

  private where(
    schoolId: string,
    filter: DonationFilter,
  ): Prisma.DonationWhereInput {
    return {
      schoolId,
      deletedAt: null,
      ...(filter.alumniId ? { alumniId: filter.alumniId } : {}),
      ...(filter.method ? { method: filter.method as Donation['method'] } : {}),
      ...(filter.liveOnly ? { cancelledAt: null } : {}),
      ...(filter.from || filter.to
        ? {
            receivedAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
      ...(filter.search
        ? {
            OR: [
              { donorName: { contains: filter.search, mode: 'insensitive' } },
              { receiptNo: { contains: filter.search, mode: 'insensitive' } },
              { purpose: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  async findMany(
    schoolId: string,
    filter: DonationFilter,
    page: number,
    limit: number,
  ): Promise<{ rows: Donation[]; total: number }> {
    const where = this.where(schoolId, filter);
    const [rows, total] = await Promise.all([
      this.prisma.donation.findMany({
        where,
        orderBy: [{ receivedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.donation.count({ where }),
    ]);
    return { rows, total };
  }

  async findAllFor(
    schoolId: string,
    filter: DonationFilter,
  ): Promise<Donation[]> {
    return this.prisma.donation.findMany({
      where: this.where(schoolId, filter),
      orderBy: [{ receivedAt: 'asc' }],
    });
  }

  async findDetail(id: string, schoolId: string): Promise<Donation | null> {
    return this.prisma.donation.findFirst({
      where: { id, schoolId, deletedAt: null },
    });
  }

  async receiptTaken(schoolId: string, receiptNo: string): Promise<boolean> {
    // Not `deleted_at`-scoped, matching `uq_donations_receipt`.
    const found = await this.prisma.donation.findFirst({
      where: { schoolId, receiptNo },
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
