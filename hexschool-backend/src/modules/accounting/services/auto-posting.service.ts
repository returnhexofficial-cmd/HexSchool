import { Injectable, Logger } from '@nestjs/common';
import { Voucher, VoucherSource, VoucherType } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { money } from '../../fee/calc/money.util';
import {
  BilledPortion,
  SYSTEM_SLOTS,
  buildPaymentEntries,
} from '../calc/posting.engine';
import { reverseEntries } from '../calc/voucher.engine';
import { AccountingSettingsService } from './accounting-settings.service';
import { PostingMapService } from './posting-map.service';
import { VoucherService } from './voucher.service';

/**
 * Fee money → the ledger (roadmap M20 §4).
 *
 * The model the roadmap specifies is **income on receipt**, not accrual:
 * `payment.success` credits fee income directly rather than clearing a
 * receivable raised at invoicing. That is what a BD school's books
 * actually do, and it means an unpaid invoice never inflates income.
 *
 *   Dr  Cash / Bank / gateway clearing      the amount received
 *     Cr  Fee income, split per fee head    the same amount, exactly
 *
 * Three properties make this safe to run off an event:
 *
 *   - **Idempotent.** `source_ref` is `payment:<id>`, backed by a partial
 *     unique index, so a replayed event, a reconciliation sweep and a
 *     duplicated callback all land one voucher.
 *   - **Never blocking.** A posting failure is logged and swallowed; the
 *     payment is already recorded and the fee desk must not go down
 *     because a chart of accounts is misconfigured (the M07 rule).
 *   - **Reproducible.** The split is deterministic (see
 *     `posting.engine.ts`), so re-running produces the same document.
 */
@Injectable()
export class AutoPostingService {
  private readonly logger = new Logger(AutoPostingService.name);

