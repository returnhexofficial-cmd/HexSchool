import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  Voucher,
  VoucherSource,
  VoucherStatus,
  VoucherType,
} from '@prisma/client';
import { UserType } from '../../../common/constants';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { money } from '../../fee/calc/money.util';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { SequenceService } from '../../sequence/sequence.service';
import {
  AccountFacts,
  DraftEntry,
  VoucherProblems,
  firstProblemMessage,
  hasProblems,
  reverseEntries,
  reversalType,
  signedMovement,
  validateVoucher,
} from '../calc/voucher.engine';
import {
  CancelVoucherDto,
  CreateVoucherDto,
  UpdateVoucherDto,
  VoucherQueryDto,
} from '../dto';
import { AccountsRepository } from '../repositories/accounts.repository';
import {
  VoucherWithEntries,
  VouchersRepository,
} from '../repositories/vouchers.repository';
import { AccountingSettingsService } from './accounting-settings.service';
import { FiscalPeriodService } from './fiscal-period.service';

/** What auto-posting hands in — already-built entries plus their identity. */
export interface AutoVoucherInput {
  schoolId: string;
  type: VoucherType;
  source: VoucherSource;
  /** The idempotency key (`payment:<id>`), backed by a partial unique. */
  sourceRef: string;
  date: Date;
  narration: string;
  reference?: string | null;
  entries: DraftEntry[];
  actorId?: string | null;
}

@Injectable()
export class VoucherService {
  private readonly logger = new Logger(VoucherService.name);

  constructor(
    private readonly vouchers: VouchersRepository,
    private readonly accounts: AccountsRepository,
    private readonly periods: FiscalPeriodService,
    private readonly sequences: SequenceService,
    private readonly schools: SchoolsRepository,
    private readonly settings: AccountingSettingsService,
    private readonly permissions: PermissionsService,
    private readonly auditContext: AuditContextService,
  ) {}

  // ── read ────────────────────────────────────────────────────────────

