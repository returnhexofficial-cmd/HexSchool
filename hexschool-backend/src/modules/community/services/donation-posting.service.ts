import { Injectable, Logger } from '@nestjs/common';
import { DonationMethod, VoucherSource, VoucherType } from '@prisma/client';
import { SYSTEM_SLOTS } from '../../accounting/calc/posting.engine';
import type { DraftEntry } from '../../accounting/calc/voucher.engine';
import { PostingMapService } from '../../accounting/services/posting-map.service';
import { VoucherService } from '../../accounting/services/voucher.service';
import { money } from '../../fee/calc/money.util';
import { postsToCash } from '../calc/donation.engine';

/**
 * Roadmap §4's "donation entry + receipt PDF + summary reports
 * (accounting posting **optional**)", implemented as a real posting
 * through M20's `VoucherService.postAuto` — the door M21's payroll, M23's
 * library fines, M24's purchases, M25's fuel bills and M26's hostel
 * deposits all use, sixth consumer.
 *
 * The roadmap calls the posting optional, and it is: a school can turn
 * `community.donation_post_to_accounts` off. What is not optional is that
 * a donation which *does* post lands somewhere honest.
 *
 * **An IN_KIND gift never debits cash.** Twenty donated benches are worth
 * twenty thousand taka on the receipt and in the accounts, but they are
 * not twenty thousand taka in the cash box, and posting them there would
 * make the ledger disagree with the tin the first time anybody counted it.
 * A gift in kind is recorded, receipted and reported — and left for the
 * accountant to capitalize, because *what* was given decides which asset
 * account it belongs in and the alumni desk cannot know that.
 *
 * Everything else is inherited from M20 and not re-litigated:
 *   - **Idempotent on `source_ref`** (`donation:<id>`) behind
 *     `uq_vouchers_source_ref`, so a double-clicked Save lands ONE
 *     voucher.
 *   - **A posting failure is logged, never rethrown.** The money has
 *     changed hands; refusing to record a donation because the chart of
 *     accounts is misconfigured is strictly worse than a ledger gap an
 *     accountant can fix and re-post.
 */
@Injectable()
export class DonationPostingService {
  private readonly logger = new Logger(DonationPostingService.name);

  constructor(
    private readonly vouchers: VoucherService,
    private readonly postingMap: PostingMapService,
  ) {}

  /** Dr cash, Cr donation income. Returns the voucher id, or `null`. */
  async postDonation(input: {
    schoolId: string;
    donationId: string;
    donorName: string;
    amount: number;
    method: DonationMethod;
    date: Date;
    purpose: string | null;
    actorId: string | null;
  }): Promise<string | null> {
    const amount = money(input.amount);
    if (amount <= 0) return null;

    if (!postsToCash(input.method)) {
      this.logger.log(
        `Donation ${input.donationId} is a gift in kind — receipted and reported, but not posted to cash. The accountant capitalizes it against the right asset account.`,
      );
      return null;
    }

    const narration = `Donation — ${input.donorName}${input.purpose ? ` (${input.purpose})` : ''}`;

    try {
      const posting = await this.postingMap.resolve(input.schoolId);
      const cashAccountId = posting.system.get(SYSTEM_SLOTS.CASH_DEFAULT);
      const incomeAccountId = posting.system.get(SYSTEM_SLOTS.DONATION_INCOME);

      if (!cashAccountId || !incomeAccountId) {
        this.logger.error(
          `Cannot post donation ${input.donationId}: the chart of accounts is missing the cash or donation-income account. Configure it under Accounting → Posting map.`,
        );
        return null;
      }

      const entries: DraftEntry[] = [
        {
          accountId: cashAccountId,
          debit: amount,
          credit: 0,
          narration,
        },
        {
          accountId: incomeAccountId,
          debit: 0,
          credit: amount,
          narration,
        },
      ];

      const voucher = await this.vouchers.postAuto({
        schoolId: input.schoolId,
        // A CREDIT voucher is a BD cash book's receipt: money came in.
        type: VoucherType.CREDIT,
        source: VoucherSource.DONATION,
        sourceRef: `donation:${input.donationId}`,
        date: input.date,
        narration,
        reference: input.donorName,
        actorId: input.actorId,
        entries,
      });

      return voucher?.id ?? null;
    } catch (error) {
      this.logger.error(
        `Donation voucher donation:${input.donationId} failed: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
