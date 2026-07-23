import { Injectable } from '@nestjs/common';
import {
  Payment,
  PaymentMethod,
  PaymentRefund,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const RELATIONS = {
  refunds: { orderBy: { refundedAt: 'desc' } },
  invoice: {
    select: {
      id: true,
      invoiceNo: true,
      payable: true,
      paidTotal: true,
      status: true,
      enrollmentId: true,
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
          class: { select: { id: true, name: true } },
          section: { select: { id: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.PaymentInclude;

export type PaymentWithRelations = Prisma.PaymentGetPayload<{
  include: typeof RELATIONS;
}>;

/**
 * Payments and refunds. No soft delete: a mistake is corrected by a
 * refund plus a new payment, never by removing the record (roadmap M16
 * §6 — receipts are immutable).
 */
@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(
    id: string,
    schoolId: string,
  ): Promise<PaymentWithRelations | null> {
    return this.prisma.payment.findFirst({
      where: { id, schoolId },
      include: RELATIONS,
    });
  }

  async findForInvoice(invoiceId: string): Promise<PaymentWithRelations[]> {
    return this.prisma.payment.findMany({
      where: { invoiceId },
      include: RELATIONS,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * The IPN idempotency lookup. `uq_payments_gateway_txn` guarantees at
   * most one row, so a retried callback finds the original rather than
   * creating a second credit.
   */
  async findByGatewayTxn(txnId: string): Promise<PaymentWithRelations | null> {
    return this.prisma.payment.findFirst({
      where: { gatewayTxnId: txnId },
      include: RELATIONS,
    });
  }

  async findByGatewayRef(ref: string): Promise<PaymentWithRelations | null> {
    return this.prisma.payment.findFirst({
      where: { gatewayRef: ref },
      include: RELATIONS,
    });
  }

  /**
   * Every payment sharing one gateway session. A multi-invoice checkout
   * (siblings, or three months at once) opens ONE session and writes one
   * PENDING row per invoice, so a callback settles them together.
   */
  async findAllByGatewayRef(ref: string): Promise<PaymentWithRelations[]> {
    return this.prisma.payment.findMany({
      where: { gatewayRef: ref },
      include: RELATIONS,
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Online payments left PENDING — the user closed the bKash app before
   * the callback fired. The reconciliation job asks the gateway what
   * really happened (roadmap M16 §8).
   */
  async findStalePending(
    schoolId: string,
    olderThan: Date,
    take = 200,
  ): Promise<Payment[]> {
    return this.prisma.payment.findMany({
      where: {
        schoolId,
        status: PaymentStatus.PENDING,
        createdAt: { lt: olderThan },
        gatewayRef: { not: null },
      },
      take,
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Successful collections in a window — the daily/monthly reports. */
  async findCollections(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<PaymentWithRelations[]> {
    return this.prisma.payment.findMany({
      where: {
        schoolId,
        status: PaymentStatus.SUCCESS,
        paidAt: { gte: from, lte: to },
      },
      include: RELATIONS,
      orderBy: { paidAt: 'asc' },
    });
  }

  async sumByMethod(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ method: PaymentMethod; amount: number; count: number }>> {
    const rows = await this.prisma.payment.groupBy({
      by: ['method'],
      where: {
        schoolId,
        status: PaymentStatus.SUCCESS,
        paidAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return rows.map((row) => ({
      method: row.method,
      amount: Number(row._sum.amount ?? 0),
      count: row._count._all,
    }));
  }

  /** Successful, not-fully-refunded money against one invoice. */
  async sumSuccessful(invoiceId: string, tx?: PrismaClientLike): Promise<number> {
    const client = (tx ?? this.prisma) as PrismaService;
    const result = await client.payment.aggregate({
      where: { invoiceId, status: PaymentStatus.SUCCESS },
      _sum: { amount: true },
    });
    return Number(result._sum.amount ?? 0);
  }

  async sumRefunded(invoiceId: string, tx?: PrismaClientLike): Promise<number> {
    const client = (tx ?? this.prisma) as PrismaService;
    const result = await client.paymentRefund.aggregate({
      where: { payment: { invoiceId } },
      _sum: { amount: true },
    });
    return Number(result._sum.amount ?? 0);
  }

  async refundedForPayment(
    paymentId: string,
    tx?: PrismaClientLike,
  ): Promise<number> {
    const client = (tx ?? this.prisma) as PrismaService;
    const result = await client.paymentRefund.aggregate({
      where: { paymentId },
      _sum: { amount: true },
    });
    return Number(result._sum.amount ?? 0);
  }

  async create(
    data: Prisma.PaymentUncheckedCreateInput,
    tx?: PrismaClientLike,
  ): Promise<Payment> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.payment.create({ data });
  }

  async update(
    id: string,
    data: Prisma.PaymentUncheckedUpdateInput,
    tx?: PrismaClientLike,
  ): Promise<Payment> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.payment.update({ where: { id }, data });
  }

  async createRefund(
    data: Prisma.PaymentRefundUncheckedCreateInput,
    tx?: PrismaClientLike,
  ): Promise<PaymentRefund> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.paymentRefund.create({ data });
  }

  async withTransaction<R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
  ): Promise<R> {
    return this.prisma.$transaction(fn);
  }
}
