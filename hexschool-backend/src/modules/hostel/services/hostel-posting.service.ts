import { Injectable, Logger } from '@nestjs/common';
import { VoucherSource, VoucherType } from '@prisma/client';
import { SYSTEM_SLOTS } from '../../accounting/calc/posting.engine';
import type { DraftEntry } from '../../accounting/calc/voucher.engine';
import { PostingMapService } from '../../accounting/services/posting-map.service';
import { VoucherService } from '../../accounting/services/voucher.service';
import { money } from '../../fee/calc/money.util';

/**
 * Roadmap §6's "deposit refund recorded (accounting voucher optional)",
 * implemented as a **real pair** of postings through M20's
 * `VoucherService.postAuto` — the door M21's payroll, M23's library
 * fines, M24's purchases and M25's fuel bills all use.
 *
 * **Why both halves, when the roadmap only names the refund.** A refund
 * voucher on its own would debit a liability that was never raised, and
 * the balance sheet would show the school owing its boarders a negative
 * amount. The deposit is money the school *holds*, so taking it is
 * Dr Cash / Cr Security Deposits and giving it back is the mirror. Post
 * one without the other and the books say something false about the very
 * thing this is here to record.
 *
 * That also makes this the first auto-posting in the system that touches
 * **neither income nor expense** — hostel and mess *fees* are ordinary
 * fee heads and post as `FEES` through the head → account map. Everything
 * else is inherited from M20 and not re-litigated:
 *
 *   - **Idempotent on `source_ref`** (`hostel-deposit:<id>` and
 *     `hostel-refund:<id>`) behind `uq_vouchers_source_ref`, so a
 *     double-clicked Save lands ONE voucher. A doubled deposit would be
 *     invisible in every report — both vouchers balance perfectly.
 *   - **A posting failure is logged, never rethrown.** The money has
 *     changed hands; refusing to record that a boarder moved in because
 *     the chart of accounts is misconfigured is strictly worse than a
 *     ledger gap an accountant can fix and re-post.
 */
@Injectable()
export class HostelPostingService {
  private readonly logger = new Logger(HostelPostingService.name);

  constructor(
    private readonly vouchers: VoucherService,
    private readonly postingMap: PostingMapService,
  ) {}

  /** Deposit taken: Dr Cash, Cr Security Deposits (a liability arises). */
  async postDepositTaken(input: {
    schoolId: string;
    allocationId: string;
    studentName: string;
    amount: number;
    date: Date;
    actorId: string | null;
  }): Promise<string | null> {
    return this.post({
      ...input,
      sourceRef: `hostel-deposit:${input.allocationId}`,
      // A CREDIT voucher is a BD cash book's receipt: money came in.
      type: VoucherType.CREDIT,
      narration: `Hostel security deposit — ${input.studentName}`,
      debitSlot: SYSTEM_SLOTS.CASH_DEFAULT,
      creditSlot: SYSTEM_SLOTS.HOSTEL_DEPOSIT_LIABILITY,
    });
  }

  /** Deposit returned: Dr Security Deposits, Cr Cash (the liability goes). */
  async postDepositRefund(input: {
    schoolId: string;
    allocationId: string;
    studentName: string;
    amount: number;
    date: Date;
    actorId: string | null;
  }): Promise<string | null> {
    return this.post({
      ...input,
      sourceRef: `hostel-refund:${input.allocationId}`,
      type: VoucherType.DEBIT,
      narration: `Hostel deposit refunded — ${input.studentName}`,
      debitSlot: SYSTEM_SLOTS.HOSTEL_DEPOSIT_LIABILITY,
      creditSlot: SYSTEM_SLOTS.CASH_DEFAULT,
    });
  }

  private async post(input: {
    schoolId: string;
    amount: number;
    date: Date;
    actorId: string | null;
    studentName: string;
    sourceRef: string;
    type: VoucherType;
    narration: string;
    debitSlot: string;
    creditSlot: string;
  }): Promise<string | null> {
    const amount = money(input.amount);
    if (amount <= 0) return null;

    try {
      const posting = await this.postingMap.resolve(input.schoolId);
      const debitAccountId = posting.system.get(input.debitSlot);
      const creditAccountId = posting.system.get(input.creditSlot);

      if (!debitAccountId || !creditAccountId) {
        this.logger.error(
          `Cannot post ${input.sourceRef}: the chart of accounts is missing the cash or security-deposit account. Configure it under Accounting → Posting map.`,
        );
        return null;
      }

      const entries: DraftEntry[] = [
        {
          accountId: debitAccountId,
          debit: amount,
          credit: 0,
          narration: input.narration,
        },
        {
          accountId: creditAccountId,
          debit: 0,
          credit: amount,
          narration: input.narration,
        },
      ];

      const voucher = await this.vouchers.postAuto({
        schoolId: input.schoolId,
        type: input.type,
        source: VoucherSource.HOSTEL,
        sourceRef: input.sourceRef,
        date: input.date,
        narration: input.narration,
        reference: input.studentName,
        actorId: input.actorId,
        entries,
      });

      return voucher?.id ?? null;
    } catch (error) {
      this.logger.error(
        `Hostel voucher ${input.sourceRef} failed: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
