import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { PaymentsRepository } from '../repositories/payments.repository';
import { PaymentGatewayService } from '../services/payment-gateway.service';

/** A callback lost this long ago is worth chasing (roadmap M16 §8). */
const STALE_AFTER_MINUTES = 15;

/**
 * Hourly reconciliation of abandoned online payments (roadmap M16 §8).
 *
 * The case this exists for: the payer opened bKash, the money left their
 * wallet, and then they closed the app before the callback fired. The
 * payment row is stuck at PENDING and neither the school nor the parent
 * knows the truth.
 *
 * So the job asks the gateway. `verify()` is the same call the callback
 * uses, so a payment reconciled here is settled by exactly the path a
 * successful callback would have taken — including the amount check.
 *
 * A gateway being down must not kill the run, so each payment is
 * attempted independently and failures are logged.
 */
@Injectable()
export class ReconciliationJob {
  private readonly logger = new Logger(ReconciliationJob.name);

  constructor(
    private readonly payments: PaymentsRepository,
    private readonly schools: SchoolsRepository,
    private readonly gateways: PaymentGatewayService,
  ) {}

  @Cron('7 * * * *')
  async run(): Promise<number> {
    const schools = await this.schools.findAll();
    let total = 0;
    for (const school of schools) {
      total += await this.runForSchool(school.id);
    }
    return total;
  }

  /** Exposed for tests and the manual "reconcile pending" action. */
  async runForSchool(schoolId: string): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60_000);
    const stale = await this.payments.findStalePending(schoolId, cutoff);
    if (stale.length === 0) return 0;

    let settled = 0;
    const seenSessions = new Set<string>();

    for (const payment of stale) {
      // A multi-invoice checkout shares one gateway session; reconciling
      // any one of its rows settles all of them.
      if (payment.gatewayRef && seenSessions.has(payment.gatewayRef)) continue;
      if (payment.gatewayRef) seenSessions.add(payment.gatewayRef);

      try {
        const outcome = await this.gateways.reconcile(payment.id, schoolId);
        if (outcome.status === 'SUCCESS') settled += 1;
      } catch (error) {
        // A gateway outage must not abort the whole run.
        this.logger.warn(
          `Could not reconcile payment ${payment.paymentNo}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (settled > 0) {
      this.logger.log(
        `Reconciliation settled ${settled} previously pending payment(s)`,
      );
    }
    return settled;
  }
}
