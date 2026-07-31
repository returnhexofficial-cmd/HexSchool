import { Injectable, Logger } from '@nestjs/common';
import { VoucherSource, VoucherType } from '@prisma/client';
import { SYSTEM_SLOTS } from '../../accounting/calc/posting.engine';
import type { DraftEntry } from '../../accounting/calc/voucher.engine';
import { PostingMapService } from '../../accounting/services/posting-map.service';
import { VoucherService } from '../../accounting/services/voucher.service';
import { money } from '../../fee/calc/money.util';

/**
 * Roadmap §4's "expense entry + optional voucher posting", implemented as
 * a real posting through M20's `VoucherService.postAuto` — the same door
 * M21's payroll and M23's library fines use.
 *
 * **This is the first auto-posted voucher in the system that spends money
 * rather than receiving it**, so it is a DEBIT voucher (a BD cash book's
 * payment voucher): Dr Transport Expense, Cr Cash. Everything else is
 * inherited from M20 and not re-litigated here:
 *
 *   - **Idempotent on `source_ref`** (`transport-expense:<id>`) behind
 *     `uq_vouchers_source_ref`, so a double-clicked Save and a retried
 *     request land ONE voucher. A doubled expense would be invisible in
 *     every report — both vouchers balance perfectly (the M20 lesson).
 *   - **A posting failure is logged, never rethrown.** The fuel has been
 *     bought and the receipt is in somebody's hand; refusing to record it
 *     because the chart of accounts is misconfigured is strictly worse
 *     than a ledger gap an accountant can fix and re-post.
 */
@Injectable()
export class TransportPostingService {
  private readonly logger = new Logger(TransportPostingService.name);

  constructor(
    private readonly vouchers: VoucherService,
    private readonly postingMap: PostingMapService,
  ) {}

  async postExpense(input: {
    schoolId: string;
    expenseId: string;
    vehicleRegNo: string;
    type: string;
    amount: number;
    date: Date;
    description: string | null;
    actorId: string | null;
  }): Promise<string | null> {
    const amount = money(input.amount);
    if (amount <= 0) return null;

    try {
      const posting = await this.postingMap.resolve(input.schoolId);
      const cashAccountId = posting.system.get(SYSTEM_SLOTS.CASH_DEFAULT);
      const expenseAccountId = posting.system.get(
        SYSTEM_SLOTS.TRANSPORT_EXPENSE,
      );

      if (!cashAccountId || !expenseAccountId) {
        this.logger.error(
          `Cannot post transport expense ${input.expenseId}: the chart of accounts has no ${
            !cashAccountId ? 'cash' : 'transport expense'
          } account. Configure it under Accounting → Posting map.`,
        );
        return null;
      }

      const narration = `${titleCase(input.type)} — ${input.vehicleRegNo}`;
      const entries: DraftEntry[] = [
        {
          accountId: expenseAccountId,
          debit: amount,
          credit: 0,
          narration,
        },
        {
          accountId: cashAccountId,
          debit: 0,
          credit: amount,
          narration: `Paid for ${input.vehicleRegNo}`,
        },
      ];

      const voucher = await this.vouchers.postAuto({
        schoolId: input.schoolId,
        type: VoucherType.DEBIT,
        source: VoucherSource.TRANSPORT,
        sourceRef: `transport-expense:${input.expenseId}`,
        date: input.date,
        narration: input.description?.trim()
          ? `${narration}: ${input.description.trim()}`
          : narration,
        reference: input.vehicleRegNo,
        actorId: input.actorId,
        entries,
      });

      return voucher?.id ?? null;
    } catch (error) {
      this.logger.error(
        `Transport expense voucher for ${input.expenseId} failed: ${(error as Error).message}`,
      );
      return null;
    }
  }
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
