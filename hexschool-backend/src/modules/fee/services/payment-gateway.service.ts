import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../../common/constants';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { SettingsService } from '../../school/services/settings.service';
import { SequenceService } from '../../sequence/sequence.service';
import { equalMoney, money } from '../calc/money.util';
import { allocatePayment, outstanding } from '../calc/payment.engine';
import {
  GatewayCredentials,
  PaymentGatewayAdapter,
} from '../gateways/gateway.interface';
import { BkashAdapter } from '../gateways/bkash.adapter';
import { NagadAdapter } from '../gateways/nagad.adapter';
import { SslcommerzAdapter } from '../gateways/sslcommerz.adapter';
import { InitOnlinePaymentDto, OnlineGateway } from '../dto';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { PaymentsRepository } from '../repositories/payments.repository';
import { CollectionService } from './collection.service';
import { FeeSettingsService } from './fee-settings.service';

export interface InitiatedPayment {
  checkoutUrl: string;
  gatewayRef: string;
  reference: string;
  amount: number;
  paymentIds: string[];
}

export interface CallbackOutcome {
  status: PaymentStatus;
  paymentIds: string[];
  amount: number;
  message: string;
}

const METHOD_BY_GATEWAY: Record<OnlineGateway, PaymentMethod> = {
  SSLCOMMERZ: PaymentMethod.SSLCOMMERZ,
  BKASH: PaymentMethod.BKASH,
  NAGAD: PaymentMethod.NAGAD,
};

/**
 * Online payments (roadmap M16 §4/§6/§8).
 *
 * The three rules this service exists to enforce:
 *
 *   1. **A payment is SUCCESS only after a server-side verification API
 *      says so.** The browser's redirect carries forgeable parameters,
 *      so `parseCallback` yields a *hint* about which payment to check
 *      and `verify()` decides. Nothing else may write SUCCESS.
 *   2. **Callbacks are idempotent.** A gateway that retries its IPN — or
 *      fires it while the payer also lands on the return URL — must not
 *      double-credit. `uq_payments_gateway_txn` makes the txn id
 *      singular, and an already-verified payment short-circuits.
 *   3. **A lost callback is not a lost payment.** The payer closing the
 *      bKash app leaves the row PENDING; the reconciliation job asks the
 *      gateway what happened and settles it later.
 *
 * A multi-invoice checkout (siblings, or three months) opens ONE gateway
 * session and writes one PENDING payment per invoice, sharing a
 * reference — so the money is allocated correctly the moment it clears.
 */
@Injectable()
export class PaymentGatewayService {
  private readonly logger = new Logger(PaymentGatewayService.name);
  private readonly adapters: Map<string, PaymentGatewayAdapter>;

  constructor(
    private readonly payments: PaymentsRepository,
    private readonly invoices: InvoicesRepository,
    private readonly collection: CollectionService,
    private readonly sequences: SequenceService,
    private readonly schools: SchoolsRepository,
    private readonly settings: SettingsService,
    private readonly config: FeeSettingsService,
    private readonly auditContext: AuditContextService,
    sslcommerz: SslcommerzAdapter,
    bkash: BkashAdapter,
    nagad: NagadAdapter,
  ) {
    this.adapters = new Map<string, PaymentGatewayAdapter>([
      [sslcommerz.name, sslcommerz],
      [bkash.name, bkash],
      [nagad.name, nagad],
    ]);
  }

  adapterFor(gateway: string): PaymentGatewayAdapter {
    const adapter = this.adapters.get(gateway.toUpperCase());
    if (!adapter) {
      throw new BadRequestException(`Unknown payment gateway "${gateway}"`);
    }
    return adapter;
  }

  /** Per-school gateway credentials — encrypted at rest since M04. */
  async credentialsFor(
    gateway: string,
    schoolId: string,
  ): Promise<GatewayCredentials> {
    const config = await this.config.load(schoolId);
    const get = (key: string) => this.settings.getValue<string>(schoolId, key);

    switch (gateway.toUpperCase()) {
      case 'SSLCOMMERZ':
        return {
          sandbox: config.sandbox,
          storeId: await get('payment.sslcommerz_store_id'),
          storePassword: await get('payment.sslcommerz_store_pass'),
        };
      case 'BKASH':
        return {
          sandbox: config.sandbox,
          appKey: await get('payment.bkash_app_key'),
          appSecret: await get('payment.bkash_app_secret'),
          storeId: await get('payment.bkash_username'),
          storePassword: await get('payment.bkash_password'),
        };
      case 'NAGAD':
        return {
          sandbox: config.sandbox,
          merchantId: await get('payment.nagad_merchant_id'),
        };
      default:
        throw new BadRequestException(`Unknown payment gateway "${gateway}"`);
    }
  }

