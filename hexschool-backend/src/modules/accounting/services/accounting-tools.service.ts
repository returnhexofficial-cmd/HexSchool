import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountType, VoucherType } from '@prisma/client';
import { parseDate } from '../../academic/calendar/date.util';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { money } from '../../fee/calc/money.util';
import {
  SYSTEM_SLOTS,
  buildOpeningEntries,
  buildSettlementEntries,
} from '../calc/posting.engine';
import { OpeningBalancesDto, SettlementDto } from '../dto';
import { AccountsRepository } from '../repositories/accounts.repository';
import { VoucherWithEntries } from '../repositories/vouchers.repository';
import { PostingMapService } from './posting-map.service';
import { VoucherService } from './voucher.service';

/**
 * The two tools roadmap M20 §8 calls for by name: the gateway settlement
 * entry, and the opening-balance journal wizard.
 *
 * Both are thin: they resolve a couple of accounts, hand the shape to a
 * pure engine, and post the result through the ordinary voucher path — so
 * a settlement is validated, numbered, period-checked and audited exactly
 * like a hand-typed voucher, and shows up in the cash book alongside one.
 */
@Injectable()
export class AccountingToolsService {
  constructor(
    private readonly vouchers: VoucherService,
    private readonly accounts: AccountsRepository,
    private readonly map: PostingMapService,
  ) {}

  /**
   * bKash pays out T+1 net of commission. Without this entry, the
   * clearing account grows by the commission every single day and nobody
   * notices for a year — see §8 and `posting.engine.ts`.
   */
  async settle(
    dto: SettlementDto,
    actor: AccessTokenPayload,
  ): Promise<VoucherWithEntries> {
    const schoolId = actor.schoolId;

    if (dto.charges > dto.gross) {
      throw new BadRequestException(
        'The commission cannot exceed the gross settled amount',
      );
    }

    const [clearing, bank] = await Promise.all([
      this.accounts.findById(dto.clearingAccountId, schoolId),
      this.accounts.findById(dto.bankAccountId, schoolId),
    ]);
    if (!clearing) throw new NotFoundException('Clearing account not found');
    if (!bank) throw new NotFoundException('Bank account not found');
    if (bank.type !== AccountType.BANK && bank.type !== AccountType.CASH) {
      throw new BadRequestException(
        `${bank.code} ${bank.name} is not a bank or cash account — a settlement lands in one`,
      );
    }

    const posting = await this.map.resolve(schoolId);
    const chargeAccountId = this.map.slot(
      posting,
      SYSTEM_SLOTS.GATEWAY_CHARGES,
    );
    if (!chargeAccountId && dto.charges > 0) {
      throw new ConflictException(
        'No gateway-charges expense account is configured — map one under Accounting → Posting map before recording a settlement with a commission',
      );
    }

    const entries = buildSettlementEntries({
      clearingAccountId: clearing.id,
      bankAccountId: bank.id,
      chargeAccountId: chargeAccountId ?? bank.id,
      gross: dto.gross,
      charges: dto.charges,
    });

    return this.vouchers.create(
      {
        // The school's own money moving between its own accounts, with a
        // commission recognised on the way — a journal, not a receipt.
        type: VoucherType.JOURNAL,
        date: dto.date,
        narration: `Gateway settlement from ${clearing.name} to ${bank.name}${
          dto.charges > 0
            ? ` (commission ${money(dto.charges).toFixed(2)})`
            : ''
        }`,
        reference: dto.reference,
        entries: entries.map((entry) => ({
          accountId: entry.accountId,
          debit: entry.debit,
          credit: entry.credit,
          narration: entry.narration ?? undefined,
        })),
        post: true,
      },
      actor,
    );
  }

  /**
   * Mid-year adoption: type in what each account already holds, and the
   * difference is the accumulated fund the school started with. The
   * engine adds that balancing line, which is what makes an honestly
   * incomplete opening set postable at all.
   */
  async openingBalances(
    dto: OpeningBalancesDto,
    actor: AccessTokenPayload,
  ): Promise<VoucherWithEntries> {
    const schoolId = actor.schoolId;

    for (const line of dto.lines) {
      if (line.debit > 0 && line.credit > 0) {
        throw new BadRequestException(
          'An opening balance is a debit or a credit, never both',
        );
      }
    }

    const posting = await this.map.resolve(schoolId);
    const equityAccountId = this.map.slot(posting, SYSTEM_SLOTS.OPENING_EQUITY);
    if (!equityAccountId) {
      throw new ConflictException(
        'No opening-equity account is configured — map one under Accounting → Posting map, or keep the seeded "Capital Fund" account',
      );
    }

    const entries = buildOpeningEntries({
      lines: dto.lines,
      equityAccountId,
    });
    if (entries.length < 2) {
      throw new BadRequestException(
        'Enter at least one opening balance with an amount',
      );
    }

    // Dated the day before the window a school starts keeping books, so
    // the first month's income statement is not polluted by figures that
    // are a position rather than a flow.
    const date = parseDate(dto.date);

    return this.vouchers.create(
      {
        type: VoucherType.JOURNAL,
        date: dto.date,
        narration:
          dto.narration?.trim() ||
          `Opening balances as at ${date.toISOString().slice(0, 10)}`,
        entries: entries.map((entry) => ({
          accountId: entry.accountId,
          debit: entry.debit,
          credit: entry.credit,
          narration: entry.narration ?? undefined,
        })),
        post: true,
      },
      actor,
    );
  }
}
