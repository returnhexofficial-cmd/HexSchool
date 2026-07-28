import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FEE_EVENTS } from '../../fee/events/fee.events';
import type {
  PaymentRefundedEvent,
  PaymentSuccessEvent,
} from '../../fee/events/fee.events';
import { AutoPostingService } from '../services/auto-posting.service';

/**
 * The M16 → M20 bridge (roadmap M20 §4 "Auto-posting listeners").
 *
 * Every handler swallows its own failures. That is deliberate and it is
 * the M12 `AttendanceListener` precedent: the mutation that raised the
 * event has already committed, so rethrowing here could only turn a
 * bookkeeping problem into a failed fee collection. The error is logged
 * with the payment id, and because posting is idempotent on `source_ref`
 * the operator's fix is simply to reconcile the payment again.
 */
@Injectable()
export class AccountingListener {
  private readonly logger = new Logger(AccountingListener.name);

  constructor(private readonly autoPosting: AutoPostingService) {}

  @OnEvent(FEE_EVENTS.PAYMENT_SUCCESS)
  async handlePaymentSuccess(event: PaymentSuccessEvent): Promise<void> {
    try {
      const voucher = await this.autoPosting.postPayment(
        event.schoolId,
        event.paymentId,
        event.actorId,
      );
      if (voucher) {
        this.logger.log(
          `Payment ${event.paymentId} posted as ${voucher.voucherNo}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to post payment ${event.paymentId}: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent(FEE_EVENTS.PAYMENT_REFUNDED)
  async handlePaymentRefunded(event: PaymentRefundedEvent): Promise<void> {
    try {
      const voucher = await this.autoPosting.postRefund(
        event.schoolId,
        event.paymentId,
        event.refundId,
        event.amount,
        event.actorId,
      );
      if (voucher) {
        this.logger.log(
          `Refund ${event.refundId} posted as ${voucher.voucherNo}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to post refund ${event.refundId}: ${(err as Error).message}`,
      );
    }
  }
}
