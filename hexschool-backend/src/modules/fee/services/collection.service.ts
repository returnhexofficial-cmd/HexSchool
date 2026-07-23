import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Payment, Prisma } from '@prisma/client';
import {
  InvoiceStatus,
  PaymentStatus,
  UserType,
} from '../../../common/constants';
import { NotificationService } from '../../communication/services/notification.service';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { SequenceService } from '../../sequence/sequence.service';
import { StudentGuardiansRepository } from '../../student/repositories/student-guardians.repository';
import { formatMoney, money } from '../calc/money.util';
import {
  allocatePayment,
  outstanding,
  refundRefusal,
  refundRefusalMessage,
} from '../calc/payment.engine';
import {
  CollectPaymentDto,
  OFFLINE_METHODS,
  RecordPaymentDto,
  RefundPaymentDto,
} from '../dto';
import { InvoicesRepository } from '../repositories/invoices.repository';
import {
  PaymentsRepository,
  PaymentWithRelations,
} from '../repositories/payments.repository';
import { FeeSettingsService } from './fee-settings.service';
import { InvoiceService } from './invoice.service';

export interface CollectionResult {
  payments: PaymentWithRelations[];
  totalCollected: number;
  allocations: Array<{ invoiceNo: string; amount: number; remaining: number }>;
}

/**
 * The collection desk (roadmap M16 §4/§6): taking money offline,
 * refunding it, and the ledger every other module asks about dues.
 *
 * The rules that shape it:
 *
 *   - **One sum, several invoices.** A guardian pays for two siblings or
 *     three months at once; the engine allocates oldest-due-first, so a
 *     partial payment never leaves the oldest bill accruing while a
 *     newer one is cleared.
 *   - **Overpayment is refused, not absorbed.** Taking more than is owed
 *     needs `fee.overpay` *and* the school setting — otherwise the money
 *     has nowhere to sit and reconciliation quietly breaks.
 *   - **A payment is never edited.** A mistake is corrected by a refund
 *     plus a new payment, which is why `payments` has no soft delete.
 */
@Injectable()
export class CollectionService {
  private readonly logger = new Logger(CollectionService.name);

  constructor(
    private readonly payments: PaymentsRepository,
    private readonly invoices: InvoicesRepository,
    private readonly invoiceService: InvoiceService,
    private readonly sequences: SequenceService,
    private readonly schools: SchoolsRepository,
    private readonly studentGuardians: StudentGuardiansRepository,
    private readonly permissions: PermissionsService,
    private readonly config: FeeSettingsService,
    private readonly auditContext: AuditContextService,
    private readonly notifications: NotificationService,
  ) {}

  // ── read ────────────────────────────────────────────────────────────

  async getPayment(
    id: string,
    schoolId: string,
  ): Promise<PaymentWithRelations> {
    const payment = await this.payments.findById(id, schoolId);
    if (!payment) throw new NotFoundException(`Payment ${id} not found`);
    return payment;
  }

  async listForInvoice(
    invoiceId: string,
    schoolId: string,
  ): Promise<PaymentWithRelations[]> {
    await this.invoiceService.getDetail(invoiceId, schoolId);
    return this.payments.findForInvoice(invoiceId);
  }

  // ── collection ──────────────────────────────────────────────────────

  /** Record one offline payment against a single invoice. */
  async recordPayment(
    invoiceId: string,
    dto: RecordPaymentDto,
    actor: AccessTokenPayload,
  ): Promise<CollectionResult> {
    return this.collect({ ...dto, invoiceIds: [invoiceId] }, actor);
  }

  /**
   * The collection desk: one amount across a basket of invoices.
   *
   * Everything happens in one transaction — the receipt numbers, the
   * payment rows and every invoice's recomputed status — so a crash
   * halfway cannot leave money recorded against a bill that still reads
   * as unpaid.
   */
  async collect(
    dto: CollectPaymentDto,
    actor: AccessTokenPayload,
  ): Promise<CollectionResult> {
    const schoolId = actor.schoolId;
    const config = await this.config.load(schoolId);

    if (!OFFLINE_METHODS.includes(dto.method)) {
      throw new BadRequestException(
        `${dto.method} is an online method — start it through /payments/online/init so it can be verified server-side`,
      );
    }

    const invoices = [];
    for (const id of dto.invoiceIds) {
      const invoice = await this.invoices.findDetail(id, schoolId);
      if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw new ConflictException(
          `${invoice.invoiceNo} is cancelled and cannot take a payment`,
        );
      }
      invoices.push(invoice);
    }

