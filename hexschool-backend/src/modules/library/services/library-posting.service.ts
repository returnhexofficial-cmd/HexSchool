import { Injectable, Logger } from '@nestjs/common';
import { VoucherSource, VoucherType } from '@prisma/client';
import { SYSTEM_SLOTS } from '../../accounting/calc/posting.engine';
import type { DraftEntry } from '../../accounting/calc/voucher.engine';
import { PostingMapService } from '../../accounting/services/posting-map.service';
import { VoucherService } from '../../accounting/services/voucher.service';
import { money } from '../../fee/calc/money.util';

/**
 * Roadmap §4's "creates library income record … optional voucher via
 * posting map", implemented as a real posting through M20's
 * `VoucherService.postAuto` — the same door M21's payroll uses.
 *
 * Three properties come from M20 and are not re-litigated here:
 *
 *   - **Idempotent on `source_ref`.** `library-fine:<issueId>` behind
 *     `uq_vouchers_source_ref`, so a double-clicked Collect button, a
 *     retried request and a replayed job land ONE voucher. A doubled
 *     income entry would be invisible in every report — both vouchers
 *     balance perfectly (the M20 lesson).
 *   - **A posting failure is logged, never rethrown.** The money has
 *     already been taken. Refusing to record a receipt because the chart
 *     of accounts is misconfigured is strictly worse than a ledger gap
 *     an accountant can fix and re-post.
 *   - **Money in is a CREDIT voucher** (a BD cash book's CV), whatever
 *     channel it arrived through.
 *
 * The `source_ref` is per **loan**, not per payment, which matters
 * because a fine can be settled in two instalments: the second
 * collection finds the existing voucher and does not post again. That is
 * a deliberate simplification over M16's per-payment vouchers — a
 * library fine is a small, usually-single receipt, and the alternative
 * (a voucher per instalment) would need a payments table this module
 * does not have. It is recorded as a known limitation.
 */
@Injectable()
export class LibraryPostingService {
  private readonly logger = new Logger(LibraryPostingService.name);

  constructor(
    private readonly vouchers: VoucherService,
    private readonly postingMap: PostingMapService,
  ) {}

  async postFineReceipt(input: {
    schoolId: string;
    issueId: string;
    amount: number;
    /** `OVERDUE` / `LOST` / `DAMAGED` — what the narration says. */
    reason: string;
    bookTitle: string;
    accessionNo: string;
    memberName: string;
    cardNo: string;
    date: Date;
    actorId: string | null;
  }): Promise<string | null> {
    const amount = money(input.amount);
    if (amount <= 0) return null;

    try {
      const posting = await this.postingMap.resolve(input.schoolId);
      const cashAccountId = posting.system.get(SYSTEM_SLOTS.CASH_DEFAULT);
      const incomeAccountId = posting.system.get(
        SYSTEM_SLOTS.LIBRARY_FINE_INCOME,
      );

      if (!cashAccountId || !incomeAccountId) {
        this.logger.error(
          `Cannot post library fine for loan ${input.issueId}: the chart of accounts has no ${
            !cashAccountId ? 'cash' : 'library income'
          } account. Configure it under Accounting → Posting map.`,
        );
        return null;
      }

      const entries: DraftEntry[] = [
        {
          accountId: cashAccountId,
          debit: amount,
          credit: 0,
          narration: `Library fine — ${input.accessionNo}`,
        },
        {
          accountId: incomeAccountId,
          debit: 0,
          credit: amount,
          narration: `${input.reason} charge, "${input.bookTitle}"`,
        },
      ];

      const voucher = await this.vouchers.postAuto({
        schoolId: input.schoolId,
        type: VoucherType.CREDIT,
        source: VoucherSource.LIBRARY,
        sourceRef: `library-fine:${input.issueId}`,
        date: input.date,
        narration: `Library fine from ${input.memberName} (${input.cardNo}) — "${input.bookTitle}" [${input.accessionNo}]`,
        reference: input.accessionNo,
        actorId: input.actorId,
        entries,
      });

      return voucher?.id ?? null;
    } catch (error) {
      this.logger.error(
        `Library fine voucher for loan ${input.issueId} failed: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