  constructor(
    private readonly vouchers: VoucherService,
    private readonly map: PostingMapService,
    private readonly settings: AccountingSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  /** `payment.success` → a receipt voucher. */
  async postPayment(
    schoolId: string,
    paymentId: string,
    actorId?: string | null,
  ): Promise<Voucher | null> {
    const config = await this.settings.load(schoolId);
    if (!config.enabled || !config.autoPostFees) return null;

    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, schoolId },
      include: {
        invoice: {
          select: {
            invoiceNo: true,
            fineTotal: true,
            items: {
              select: {
                feeHeadId: true,
                description: true,
                amount: true,
                discount: true,
              },
            },
            enrollment: {
              select: {
                student: {
                  select: { studentUid: true, firstName: true, lastName: true },
                },
              },
            },
          },
        },
      },
    });
    if (!payment) {
      this.logger.warn(`Payment ${paymentId} not found — nothing to post`);
      return null;
    }

    const posting = await this.map.resolve(schoolId);

    const fundsAccountId =
      posting.methods.get(payment.method) ??
      this.map.slot(posting, SYSTEM_SLOTS.CASH_DEFAULT);
    const defaultIncomeAccountId = this.map.slot(
      posting,
      SYSTEM_SLOTS.FEE_INCOME_DEFAULT,
    );
    const fineIncomeAccountId =
      this.map.slot(posting, SYSTEM_SLOTS.LATE_FINE_INCOME) ??
      defaultIncomeAccountId;

    if (!fundsAccountId || !defaultIncomeAccountId || !fineIncomeAccountId) {
      // Reported loudly, but the payment stands. A school that has not
      // set up its chart of accounts still takes money.
      this.logger.error(
        `Cannot auto-post payment ${paymentId}: the chart of accounts has no ${
          !fundsAccountId ? 'cash/bank' : 'fee income'
        } account for it. Configure the posting map under Accounting → Posting map.`,
      );
      return null;
    }

    const portions = toPortions(payment.invoice);
    const entries = buildPaymentEntries({
      amount: Number(payment.amount),
      fundsAccountId,
      portions,
      headAccounts: posting.heads,
      defaultIncomeAccountId,
      fineIncomeAccountId,
    });

    const student = payment.invoice.enrollment.student;
    const name = `${student.firstName} ${student.lastName}`.trim();

    return this.vouchers.postAuto({
      schoolId,
      // Money in is a receipt, whatever channel it arrived through.
      type: VoucherType.CREDIT,
      source: VoucherSource.FEES,
      sourceRef: `payment:${payment.id}`,
      date: payment.paidAt ?? payment.createdAt,
      narration: `Fee receipt ${payment.paymentNo} — ${name} (${student.studentUid}), invoice ${payment.invoice.invoiceNo}`,
      reference: payment.paymentNo,
      entries,
      actorId,
    });
  }

  /**
   * `payment.refunded` → the reversal.
   *
   * Built by mirroring the ORIGINAL voucher rather than by re-deriving a
   * split: the money is going back exactly where it came from, and a
   * fresh derivation could disagree with the receipt if the posting map
   * changed in between. A partial refund scales the original's lines by
   * the refunded fraction, which keeps the head-wise income split honest.
   */
  async postRefund(
    schoolId: string,
    paymentId: string,
    refundId: string,
    amount: number,
    actorId?: string | null,
  ): Promise<Voucher | null> {
    const config = await this.settings.load(schoolId);
    if (!config.enabled || !config.autoPostFees) return null;

    const original = await this.prisma.voucher.findFirst({
      where: {
        schoolId,
        sourceRef: `payment:${paymentId}`,
        deletedAt: null,
        status: { not: 'CANCELLED' },
      },
      include: { entries: { orderBy: { displayOrder: 'asc' } } },
    });

    if (!original || original.entries.length === 0) {
      this.logger.warn(
        `Refund ${refundId} has no original voucher to reverse — the payment predates accounting or was never posted`,
      );
      return null;
    }

    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, schoolId },
      select: { amount: true, paymentNo: true },
    });
    const paid = Number(payment?.amount ?? 0);
    const refunded = money(amount);
    const fraction = paid > 0 ? refunded / paid : 1;

    const scaled = original.entries.map((entry) => ({
      accountId: entry.accountId,
      debit: money(Number(entry.debit) * fraction),
      credit: money(Number(entry.credit) * fraction),
      narration: entry.narration,
    }));

    // Scaling rounds each line, so the two sides can drift by a paisa on
    // a partial refund. The funds line is the one the bank statement will
    // agree with, so the drift is absorbed on the income side — where it
    // belongs, and where it keeps the voucher postable.
    const debits = scaled.reduce((sum, entry) => money(sum + entry.debit), 0);
    const credits = scaled.reduce((sum, entry) => money(sum + entry.credit), 0);
    const drift = money(debits - credits);
    if (drift !== 0) {
      const target = scaled.find((entry) =>
        drift > 0 ? entry.credit > 0 : entry.debit > 0,
      );
      if (target) {
        if (drift > 0) target.credit = money(target.credit + drift);
        else target.debit = money(target.debit - drift);
      }
    }

    return this.vouchers.postAuto({
      schoolId,
      type: VoucherType.DEBIT,
      source: VoucherSource.FEES,
      sourceRef: `refund:${refundId}`,
      date: new Date(),
      narration: `Refund against ${payment?.paymentNo ?? paymentId} — reverses ${original.voucherNo}`,
      reference: payment?.paymentNo ?? null,
      entries: reverseEntries(scaled),
      actorId,
    });
  }
}

/**
 * The billed components a payment is spread across: each line's net
 * amount, plus the invoice's late fine as its own portion so it can be
 * credited to fine income rather than tuition.
 */
function toPortions(invoice: {
  fineTotal: unknown;
  items: Array<{
    feeHeadId: string | null;
    description: string;
    amount: unknown;
    discount: unknown;
  }>;
}): BilledPortion[] {
  const portions: BilledPortion[] = invoice.items.map((item) => ({
    feeHeadId: item.feeHeadId,
    label: item.description,
    amount: money(Number(item.amount) - Number(item.discount)),
  }));

  const fine = money(Number(invoice.fineTotal ?? 0));
  if (fine > 0) {
    portions.push({ feeHeadId: null, label: 'Late fine', amount: fine });
  }
  return portions;
}