  // ── generic sessions (used by the invoice path and by M10) ─────────

  /**
   * Open a checkout session for an arbitrary charge.
   *
   * Module 10's admission fee has no enrollment and therefore no
   * invoice — `payments.invoice_id` is NOT NULL by design, and making it
   * nullable to accommodate applicants would weaken the model for every
   * other row. So an applicant pays through exactly these adapters and
   * the verified outcome lands on `admission_applications`' own
   * `payment_ref` / `payment_method` / `paid_at` columns, which is what
   * M10 reserved them for.
   */
  async openSession(
    gateway: string,
    schoolId: string,
    charge: {
      reference: string;
      amount: number;
      customerName: string;
      customerPhone?: string;
      baseUrl: string;
      callbackPath?: string;
    },
  ): Promise<{ checkoutUrl: string; gatewayRef: string }> {
    const adapter = this.adapterFor(gateway);
    const credentials = await this.credentialsFor(gateway, schoolId);
    if (!adapter.isConfigured(credentials)) {
      throw new ConflictException(
        `${gateway} is not configured — set its credentials in Settings → Payment`,
      );
    }

    const callback =
      charge.callbackPath ??
      `/payments/callback/${gateway.toLowerCase()}`;
    const url = `${charge.baseUrl}${callback}`;

    return adapter.init(
      {
        reference: charge.reference,
        amount: charge.amount,
        currency: 'BDT',
        customerName: charge.customerName,
        customerPhone: charge.customerPhone,
        successUrl: url,
        failUrl: url,
        cancelUrl: url,
        ipnUrl: url,
      },
      credentials,
    );
  }

  /**
   * Ask a gateway what happened to a session. The only thing that may
   * conclude SUCCESS, wherever the charge is recorded.
   */
  async verifySession(
    gateway: string,
    schoolId: string,
    body: Record<string, unknown>,
  ): Promise<{
    outcome: string;
    transactionId?: string;
    amount?: number;
    reference?: string;
    raw: Record<string, unknown>;
  }> {
    const adapter = this.adapterFor(gateway);
    const credentials = await this.credentialsFor(gateway, schoolId);
    const hint = adapter.parseCallback(body);
    const verdict = await adapter.verify(hint, credentials);
    return { ...verdict, reference: hint.reference };
  }

  // ── init ────────────────────────────────────────────────────────────

  async initiate(
    dto: InitOnlinePaymentDto,
    actor: AccessTokenPayload,
    baseUrl: string,
  ): Promise<InitiatedPayment> {
    const schoolId = actor.schoolId;
    const adapter = this.adapterFor(dto.gateway);
    const credentials = await this.credentialsFor(dto.gateway, schoolId);

    if (!adapter.isConfigured(credentials)) {
      throw new ConflictException(
        `${dto.gateway} is not configured — set its credentials in Settings → Payment`,
      );
    }

    const invoices = [];
    for (const id of dto.invoiceIds) {
      const invoice = await this.invoices.findDetail(id, schoolId);
      if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw new ConflictException(`${invoice.invoiceNo} is cancelled`);
      }
      invoices.push(invoice);
    }

    const basket = invoices.map((invoice) => ({
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      dueDate: invoice.dueDate.toISOString().slice(0, 10),
      payable: Number(invoice.payable),
      paidTotal: Number(invoice.paidTotal),
    }));
    const total = money(basket.reduce((sum, i) => sum + outstanding(i), 0));
    if (total <= 0) {
      throw new ConflictException('Every selected invoice is already settled');
    }