    const basket = invoices.map((invoice) => ({
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      dueDate: isoDate(invoice.dueDate),
      payable: Number(invoice.payable),
      paidTotal: Number(invoice.paidTotal),
    }));

    const totalDue = money(
      basket.reduce((sum, invoice) => sum + outstanding(invoice), 0),
    );
    if (totalDue <= 0) {
      throw new ConflictException('Every selected invoice is already settled');
    }

    const result = allocatePayment(dto.amount, basket);

    // Overpayment is a deliberate act, not a rounding accident.
    if (result.unallocated > 0) {
      if (!config.allowOverpayment) {
        throw new ConflictException(
          `Payment exceeds what is owed by ${formatMoney(result.unallocated)} BDT — the selected invoices total ${formatMoney(totalDue)} BDT`,
        );
      }
      await this.assertPermission(
        actor,
        'fee.overpay',
        'Collecting more than the invoices ask for requires fee.overpay',
      );
    }

    const school = await this.schools.findByIdOrFail(schoolId);
    const paidAt = dto.paidOn ? parseDate(dto.paidOn) : new Date();
    const counterKey = `payment:${paidAt.getUTCFullYear()}${String(
      paidAt.getUTCMonth() + 1,
    ).padStart(2, '0')}`;

    const created: Payment[] = [];

    await this.payments.withTransaction(async (tx) => {
      for (const allocation of result.allocations) {
        const paymentNo = await this.sequences.nextDocumentNumber({
          schoolId,
          counterKey,
          pattern: config.paymentPrefix,
          schoolCode: school.code,
          date: paidAt,
          tx,
        });

        const payment = await this.payments.create(
          {
            schoolId,
            paymentNo,
            invoiceId: allocation.invoiceId,
            amount: allocation.amount,
            method: dto.method,
            // Offline money is verified by the person at the counter,
            // so it lands SUCCESS immediately — unlike an online
            // payment, which stays PENDING until the gateway confirms.
            status: PaymentStatus.SUCCESS,
            reference: dto.reference ?? null,
            remarks: dto.remarks ?? null,
            receivedBy: actor.sub,
            paidAt,
            createdBy: actor.sub,
            updatedBy: actor.sub,
          },
          tx,
        );
        created.push(payment);

        await this.settle(allocation.invoiceId, tx);
      }
    });

    this.auditContext.set({
      entityType: 'Payment',
      entityId: created[0]?.id ?? dto.invoiceIds[0],
      newValues: {
        action: 'COLLECT',
        method: dto.method,
        amount: dto.amount,
        allocated: result.totalAllocated,
        unallocated: result.unallocated,
        invoices: result.allocations.map((a) => a.invoiceNo),
      },
    });

    const detailed: PaymentWithRelations[] = [];
    for (const payment of created) {
      const row = await this.payments.findById(payment.id, schoolId);
      if (row) detailed.push(row);
    }

    if (config.receiptSmsEnabled) {
      await this.queueReceiptSms(detailed, school.name);
    }

