import { Injectable } from '@nestjs/common';
import { Invoice, InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const RELATIONS = {
  items: { orderBy: { createdAt: 'asc' } },
  enrollment: {
    select: {
      id: true,
      rollNo: true,
      classId: true,
      sectionId: true,
      enrollmentDate: true,
      student: {
        select: {
          id: true,
          studentUid: true,
          firstName: true,
          lastName: true,
        },
      },
      class: { select: { id: true, name: true, numericLevel: true } },
      section: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.InvoiceInclude;

export type InvoiceWithRelations = Prisma.InvoiceGetPayload<{
  include: typeof RELATIONS;
}>;

const WITH_PAYMENTS = {
  ...RELATIONS,
  payments: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.InvoiceInclude;

export type InvoiceDetail = Prisma.InvoiceGetPayload<{
  include: typeof WITH_PAYMENTS;
}>;

export interface InvoiceFilter {
  sessionId?: string;
  classId?: string;
  sectionId?: string;
  enrollmentId?: string;
  status?: InvoiceStatus;
  billingMonth?: Date;
  search?: string;
  overdueOnly?: boolean;
}

/** Live statuses — a cancelled bill is not a due. */
const OUTSTANDING: InvoiceStatus[] = [
  InvoiceStatus.UNPAID,
  InvoiceStatus.PARTIAL,
  InvoiceStatus.OVERDUE,
];

@Injectable()
export class InvoicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private where(schoolId: string, filter: InvoiceFilter): Prisma.InvoiceWhereInput {
    return {
      schoolId,
      deletedAt: null,
      ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.overdueOnly ? { status: { in: OUTSTANDING } } : {}),
      ...(filter.billingMonth ? { billingMonth: filter.billingMonth } : {}),
      ...(filter.enrollmentId ? { enrollmentId: filter.enrollmentId } : {}),
      enrollment: {
        ...(filter.classId ? { classId: filter.classId } : {}),
        ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
        ...(filter.search
          ? {
              student: {
                OR: [
                  { firstName: { contains: filter.search, mode: 'insensitive' } },
                  { lastName: { contains: filter.search, mode: 'insensitive' } },
                  { studentUid: { contains: filter.search, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
    };
  }

  async findMany(
    schoolId: string,
    filter: InvoiceFilter,
    take = 500,
  ): Promise<InvoiceWithRelations[]> {
    return this.prisma.invoice.findMany({
      where: this.where(schoolId, filter),
      include: RELATIONS,
      orderBy: [{ dueDate: 'asc' }, { invoiceNo: 'asc' }],
      take,
    });
  }

  async findDetail(id: string, schoolId: string): Promise<InvoiceDetail | null> {
    return this.prisma.invoice.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: WITH_PAYMENTS,
    });
  }

  /**
   * By id alone, for the settle path — it is reached from a payment that
   * has already been school-scoped, and re-scoping would mean threading
   * the schoolId through every internal call for no extra safety.
   */
  async findForSettle(id: string): Promise<InvoiceDetail | null> {
    return this.prisma.invoice.findFirst({
      where: { id, deletedAt: null },
      include: WITH_PAYMENTS,
    });
  }

  /** Refundability of the heads an invoice billed. */
  async findFeeHeads(
    ids: string[],
  ): Promise<Array<{ id: string; name: string; isRefundable: boolean }>> {
    if (ids.length === 0) return [];
    return this.prisma.feeHead.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, isRefundable: true },
    });
  }

  async findByNo(
    invoiceNo: string,
    schoolId: string,
  ): Promise<InvoiceDetail | null> {
    return this.prisma.invoice.findFirst({
      where: { invoiceNo, schoolId, deletedAt: null },
      include: WITH_PAYMENTS,
    });
  }

  /** Everything still owed by one candidate — the collection desk's basket. */
  async findOutstanding(
    enrollmentIds: string[],
    schoolId: string,
  ): Promise<InvoiceWithRelations[]> {
    if (enrollmentIds.length === 0) return [];
    return this.prisma.invoice.findMany({
      where: {
        schoolId,
        deletedAt: null,
        enrollmentId: { in: enrollmentIds },
        status: { in: OUTSTANDING },
      },
      include: RELATIONS,
      orderBy: [{ dueDate: 'asc' }],
    });
  }

  /**
   * Total outstanding per enrollment — what `EXAM_DUES_GATE` and the
   * clearance service ask. One grouped query, not N.
   */
  async outstandingByEnrollment(
    enrollmentIds: string[],
    schoolId: string,
  ): Promise<Map<string, number>> {
    if (enrollmentIds.length === 0) return new Map();
    const rows = await this.prisma.invoice.groupBy({
      by: ['enrollmentId'],
      where: {
        schoolId,
        deletedAt: null,
        enrollmentId: { in: enrollmentIds },
        status: { in: OUTSTANDING },
      },
      _sum: { payable: true, paidTotal: true },
    });

    return new Map(
      rows.map((row) => [
        row.enrollmentId,
        Number(row._sum.payable ?? 0) - Number(row._sum.paidTotal ?? 0),
      ]),
    );
  }

  /** Idempotency probe for the monthly batch. */
  async existsForMonth(
    enrollmentId: string,
    billingMonth: Date,
    tx?: PrismaClientLike,
  ): Promise<boolean> {
    const client = (tx ?? this.prisma) as PrismaService;
    const found = await client.invoice.findFirst({
      where: {
        enrollmentId,
        billingMonth,
        deletedAt: null,
        status: { not: InvoiceStatus.CANCELLED },
      },
      select: { id: true },
    });
    return found !== null;
  }

  /** Invoices the nightly fine job should look at. */
  async findFinable(
    schoolId: string,
    onOrBefore: Date,
    take = 1000,
  ): Promise<Invoice[]> {
    return this.prisma.invoice.findMany({
      where: {
        schoolId,
        deletedAt: null,
        status: { in: OUTSTANDING },
        dueDate: { lt: onOrBefore },
      },
      take,
    });
  }

  async create(
    data: Prisma.InvoiceUncheckedCreateInput,
    items: Prisma.InvoiceItemUncheckedCreateInput[],
    tx?: PrismaClientLike,
  ): Promise<Invoice> {
    const client = (tx ?? this.prisma) as PrismaService;
    const invoice = await client.invoice.create({ data });
    if (items.length > 0) {
      await client.invoiceItem.createMany({
        data: items.map((item) => ({ ...item, invoiceId: invoice.id })),
      });
    }
    return invoice;
  }

  async update(
    id: string,
    data: Prisma.InvoiceUncheckedUpdateInput,
    tx?: PrismaClientLike,
  ): Promise<Invoice> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.invoice.update({ where: { id }, data });
  }

  async countForSession(schoolId: string, sessionId: string): Promise<number> {
    return this.prisma.invoice.count({
      where: { schoolId, sessionId, deletedAt: null },
    });
  }

  async countByStatus(
    schoolId: string,
    sessionId: string,
  ): Promise<Array<{ status: InvoiceStatus; count: number; payable: number }>> {
    const rows = await this.prisma.invoice.groupBy({
      by: ['status'],
      where: { schoolId, sessionId, deletedAt: null },
      _count: { _all: true },
      _sum: { payable: true },
    });
    return rows.map((row) => ({
      status: row.status,
      count: row._count._all,
      payable: Number(row._sum.payable ?? 0),
    }));
  }

  async withTransaction<R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
  ): Promise<R> {
    return this.prisma.$transaction(fn);
  }
}
