import { Injectable, Logger } from '@nestjs/common';
import { ItemType, VoucherSource, VoucherType } from '@prisma/client';
import { SYSTEM_SLOTS } from '../../accounting/calc/posting.engine';
import type { DraftEntry } from '../../accounting/calc/voucher.engine';
import { PostingMapService } from '../../accounting/services/posting-map.service';
import { VoucherService } from '../../accounting/services/voucher.service';
import { money } from '../../fee/calc/money.util';

export interface PurchasePostingLine {
  /** Drives the account, via `PostingMapKind.INVENTORY_CATEGORY`. */
  itemCategoryId: string | null;
  itemType: ItemType;
  amount: number;
  label: string;
}

/**
 * Roadmap §4's "optional posting: RECEIVED purchase → expense/asset
 * voucher via posting map", implemented as a real posting through M20's
 * `VoucherService.postAuto` — the same door M21's payroll, M23's library
 * fines and M25's fuel bills use.
 *
 * A purchase is a **DEBIT** voucher (a BD cash book's payment voucher),
 * the second auto-posted kind in the system that spends rather than
 * receives: Dr <wherever the goods land> / Cr Cash. Everything else is
 * inherited from M20 and not re-litigated here — idempotent on
 * `source_ref` (`inventory-purchase:<id>`), and a posting failure is
 * logged rather than thrown, because by the time this runs the delivery
 * is physically in the store and refusing to record it over a
 * misconfigured chart of accounts is strictly worse than a ledger gap an
 * accountant can fix.
 *
 * ## Where the goods land, and the simplification in it
 *
 * Each line resolves an account in three steps:
 *
 *   1. the item's **category**, if the school mapped it
 *      (`INVENTORY_CATEGORY` — "Computers" → `1540`, "Library Books" →
 *      `1530`, which is also what finally gives M23's seeded `1530` a
 *      poster);
 *   2. otherwise the type default — `INVENTORY_ASSET_DEFAULT` (`1520
 *      Furniture & Fixtures`) for an ASSET, `INVENTORY_CONSUMABLE_EXPENSE`
 *      (`5500 Printing & Stationery`) for a CONSUMABLE;
 *   3. and if the chart has neither, the line is dropped with a log
 *      rather than posted somewhere wrong.
 *
 * **Consumables are expensed at PURCHASE, not at issue.** That is a real
 * simplification and worth stating plainly: it means the stock ledger and
 * the ledger of accounts deliberately disagree about unissued stock — the
 * store says the school holds 40 reams, the books say the paper was spent
 * in March. Perpetual inventory accounting (Dr Inventory at receipt, Cr
 * it at issue) would reconcile them and needs a current-asset stock
 * account plus a cost-flow method the valuation report does not have. BD
 * schools expense stores on purchase, roadmap §4 asks for an "expense/
 * asset voucher" at RECEIVE, and pretending otherwise would produce a
 * balance-sheet line nobody could substantiate.
 *
 * Lines going to the same account are **merged** before the voucher is
 * built. Six kinds of stationery on one delivery are one Dr 5500 line of
 * the summed amount, not six identical ones — which is what an accountant
 * expects to see against a single supplier invoice.
 */
@Injectable()
export class InventoryPostingService {
  private readonly logger = new Logger(InventoryPostingService.name);

  constructor(
    private readonly vouchers: VoucherService,
    private readonly postingMap: PostingMapService,
  ) {}

  async postPurchase(input: {
    schoolId: string;
    purchaseId: string;
    purchaseNo: string;
    date: Date;
    supplierName: string | null;
    actorId: string | null;
    lines: PurchasePostingLine[];
  }): Promise<string | null> {
    const total = money(
      input.lines.reduce((sum, line) => sum + money(line.amount), 0),
    );
    if (total <= 0) return null;

    try {
      const posting = await this.postingMap.resolve(input.schoolId);
      const cashAccountId = posting.system.get(SYSTEM_SLOTS.CASH_DEFAULT);
      if (!cashAccountId) {
        this.logger.error(
          `Cannot post purchase ${input.purchaseNo}: the chart of accounts has no cash account. Configure it under Accounting → Posting map.`,
        );
        return null;
      }

      const byAccount = new Map<string, number>();
      let unmapped = 0;

      for (const line of input.lines) {
        const amount = money(line.amount);
        if (amount <= 0) continue;

        const accountId = this.accountFor(posting, line);
        if (!accountId) {
          unmapped = money(unmapped + amount);
          this.logger.warn(
            `Purchase ${input.purchaseNo}: "${line.label}" has no account mapping and no seeded default — ${amount} left off the voucher.`,
          );
          continue;
        }
        byAccount.set(
          accountId,
          money((byAccount.get(accountId) ?? 0) + amount),
        );
      }

      const debited = money(
        [...byAccount.values()].reduce((sum, value) => sum + value, 0),
      );
      if (debited <= 0) {
        this.logger.error(
          `Purchase ${input.purchaseNo}: no line could be mapped to an account — nothing posted.`,
        );
        return null;
      }

      const narration = `Purchase ${input.purchaseNo}${
        input.supplierName ? ` — ${input.supplierName}` : ''
      }`;

      // Credit cash with exactly what was debited, NOT with the purchase
      // total: if a line was dropped for want of a mapping, crediting the
      // full amount would post a voucher that does not balance and M20
      // would refuse it — turning a partial-mapping warning into a total
      // failure. The dropped amount is logged above and reported below.
      const entries: DraftEntry[] = [
        ...[...byAccount.entries()].map(([accountId, amount]) => ({
          accountId,
          debit: amount,
          credit: 0,
          narration,
        })),
        {
          accountId: cashAccountId,
          debit: 0,
          credit: debited,
          narration: input.supplierName
            ? `Paid to ${input.supplierName}`
            : 'Store purchase',
        },
      ];

      const voucher = await this.vouchers.postAuto({
        schoolId: input.schoolId,
        type: VoucherType.DEBIT,
        source: VoucherSource.INVENTORY,
        sourceRef: `inventory-purchase:${input.purchaseId}`,
        date: input.date,
        narration:
          unmapped > 0
            ? `${narration} (${unmapped} unmapped, not posted)`
            : narration,
        reference: input.purchaseNo,
        actorId: input.actorId,
        entries,
      });

      return voucher?.id ?? null;
    } catch (error) {
      this.logger.error(
        `Purchase voucher for ${input.purchaseNo} failed: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private accountFor(
    posting: Awaited<ReturnType<PostingMapService['resolve']>>,
    line: PurchasePostingLine,
  ): string | undefined {
    if (line.itemCategoryId) {
      const mapped = posting.inventoryCategories.get(line.itemCategoryId);
      if (mapped) return mapped;
    }
    return posting.system.get(
      line.itemType === ItemType.ASSET
        ? SYSTEM_SLOTS.INVENTORY_ASSET_DEFAULT
        : SYSTEM_SLOTS.INVENTORY_CONSUMABLE_EXPENSE,
    );
  }
}