    return {
      payments: detailed,
      totalCollected: result.totalAllocated,
      allocations: result.allocations.map((a) => ({
        invoiceNo: a.invoiceNo,
        amount: a.amount,
        remaining: a.remaining,
      })),
    };
  }

  /**
   * Refund a payment, wholly or in part. The payment row stays exactly
   * as it was — the refund is a second, append-only record, because the
   * ledger has to keep both sides.
   */
  async refund(
    paymentId: string,
    dto: RefundPaymentDto,
    actor: AccessTokenPayload,
  ): Promise<PaymentWithRelations> {
    const schoolId = actor.schoolId;
    const payment = await this.getPayment(paymentId, schoolId);

    if (payment.status !== PaymentStatus.SUCCESS) {
      throw new ConflictException(
        `Only a SUCCESS payment can be refunded — this one is ${payment.status}`,
      );
    }

    // A head marked non-refundable (an admission fee, typically) refuses
    // outright. The invoice's lines say which heads it covered.
    const invoice = await this.invoices.findDetail(payment.invoiceId, schoolId);
    const nonRefundable = await this.hasNonRefundableHead(invoice);

    const refundedSoFar = await this.payments.refundedForPayment(paymentId);
    const refusal = refundRefusal({
      paymentAmount: Number(payment.amount),
      refundedSoFar,
      requested: dto.amount,
      isRefundable: !nonRefundable,
    });
    if (refusal) {
      throw new ConflictException(
        refundRefusalMessage(refusal, {
          paymentAmount: Number(payment.amount),
          refundedSoFar,
          requested: dto.amount,
          isRefundable: !nonRefundable,
        }),
      );
    }

    await this.payments.withTransaction(async (tx) => {
      await this.payments.createRefund(
        {
          schoolId,
          paymentId,
          amount: money(dto.amount),
          reason: dto.reason.trim(),
          approvedBy: actor.sub,
        },
        tx,
      );

      // Fully refunded ⇒ the payment itself is REFUNDED; a partial
      // refund leaves it SUCCESS with the balance still credited.
      const totalRefunded = money(refundedSoFar + dto.amount);
      if (totalRefunded >= Number(payment.amount)) {
        await this.payments.update(
          paymentId,
          { status: PaymentStatus.REFUNDED, updatedBy: actor.sub },
          tx,
        );
      }

      await this.settle(payment.invoiceId, tx);
    });

    this.auditContext.set({
      entityType: 'Payment',
      entityId: paymentId,
      oldValues: { status: payment.status, amount: Number(payment.amount) },
      newValues: {
        action: 'REFUND',
        amount: dto.amount,
        reason: dto.reason,
      },
    });

    return this.getPayment(paymentId, schoolId);
  }

  /**
   * Recompute an invoice's paid total and status from its payments and
   * refunds. Every money path calls this, so a refund and a payment can
   * never disagree about what the invoice is worth.
   */
  async settle(
    invoiceId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const [successful, refunded] = await Promise.all([
      this.payments.sumSuccessful(invoiceId, tx),
      this.payments.sumRefunded(invoiceId, tx),
    ]);
    const net = money(successful - refunded);

    const invoice = await this.invoices.findForSettle(invoiceId);
    if (!invoice) return;

    await this.invoiceService.refreshStatus(
      invoice,
      net,
      successful > 0 && net <= 0,
      tx,
    );
  }

  // ── internals ───────────────────────────────────────────────────────

  private async hasNonRefundableHead(
    invoice: Awaited<ReturnType<InvoicesRepository['findDetail']>>,
  ): Promise<boolean> {
    if (!invoice) return false;
    const headIds = invoice.items
      .map((item) => item.feeHeadId)
      .filter((id): id is string => id !== null);
    if (headIds.length === 0) return false;

    const heads = await this.invoices.findFeeHeads(headIds);
    return heads.some((head) => !head.isRefundable);
  }

  /**
   * Receipt SMS — never awaited inline (the M07 rule: delivery must never
   * delay or fail the mutation). **Retro-wired to M17**: sends through
   * `NotificationService.send` with the `FEE_RECEIPT` template, so the
   * body is admin-editable and the send is credit-accounted and logged.
   */
  private async queueReceiptSms(
    payments: PaymentWithRelations[],
    schoolName: string,
  ): Promise<void> {
    const studentIds = payments
      .map((p) => p.invoice.enrollment.student.id)
      .filter(Boolean);
    if (studentIds.length === 0) return;

    const primaries =
      await this.studentGuardians.findPrimaryForStudents(studentIds);
    const phoneByStudent = new Map(
      primaries.map((link) => [link.studentId, link.guardian.phone]),
    );

    for (const payment of payments) {
      const student = payment.invoice.enrollment.student;
      const phone = phoneByStudent.get(student.id);
      if (!phone) continue;

      const balance = money(
        Number(payment.invoice.payable) - Number(payment.invoice.paidTotal),
      );
      await this.notifications
        .send({
          schoolId: payment.schoolId,
          code: 'FEE_RECEIPT',
          channel: 'SMS',
          recipient: { type: 'GUARDIAN', destination: phone },
          vars: {
            school: schoolName,
            student_name: `${student.firstName} ${student.lastName}`.trim(),
            amount: formatMoney(Number(payment.amount)),
            invoice: payment.invoice.invoiceNo,
            balance: formatMoney(balance),
          },
        })
        .catch((error: Error) =>
          this.logger.warn(`Could not queue receipt SMS: ${error.message}`),
        );
    }
  }

  private async assertPermission(
    actor: AccessTokenPayload,
    code: string,
    message: string,
  ): Promise<void> {
    if (actor.userType === UserType.SUPER_ADMIN) return;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    if (!codes.includes(code)) throw new ForbiddenException(message);
  }
}
