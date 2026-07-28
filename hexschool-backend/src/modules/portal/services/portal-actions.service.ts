import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SessionsService } from '../../academic/services/sessions.service';
import { NotificationService } from '../../communication/services/notification.service';
import { formatMoney } from '../../fee/calc/money.util';
import { LedgerService } from '../../fee/services/ledger.service';
import { PaymentGatewayService } from '../../fee/services/payment-gateway.service';
import { InitOnlinePaymentDto } from '../../fee/dto';
import { ResultsService } from '../../result/services/results.service';
import { ResultsRepository } from '../../result/repositories/results.repository';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { DashboardRepository } from '../repositories/dashboard.repository';

/**
 * The three cross-module admin/portal actions M18 was left to wire
 * (PROJECT_CONTEXT §18): a portal **Pay Now**, the automatic
 * **result-withhold on dues**, and the **dues-reminder blast**. They live
 * here because PortalModule is the aggregator that already imports both
 * FeeModule and ResultModule/CommunicationModule — orchestrating them from
 * a feature module would add a cross-module edge and risk a cycle.
 */
@Injectable()
export class PortalActionsService {
  private readonly logger = new Logger(PortalActionsService.name);

  constructor(
    private readonly gateways: PaymentGatewayService,
    private readonly ledger: LedgerService,
    private readonly results: ResultsService,
    private readonly resultsRepo: ResultsRepository,
    private readonly notifications: NotificationService,
    private readonly sessions: SessionsService,
    private readonly schools: SchoolsRepository,
    private readonly dashboard: DashboardRepository,
  ) {}

  /**
   * Portal Pay-Now. Verifies every invoice belongs to the student the
   * caller owns, then reuses the M16 online-payment init (which creates
   * the PENDING payment and returns the checkout URL). The gateway result
   * is concluded only by the M16 server-side `verify()`, unchanged.
   */
  async payDues(
    studentId: string,
    dto: InitOnlinePaymentDto,
    actor: AccessTokenPayload,
    baseUrl: string,
  ): Promise<{ checkoutUrl: string; gatewayRef: string }> {
    const owners = await this.dashboard.invoiceStudentIds(
      dto.invoiceIds,
      actor.schoolId,
    );
    for (const invoiceId of dto.invoiceIds) {
      if (owners.get(invoiceId) !== studentId) {
        throw new ForbiddenException('That invoice is not yours to pay');
      }
    }
    const initiated = await this.gateways.initiate(dto, actor, baseUrl);
    return {
      checkoutUrl: initiated.checkoutUrl,
      gatewayRef: initiated.gatewayRef,
    };
  }

  /**
   * What became of a checkout (roadmap M16 §5 "success/failure pages").
   * Read strictly from our own `payments` rows — the outcome is whatever
   * the M16 server-side `verify()` concluded, never what the gateway put
   * in the redirect. A payer who is still PENDING is told to wait, which
   * is the honest answer: the hourly reconciliation sweep will settle it.
   *
   * Ownership: every payment in the reference must belong to a student the
   * caller owns, so someone else's reference is a 403.
   */
  async paymentStatus(
    ownedStudentIds: string[],
    reference: string,
    schoolId: string,
  ) {
    const payments = await this.dashboard.paymentsByReference(
      reference,
      schoolId,
    );
    if (payments.length === 0) {
      throw new NotFoundException('No payment for that reference');
    }
    for (const payment of payments) {
      if (!ownedStudentIds.includes(payment.studentId)) {
        throw new ForbiddenException('That payment is not yours to view');
      }
    }

    const statuses = new Set(payments.map((p) => p.status));
    const outcome = statuses.has('SUCCESS')
      ? statuses.size === 1
        ? 'SUCCESS'
        : 'PARTIAL'
      : statuses.has('PENDING')
        ? 'PENDING'
        : 'FAILED';

    return {
      reference,
      outcome,
      total: Math.round(
        payments
          .filter((p) => p.status === 'SUCCESS')
          .reduce((sum, p) => sum + p.amount, 0) * 100,
      ) / 100,
      payments: payments.map(({ studentId: _studentId, ...rest }) => rest),
    };
  }

  /**
   * Automatic result-withhold on dues (the M15 `setWithheld` + M16
   * `outstandingFor` hook). For a published/processed exam, withholds the
   * result of every candidate who still owes money — so a report card
   * cannot go home while fees are outstanding. Idempotent: an
   * already-withheld result is skipped.
   */
  async withholdResultsForDues(
    examId: string,
    actor: AccessTokenPayload,
  ): Promise<{ withheld: number; skipped: number }> {
    const results = await this.resultsRepo.findForExam(examId);
    if (results.length === 0) return { withheld: 0, skipped: 0 };

    const enrollmentIds = results.map((r) => r.enrollmentId);
    const outstanding = await this.ledger.outstandingFor(
      enrollmentIds,
      actor.schoolId,
    );

    let withheld = 0;
    let skipped = 0;
    for (const result of results) {
      const due = outstanding.get(result.enrollmentId) ?? 0;
      if (due <= 0) continue;
      if (result.status === 'WITHHELD') {
        skipped += 1;
        continue;
      }
      await this.results.setWithheld(
        result.id,
        {
          withheld: true,
          reason: `Outstanding dues ${formatMoney(due)} BDT`,
        },
        actor,
      );
      withheld += 1;
    }
    return { withheld, skipped };
  }

  /**
   * Dues-reminder blast (roadmap M17 §4 "defaulters list" audience,
   * deferred to M18 because the defaulter data lives in FeeModule). Sends
   * the `FEE_DUES` template to every defaulter's primary guardian for the
   * session through `NotificationService`.
   */
  async sendDuesReminders(
    sessionId: string | undefined,
    actor: AccessTokenPayload,
  ): Promise<{ sent: number; recipients: number }> {
    const session =
      sessionId ?? (await this.sessions.getCurrent(actor.schoolId))?.id;
    if (!session) return { sent: 0, recipients: 0 };

    const [defaulters, school] = await Promise.all([
      this.dashboard.defaultersForSession(actor.schoolId, session),
      this.schools.findById(actor.schoolId),
    ]);
    let sent = 0;
    for (const d of defaulters) {
      const row = await this.notifications.send({
        schoolId: actor.schoolId,
        code: 'FEE_DUES',
        channel: 'SMS',
        recipient: { type: 'GUARDIAN', destination: d.phone },
        vars: {
          school: school?.name ?? '',
          student_name: d.name,
          amount: formatMoney(d.outstanding),
          due: 'the earliest date',
        },
        dedupe: true,
        createdBy: actor.sub,
      });
      if (row) sent += 1;
    }
    return { sent, recipients: defaulters.length };
  }
}