    const school = await this.schools.findByIdOrFail(schoolId);
    const settingsConfig = await this.config.load(schoolId);
    const now = new Date();
    const reference = await this.sequences.nextDocumentNumber({
      schoolId,
      counterKey: `payment:${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
      pattern: settingsConfig.paymentPrefix,
      schoolCode: school.code,
      date: now,
    });

    const session = await adapter.init(
      {
        reference,
        amount: total,
        currency: 'BDT',
        customerName:
          `${invoices[0].enrollment.student.firstName} ${invoices[0].enrollment.student.lastName}`.trim(),
        successUrl: `${baseUrl}/payments/callback/${dto.gateway.toLowerCase()}`,
        failUrl: `${baseUrl}/payments/callback/${dto.gateway.toLowerCase()}`,
        cancelUrl: `${baseUrl}/payments/callback/${dto.gateway.toLowerCase()}`,
        ipnUrl: `${baseUrl}/payments/callback/${dto.gateway.toLowerCase()}`,
      },
      credentials,
    );

    // One PENDING row per invoice, sharing the gateway session, so the
    // money lands on the right bills the moment it is verified.
    const allocation = allocatePayment(total, basket);
    const paymentIds: string[] = [];

    await this.payments.withTransaction(async (tx) => {
      for (const part of allocation.allocations) {
        const payment = await this.payments.create(
          {
            schoolId,
            // The receipt number is the shared reference plus the
            // invoice, so a multi-invoice checkout stays traceable.
            paymentNo: `${reference}-${part.invoiceNo.slice(-4)}`,
            invoiceId: part.invoiceId,
            amount: part.amount,
            method: METHOD_BY_GATEWAY[dto.gateway],
            status: PaymentStatus.PENDING,
            gatewayRef: session.gatewayRef,
            reference,
            createdBy: actor.sub,
            updatedBy: actor.sub,
          },
          tx,
        );
        paymentIds.push(payment.id);
      }
    });

    this.auditContext.set({
      entityType: 'Payment',
      entityId: paymentIds[0] ?? reference,
      newValues: {
        action: 'ONLINE_INIT',
        gateway: dto.gateway,
        reference,
        amount: total,
        invoices: basket.map((b) => b.invoiceNo),
      },
    });

    return {
      checkoutUrl: session.checkoutUrl,
      gatewayRef: session.gatewayRef,
      reference,
      amount: total,
      paymentIds,
    };
  }

  // ── callback ────────────────────────────────────────────────────────

  /**
   * Handle a gateway callback or IPN.
   *
   * Public and unauthenticated by necessity — the gateway calls it — so
   * it trusts nothing in the body beyond "which payment is this about",
   * and asks the gateway itself for the verdict.
   */
  async handleCallback(
    gateway: string,
    body: Record<string, unknown>,
    schoolId: string,
  ): Promise<CallbackOutcome> {
    const adapter = this.adapterFor(gateway);
    const hint = adapter.parseCallback(body);

    const pending = await this.findPendingFor(hint, schoolId);
    if (pending.length === 0) {
      throw new NotFoundException('No pending payment matches that callback');
    }

    // Idempotency: an IPN retry (or the browser redirect racing the
    // server-to-server call) finds the work already done.
    const alreadyVerified = pending.every(
      (payment) => payment.status === PaymentStatus.SUCCESS,
    );
    if (alreadyVerified) {
      return {
        status: PaymentStatus.SUCCESS,
        paymentIds: pending.map((p) => p.id),
        amount: money(pending.reduce((sum, p) => sum + Number(p.amount), 0)),
        message: 'Already verified',
      };
    }

    const credentials = await this.credentialsFor(gateway, schoolId);
    const verdict = await adapter.verify(hint, credentials);

    const expected = money(
      pending.reduce((sum, payment) => sum + Number(payment.amount), 0),
    );

    // The gateway's own figure must match what we asked for. A mismatch
    // is not a rounding quibble — it means the session was tampered with
    // or reused, so it is refused rather than credited.
    if (
      verdict.outcome === 'SUCCESS' &&
      verdict.amount !== undefined &&
      !equalMoney(verdict.amount, expected)
    ) {
      this.logger.error(
        `${gateway} reported ${verdict.amount} for ${expected} — refusing to credit`,
      );
      await this.markAll(pending, PaymentStatus.FAILED, verdict.raw);
      return {
        status: PaymentStatus.FAILED,
        paymentIds: pending.map((p) => p.id),
        amount: expected,
        message: 'Amount mismatch — payment refused',
      };
    }

    const status = this.statusFor(verdict.outcome);
    await this.markAll(pending, status, verdict.raw, verdict.transactionId);

    if (status === PaymentStatus.SUCCESS) {
      for (const invoiceId of new Set(pending.map((p) => p.invoiceId))) {
        await this.collection.settle(invoiceId);
      }
    }

    this.auditContext.set({
      entityType: 'Payment',
      entityId: pending[0].id,
      newValues: {
        action: 'GATEWAY_CALLBACK',
        gateway,
        outcome: verdict.outcome,
        transactionId: verdict.transactionId,
      },
    });

    return {
      status,
      paymentIds: pending.map((p) => p.id),
      amount: expected,
      message: `${gateway} reported ${verdict.outcome}`,
    };
  }

  /**
   * Re-ask the gateway about one payment. Used by the reconciliation job
   * and by the manual "reconcile" button when a payer insists they paid.
   */
  async reconcile(
    paymentId: string,
    schoolId: string,
  ): Promise<CallbackOutcome> {
    const payment = await this.payments.findById(paymentId, schoolId);
    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);
    if (payment.status === PaymentStatus.SUCCESS) {
      return {
        status: PaymentStatus.SUCCESS,
        paymentIds: [payment.id],
        amount: Number(payment.amount),
        message: 'Already settled',
      };
    }

    const gateway = payment.method;
    const adapter = this.adapterFor(gateway);
    const credentials = await this.credentialsFor(gateway, schoolId);

    const verdict = await adapter.verify(
      {
        gatewayRef: payment.gatewayRef ?? undefined,
        transactionId: payment.gatewayTxnId ?? undefined,
        reference: payment.reference ?? undefined,
      },
      credentials,
    );

    const siblings = payment.gatewayRef
      ? await this.pendingByRef(payment.gatewayRef, schoolId)
      : [payment];

    const status = this.statusFor(verdict.outcome);
    await this.markAll(siblings, status, verdict.raw, verdict.transactionId);

    if (status === PaymentStatus.SUCCESS) {
      for (const invoiceId of new Set(siblings.map((p) => p.invoiceId))) {
        await this.collection.settle(invoiceId);
      }
    }

    return {
      status,
      paymentIds: siblings.map((p) => p.id),
      amount: money(siblings.reduce((sum, p) => sum + Number(p.amount), 0)),
      message: `${gateway} reported ${verdict.outcome}`,
    };
  }

  // ── internals ───────────────────────────────────────────────────────

  private statusFor(outcome: string): PaymentStatus {
    switch (outcome) {
      case 'SUCCESS':
        return PaymentStatus.SUCCESS;
      case 'CANCELLED':
        return PaymentStatus.CANCELLED;
      case 'PENDING':
        return PaymentStatus.PENDING;
      default:
        return PaymentStatus.FAILED;
    }
  }

  private async findPendingFor(
    hint: { gatewayRef?: string; reference?: string; transactionId?: string },
    schoolId: string,
  ) {
    if (hint.gatewayRef) {
      const byRef = await this.pendingByRef(hint.gatewayRef, schoolId);
      if (byRef.length > 0) return byRef;
    }
    if (hint.transactionId) {
      const byTxn = await this.payments.findByGatewayTxn(hint.transactionId);
      if (byTxn && byTxn.schoolId === schoolId) return [byTxn];
    }
    return [];
  }

  private async pendingByRef(gatewayRef: string, schoolId: string) {
    const found = await this.payments.findAllByGatewayRef(gatewayRef);
    return found.filter((payment) => payment.schoolId === schoolId);
  }

  private async markAll(
    payments: Array<{ id: string; amount: Prisma.Decimal | number }>,
    status: PaymentStatus,
    raw: Record<string, unknown>,
    transactionId?: string,
  ): Promise<void> {
    await this.payments.withTransaction(async (tx) => {
      for (const [index, payment] of payments.entries()) {
        await this.payments.update(
          payment.id,
          {
            status,
            gatewayPayload: raw as Prisma.InputJsonValue,
            // The txn id is globally unique, so only the first row of a
            // multi-invoice session can carry it verbatim; the rest get
            // it suffixed so the uniqueness holds and the trail is kept.
            ...(transactionId
              ? {
                  gatewayTxnId:
                    index === 0 ? transactionId : `${transactionId}-${index}`,
                }
              : {}),
            ...(status === PaymentStatus.SUCCESS
              ? { paidAt: new Date(), verifiedAt: new Date() }
              : {}),
          },
          tx,
        );
      }
    });
  }
}