  async list(
    query: VoucherQueryDto,
    schoolId: string,
  ): Promise<{
    rows: VoucherWithEntries[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { rows, total } = await this.vouchers.findMany(
      schoolId,
      {
        type: query.type,
        status: query.status as VoucherStatus | undefined,
        source: query.source as VoucherSource | undefined,
        from: query.from ? parseDate(query.from) : undefined,
        to: query.to ? parseDate(query.to) : undefined,
        accountId: query.accountId,
        search: query.search,
      },
      page,
      limit,
    );
    return { rows, total, page, limit };
  }

  async getDetail(id: string, schoolId: string): Promise<VoucherWithEntries> {
    const voucher = await this.vouchers.findDetail(id, schoolId);
    if (!voucher) throw new NotFoundException(`Voucher ${id} not found`);
    return voucher;
  }

  // ── write ───────────────────────────────────────────────────────────

  /**
   * Create a voucher, as a draft or posted in one go.
   *
   * The whole validation stack runs before anything is written: line
   * shape, leaf-only accounts, the voucher-type conventions, and
   * Σdebit = Σcredit. A caller gets every problem at once (the M15
   * all-at-once rule) so the entry grid can paint them all rather than
   * making the operator fix one, resubmit, and find the next.
   */
  async create(
    dto: CreateVoucherDto,
    actor: AccessTokenPayload,
  ): Promise<VoucherWithEntries> {
    const schoolId = actor.schoolId;
    const date = parseDate(dto.date);
    const entries = toDraftEntries(dto.entries);

    await this.assertDateAcceptable(schoolId, date);
    await this.assertValid(schoolId, dto.type, entries);

    if (dto.post) {
      await this.assertPermission(
        actor,
        'voucher.post',
        'Posting a voucher requires voucher.post — save it as a draft instead',
      );
      await this.assertCashNotNegative(schoolId, entries, date);
    }

    const verdict = await this.periods.resolvePeriodFor(schoolId, date);
    const narration = verdict.note
      ? `${dto.narration.trim()} — ${verdict.note}`
      : dto.narration.trim();

    const created = await this.vouchers.withTransaction(async (tx) => {
      const voucherNo = await this.nextVoucherNo(schoolId, dto.type, date, tx);
      return this.vouchers.create(
        {
          schoolId,
          voucherNo,
          type: dto.type,
          source: VoucherSource.MANUAL,
          status: dto.post ? VoucherStatus.POSTED : VoucherStatus.DRAFT,
          date,
          narration,
          reference: dto.reference?.trim() || null,
          attachmentUrl: dto.attachmentUrl?.trim() || null,
          fiscalPeriodId: verdict.period?.id ?? null,
          postedBy: dto.post ? actor.sub : null,
          postedAt: dto.post ? new Date() : null,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        entries.map((entry, index) => entryRow(schoolId, entry, index)),
        tx,
      );
    });

    this.auditContext.set({
      entityType: 'Voucher',
      entityId: created.id,
      newValues: {
        voucherNo: created.voucherNo,
        type: created.type,
        status: created.status,
        date: dto.date,
        lines: entries.length,
      },
    });

    return this.getDetail(created.id, schoolId);
  }

  /**
   * Edit a DRAFT. A POSTED voucher is refused here by design (roadmap
   * §6) — the correction path is `cancel()`, which leaves both documents
   * standing. An auto-posted voucher is refused even as a draft: it is
   * the machine's record of a real payment, and hand-editing it would
   * make the ledger disagree with the receipt the payer holds.
   */
  async update(
    id: string,
    dto: UpdateVoucherDto,
    actor: AccessTokenPayload,
  ): Promise<VoucherWithEntries> {
    const schoolId = actor.schoolId;
    const voucher = await this.getDetail(id, schoolId);
    this.assertEditable(voucher);

    const type = dto.type ?? voucher.type;
    const date = dto.date ? parseDate(dto.date) : voucher.date;
    const entries = dto.entries
      ? toDraftEntries(dto.entries)
      : voucher.entries.map((entry) => ({
          accountId: entry.accountId,
          debit: Number(entry.debit),
          credit: Number(entry.credit),
          narration: entry.narration,
        }));

    if (dto.date) await this.assertDateAcceptable(schoolId, date);
    await this.assertValid(schoolId, type, entries);

    const verdict = await this.periods.resolvePeriodFor(schoolId, date);

    await this.vouchers.withTransaction(async (tx) => {
      await this.vouchers.update(
        id,
        {
          type,
          date,
          ...(dto.narration ? { narration: dto.narration.trim() } : {}),
          ...(dto.reference !== undefined
            ? { reference: dto.reference?.trim() || null }
            : {}),
          ...(dto.attachmentUrl !== undefined
            ? { attachmentUrl: dto.attachmentUrl?.trim() || null }
            : {}),
          fiscalPeriodId: verdict.period?.id ?? null,
          updatedBy: actor.sub,
        },
        tx,
      );
      if (dto.entries) {
        await this.vouchers.replaceEntries(
          id,
          entries.map((entry, index) => entryRow(schoolId, entry, index)),
          tx,
        );
      }
    });

    this.auditContext.set({
      entityType: 'Voucher',
      entityId: id,
      oldValues: { date: isoDate(voucher.date), lines: voucher.entries.length },
      newValues: { date: isoDate(date), lines: entries.length },
    });

    return this.getDetail(id, schoolId);
  }

  /** Post a draft. The last point at which anything may still be refused. */
  async post(
    id: string,
    actor: AccessTokenPayload,
  ): Promise<VoucherWithEntries> {
    const schoolId = actor.schoolId;
    const voucher = await this.getDetail(id, schoolId);

    if (voucher.status === VoucherStatus.POSTED) {
      throw new ConflictException(`${voucher.voucherNo} is already posted`);
    }
    if (voucher.status === VoucherStatus.CANCELLED) {
      throw new ConflictException(
        `${voucher.voucherNo} is cancelled — raise a new voucher`,
      );
    }

    const entries = voucher.entries.map((entry) => ({
      accountId: entry.accountId,
      debit: Number(entry.debit),
      credit: Number(entry.credit),
      narration: entry.narration,
    }));

    // Re-validated at post time, not only at save time: the accounts a
    // draft references may have been deactivated or turned into headings
    // while it sat there (the M13 publish-re-runs-the-engine rule).
    await this.assertValid(schoolId, voucher.type, entries);
    await this.assertCashNotNegative(schoolId, entries, voucher.date);

    const verdict = await this.periods.resolvePeriodFor(schoolId, voucher.date);

    await this.vouchers.update(id, {
      status: VoucherStatus.POSTED,
      postedBy: actor.sub,
      postedAt: new Date(),
      fiscalPeriodId: verdict.period?.id ?? null,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'Voucher',
      entityId: id,
      oldValues: { status: VoucherStatus.DRAFT },
      newValues: { status: VoucherStatus.POSTED, voucherNo: voucher.voucherNo },
    });

    return this.getDetail(id, schoolId);
  }

  /**
   * Cancel a voucher.
   *
   * A DRAFT is simply removed — nothing has been reported yet. A POSTED
   * one is **never** removed: it is marked CANCELLED and a mirror-image
   * reversal voucher is written, so the ledger keeps both sides and the
   * trial balance is unchanged in aggregate while both documents remain
   * individually inspectable. That is the roadmap §6 rule and the
   * project-wide "published artifacts are immutable" rule in one.
   */
  async cancel(
    id: string,
    dto: CancelVoucherDto,
    actor: AccessTokenPayload,
  ): Promise<{ voucher: VoucherWithEntries; reversal: Voucher | null }> {
    const schoolId = actor.schoolId;
    const voucher = await this.getDetail(id, schoolId);

    if (voucher.status === VoucherStatus.CANCELLED) {
      throw new ConflictException(`${voucher.voucherNo} is already cancelled`);
    }

    if (voucher.status === VoucherStatus.DRAFT) {
      await this.vouchers.softDelete(id);
      this.auditContext.set({
        entityType: 'Voucher',
        entityId: id,
        oldValues: {
          status: VoucherStatus.DRAFT,
          voucherNo: voucher.voucherNo,
        },
        newValues: { deleted: true, reason: dto.reason },
      });
      return { voucher, reversal: null };
    }

    const reversedEntries = reverseEntries(
      voucher.entries.map((entry) => ({
        accountId: entry.accountId,
        debit: Number(entry.debit),
        credit: Number(entry.credit),
        narration: entry.narration,
      })),
    );

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    // The reversal is dated TODAY, not on the original's date: back-dating
    // it into a reported (possibly closed) period would silently restate a
    // month the school has already signed off.
    const verdict = await this.periods.resolvePeriodFor(schoolId, today);
    const type = reversalType(voucher.type);

    const reversal = await this.vouchers.withTransaction(async (tx) => {
      const voucherNo = await this.nextVoucherNo(schoolId, type, today, tx);
      const created = await this.vouchers.create(
        {
          schoolId,
          voucherNo,
          type,
          // A reversal inherits the source of what it reverses, so the
          // fees ledger still shows the pair as one story — and it needs
          // its own `source_ref` to satisfy `chk_vouchers_source_ref_shape`.
          source: voucher.source,
          sourceRef:
            voucher.source === VoucherSource.MANUAL
              ? null
              : `reversal:${voucher.id}`,
          status: VoucherStatus.POSTED,
          date: today,
          narration: `Reversal of ${voucher.voucherNo} — ${dto.reason.trim()}`,
          reference: voucher.reference,
          fiscalPeriodId: verdict.period?.id ?? null,
          reversalOfVoucherId: voucher.id,
          postedBy: actor.sub,
          postedAt: new Date(),
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        reversedEntries.map((entry, index) => entryRow(schoolId, entry, index)),
        tx,
      );

      await this.vouchers.update(
        id,
        {
          status: VoucherStatus.CANCELLED,
          cancelledBy: actor.sub,
          cancelledAt: new Date(),
          cancelReason: dto.reason.trim(),
          updatedBy: actor.sub,
        },
        tx,
      );

      return created;
    });

    this.auditContext.set({
      entityType: 'Voucher',
      entityId: id,
      oldValues: { status: VoucherStatus.POSTED, voucherNo: voucher.voucherNo },
      newValues: {
        status: VoucherStatus.CANCELLED,
        reason: dto.reason,
        reversalVoucherNo: reversal.voucherNo,
      },
    });

    return { voucher: await this.getDetail(id, schoolId), reversal };
  }

  // ── the auto-posting entry point ────────────────────────────────────

  /**
   * Write a machine-raised voucher, idempotently.
   *
   * `sourceRef` is checked here AND enforced by
   * `uq_vouchers_source_ref` — the query is the fast path that returns
   * the existing voucher on a replay, the index is what holds under two
   * concurrent callbacks. A unique violation is therefore an expected
   * outcome, not an error: it means somebody else won the race, and the
   * right answer is to return their voucher.
   */
  async postAuto(input: AutoVoucherInput): Promise<Voucher | null> {
    const existing = await this.vouchers.findBySourceRef(
      input.sourceRef,
      input.schoolId,
    );
    if (existing) return existing;

    const config = await this.settings.load(input.schoolId);
    const problems = await this.problemsFor(
      input.schoolId,
      input.type,
      input.entries,
    );
    if (hasProblems(problems)) {
      // An auto-post must never take the fee collection down with it —
      // the M07 rule that delivery may not block a mutation, applied to
      // bookkeeping. The payment is already recorded; the voucher is
      // reported and retryable.
      this.logger.error(
        `Auto-posting ${input.sourceRef} refused: ${firstProblemMessage(problems)}`,
      );
      return null;
    }

    const verdict = await this.periods.resolvePeriodFor(
      input.schoolId,
      input.date,
    );
    const narration = verdict.note
      ? `${input.narration} — ${verdict.note}`
      : input.narration;

    try {
      return await this.vouchers.withTransaction(async (tx) => {
        const voucherNo = await this.nextVoucherNo(
          input.schoolId,
          input.type,
          input.date,
          tx,
        );
        return this.vouchers.create(
          {
            schoolId: input.schoolId,
            voucherNo,
            type: input.type,
            source: input.source,
            sourceRef: input.sourceRef,
            status: config.autoPostAsDraft
              ? VoucherStatus.DRAFT
              : VoucherStatus.POSTED,
            date: input.date,
            narration,
            reference: input.reference ?? null,
            fiscalPeriodId: verdict.period?.id ?? null,
            postedBy: config.autoPostAsDraft ? null : (input.actorId ?? null),
            postedAt: config.autoPostAsDraft ? null : new Date(),
            createdBy: input.actorId ?? null,
            updatedBy: input.actorId ?? null,
          },
          input.entries.map((entry, index) =>
            entryRow(input.schoolId, entry, index),
          ),
          tx,
        );
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Lost the race — the other writer's voucher IS the answer.
        return this.vouchers.findBySourceRef(input.sourceRef, input.schoolId);
      }
      throw error;
    }
  }

  // ── internals ───────────────────────────────────────────────────────

  private assertEditable(voucher: VoucherWithEntries): void {
    if (voucher.status === VoucherStatus.POSTED) {
      throw new ConflictException(
        `${voucher.voucherNo} is posted and cannot be edited — cancel it, which writes a reversal, and raise a corrected voucher`,
      );
    }
    if (voucher.status === VoucherStatus.CANCELLED) {
      throw new ConflictException(`${voucher.voucherNo} is cancelled`);
    }
    if (voucher.source !== VoucherSource.MANUAL) {
      throw new ConflictException(
        `${voucher.voucherNo} was raised automatically from ${voucher.source} and may not be hand-edited — cancel it if it is wrong`,
      );
    }
  }

  private async problemsFor(
    schoolId: string,
    type: VoucherType,
    entries: DraftEntry[],
  ): Promise<VoucherProblems> {
    const ids = [...new Set(entries.map((entry) => entry.accountId))];
    const rows = await this.accounts.findAllForSchool(schoolId);
    const relevant = rows.filter((account) => ids.includes(account.id));

    const facts = new Map<string, AccountFacts>(
      relevant.map((account) => [
        account.id,
        {
          id: account.id,
          isGroup: account.isGroup,
          isActive: account.isActive,
          code: account.code,
          name: account.name,
        },
      ]),
    );
    const types = new Map<string, string>(
      relevant.map((account) => [account.id, account.type]),
    );

    return validateVoucher({
      type,
      entries,
      accounts: facts,
      accountTypes: types,
    });
  }

  private async assertValid(
    schoolId: string,
    type: VoucherType,
    entries: DraftEntry[],
  ): Promise<void> {
    const problems = await this.problemsFor(schoolId, type, entries);
    if (hasProblems(problems)) {
      throw new ConflictException({
        message: firstProblemMessage(problems),
        details: problems,
      });
    }
  }

  /**
   * Roadmap §7: a voucher may not be dated further into the future than
   * `accounting.future_voucher_days`. Default 0 — a school records what
   * happened, not what it expects to happen.
   */
  private async assertDateAcceptable(
    schoolId: string,
    date: Date,
  ): Promise<void> {
    const config = await this.settings.load(schoolId);
    const limit = new Date();
    limit.setUTCHours(0, 0, 0, 0);
    limit.setUTCDate(limit.getUTCDate() + config.futureDays);
    if (date > limit) {
      throw new BadRequestException(
        config.futureDays === 0
          ? `A voucher cannot be dated in the future (${isoDate(date)})`
          : `A voucher may be dated at most ${config.futureDays} day(s) ahead — ${isoDate(date)} is beyond that`,
      );
    }
  }

  /**
   * Roadmap §6: "Cash account can't go negative (setting-toggleable
   * hard/soft check)". A physical cash box cannot hold less than nothing,
   * so a negative balance means a missing receipt — but a school
   * mid-adoption often has exactly that, which is why the default is a
   * warning in the log rather than a refusal.
   */
  private async assertCashNotNegative(
    schoolId: string,
    entries: DraftEntry[],
    date: Date,
  ): Promise<void> {
    const config = await this.settings.load(schoolId);
    if (config.cashNegative === 'OFF') return;

    const cashIds = (await this.accounts.findAllForSchool(schoolId))
      .filter((account) => account.type === 'CASH')
      .map((account) => account.id);
    const touched = entries.filter((entry) =>
      cashIds.includes(entry.accountId),
    );
    if (touched.length === 0) return;

    const totals = await this.vouchers.sumByAccount({ schoolId, to: date });
    const openings = new Map(
      (await this.accounts.findAllForSchool(schoolId)).map((account) => [
        account.id,
        Number(account.openingBalance),
      ]),
    );

    for (const accountId of new Set(touched.map((entry) => entry.accountId))) {
      const posted = totals.get(accountId) ?? { debit: 0, credit: 0 };
      const delta = touched
        .filter((entry) => entry.accountId === accountId)
        .reduce((sum, entry) => money(sum + entry.debit - entry.credit), 0);
      const balance = money(
        (openings.get(accountId) ?? 0) +
          signedMovement('ASSET', posted.debit, posted.credit) +
          delta,
      );
      if (balance < 0) {
        const message = `This voucher would take a cash account to ${balance.toFixed(2)} — a cash box cannot hold less than nothing`;
        if (config.cashNegative === 'HARD')
          throw new ConflictException(message);
        this.logger.warn(`${message} (school ${schoolId})`);
      }
    }
  }

  private async nextVoucherNo(
    schoolId: string,
    type: VoucherType,
    date: Date,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const [config, school] = await Promise.all([
      this.settings.load(schoolId),
      this.schools.findByIdOrFail(schoolId),
    ]);
    // One counter per type per year, so DV/CV/JV/CN each run 1, 2, 3…
    // and a school's cash book reads the way a paper one does.
    return this.sequences.nextDocumentNumber({
      schoolId,
      counterKey: `voucher:${type}:${date.getUTCFullYear()}`,
      pattern: config.voucherPatterns[type],
      schoolCode: school.code,
      date,
      tx,
    });
  }

  private async assertPermission(
    actor: AccessTokenPayload,
    code: string,
    message: string,
  ): Promise<void> {
    if (actor.userType === UserType.SUPER_ADMIN) return;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    if (!codes.includes(code)) throw new ForbiddenException(message);
  }
}

function toDraftEntries(
  entries: Array<{
    accountId: string;
    debit: number;
    credit: number;
    narration?: string;
  }>,
): DraftEntry[] {
  return entries.map((entry) => ({
    accountId: entry.accountId,
    debit: money(entry.debit),
    credit: money(entry.credit),
    narration: entry.narration ?? null,
  }));
}

function entryRow(
  schoolId: string,
  entry: DraftEntry,
  index: number,
): Omit<Prisma.VoucherEntryUncheckedCreateInput, 'voucherId'> {
  return {
    schoolId,
    accountId: entry.accountId,
    debit: money(entry.debit),
    credit: money(entry.credit),
    narration: entry.narration ?? null,
    displayOrder: index,
  };
}
