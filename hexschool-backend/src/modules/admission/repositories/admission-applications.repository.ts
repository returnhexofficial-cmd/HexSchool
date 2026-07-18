import { Injectable } from '@nestjs/common';
import { AdmissionApplication, Prisma } from '@prisma/client';
import {
  AdmissionApplicationStatus,
  AdmissionPaymentStatus,
} from '../../../common/constants';
import { BaseRepository } from '../../../common/database/base.repository';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../common/dto/paginated.dto';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { ApplicationQueryDto } from '../dto';

const LIST_INCLUDE = {
  class: { select: { id: true, name: true, numericLevel: true } },
  cycle: {
    select: { id: true, name: true, testRequired: true, status: true },
  },
  student: { select: { id: true, studentUid: true } },
} satisfies Prisma.AdmissionApplicationInclude;

export type ApplicationWithRelations = Prisma.AdmissionApplicationGetPayload<{
  include: typeof LIST_INCLUDE;
}>;

/** Statuses a live (blocking-duplicate) application can be in — mirrors
 *  the partial unique index predicate in the M10 migration. */
export const LIVE_STATUSES: AdmissionApplicationStatus[] = Object.values(
  AdmissionApplicationStatus,
).filter(
  (s) =>
    s !== AdmissionApplicationStatus.CANCELLED &&
    s !== AdmissionApplicationStatus.REJECTED &&
    s !== AdmissionApplicationStatus.EXPIRED,
);

@Injectable()
export class AdmissionApplicationsRepository extends BaseRepository<
  AdmissionApplication,
  Prisma.AdmissionApplicationWhereInput,
  Prisma.AdmissionApplicationUncheckedCreateInput,
  Prisma.AdmissionApplicationUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(
      prisma,
      (client) => client.admissionApplication,
      'AdmissionApplication',
    );
  }

  async paginateList(
    query: ApplicationQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<ApplicationWithRelations>> {
    const { page, limit } = query;
    const where: Prisma.AdmissionApplicationWhereInput = {
      schoolId,
      deletedAt: null,
      ...(query.cycleId ? { cycleId: query.cycleId } : {}),
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { nameBn: { contains: query.search, mode: 'insensitive' } },
              {
                applicationNo: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.admissionApplication.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.admissionApplication.count({ where }),
    ]);
    return { data: items, meta: buildPaginationMeta(page, limit, total) };
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<ApplicationWithRelations | null> {
    return this.prisma.admissionApplication.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: LIST_INCLUDE,
    });
  }

  /** Public tracking lookup — both keys must match (no enumeration). */
  async findByAppNoAndPhone(
    applicationNo: string,
    phone: string,
    schoolId: string,
  ): Promise<ApplicationWithRelations | null> {
    return this.prisma.admissionApplication.findFirst({
      where: { schoolId, applicationNo, phone, deletedAt: null },
      include: LIST_INCLUDE,
    });
  }

  /** Duplicate probe (roadmap M10 §6): live application for the same
   *  cycle+class+phone+dob (DB partial unique backs this up). */
  async findLiveDuplicate(params: {
    cycleId: string;
    classId?: string;
    phone: string;
    dob: Date;
  }): Promise<AdmissionApplication | null> {
    return this.prisma.admissionApplication.findFirst({
      where: {
        cycleId: params.cycleId,
        ...(params.classId ? { classId: params.classId } : {}),
        phone: params.phone,
        dob: params.dob,
        deletedAt: null,
        status: { in: LIVE_STATUSES },
      },
    });
  }

  /** Ordered candidate pool for merit generation. Ordering here is only
   *  a stable fetch order — the real ranking runs in MeritListService. */
  async findForMerit(
    cycleId: string,
    classId: string,
    statuses: AdmissionApplicationStatus[],
  ): Promise<AdmissionApplication[]> {
    return this.prisma.admissionApplication.findMany({
      where: {
        cycleId,
        classId,
        deletedAt: null,
        status: { in: statuses },
        paymentStatus: {
          in: [AdmissionPaymentStatus.PAID, AdmissionPaymentStatus.WAIVED],
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findMeritList(
    cycleId: string,
    classId: string,
    statuses: AdmissionApplicationStatus[],
  ): Promise<ApplicationWithRelations[]> {
    return this.prisma.admissionApplication.findMany({
      where: { cycleId, classId, deletedAt: null, status: { in: statuses } },
      include: LIST_INCLUDE,
      orderBy: [{ meritPosition: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Next waitlisted candidates by merit position (promotion order). */
  async findNextWaitlisted(
    cycleId: string,
    classId: string,
    take: number,
  ): Promise<AdmissionApplication[]> {
    return this.prisma.admissionApplication.findMany({
      where: {
        cycleId,
        classId,
        deletedAt: null,
        status: AdmissionApplicationStatus.WAITLISTED,
      },
      orderBy: { meritPosition: 'asc' },
      take,
    });
  }

  /** SELECTED applications whose admission deadline has passed. */
  async findExpiredSelections(now: Date): Promise<AdmissionApplication[]> {
    return this.prisma.admissionApplication.findMany({
      where: {
        deletedAt: null,
        status: AdmissionApplicationStatus.SELECTED,
        admissionDeadline: { lt: now },
      },
    });
  }

  /** Funnel counts per status (reports). */
  async countByStatus(
    schoolId: string,
    cycleId?: string,
  ): Promise<Array<{ status: AdmissionApplicationStatus; count: number }>> {
    const rows = await this.prisma.admissionApplication.groupBy({
      by: ['status'],
      where: { schoolId, deletedAt: null, ...(cycleId ? { cycleId } : {}) },
      _count: { _all: true },
    });
    return rows.map((r) => ({ status: r.status, count: r._count._all }));
  }

  /** Per-class funnel + fee totals for the report summary. */
  async classBreakdown(
    schoolId: string,
    cycleId: string,
  ): Promise<
    Array<{
      classId: string;
      status: AdmissionApplicationStatus;
      count: number;
      paidAmount: number;
    }>
  > {
    const rows = await this.prisma.admissionApplication.groupBy({
      by: ['classId', 'status'],
      where: { schoolId, cycleId, deletedAt: null },
      _count: { _all: true },
      _sum: { paidAmount: true },
    });
    return rows.map((r) => ({
      classId: r.classId,
      status: r.status,
      count: r._count._all,
      paidAmount: Number(r._sum.paidAmount ?? 0),
    }));
  }

  async countAdmitted(cycleId: string, classId: string): Promise<number> {
    return this.prisma.admissionApplication.count({
      where: {
        cycleId,
        classId,
        deletedAt: null,
        status: AdmissionApplicationStatus.ADMITTED,
      },
    });
  }

  /** Unpaid pending applications of a cycle (auto-cancel on close). */
  async findUnpaidPending(cycleId: string): Promise<AdmissionApplication[]> {
    return this.prisma.admissionApplication.findMany({
      where: {
        cycleId,
        deletedAt: null,
        status: AdmissionApplicationStatus.PAYMENT_PENDING,
        paymentStatus: AdmissionPaymentStatus.UNPAID,
      },
    });
  }
}
