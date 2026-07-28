import { Injectable } from '@nestjs/common';
import {
  Prisma,
  Voucher,
  VoucherSource,
  VoucherStatus,
  VoucherType,
} from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const RELATIONS = {
  entries: {
    orderBy: { displayOrder: 'asc' },
    include: {
      account: {
        select: { id: true, code: true, name: true, group: true, type: true },
      },
    },
  },
} satisfies Prisma.VoucherInclude;

export type VoucherWithEntries = Prisma.VoucherGetPayload<{
  include: typeof RELATIONS;
}>;

export interface VoucherFilter {
  type?: VoucherType;
  status?: VoucherStatus;
  source?: VoucherSource;
  from?: Date;
  to?: Date;
  accountId?: string;
  search?: string;
}

/** One movement row the ledger/book readers consume. */
export interface EntryRow {
  entryId: string;
  voucherId: string;
  voucherNo: string;
  voucherType: VoucherType;
  date: Date;
  narration: string;
  entryNarration: string | null;
  reference: string | null;
  accountId: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
}

@Injectable()
export class VouchersRepository {
  constructor(private readonly prisma: PrismaService) {}

  private where(
    schoolId: string,
    filter: VoucherFilter,
  ): Prisma.VoucherWhereInput {
    return {
      schoolId,
      deletedAt: null,
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.source ? { source: filter.source } : {}),
      ...(filter.from || filter.to
        ? {
            date: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
      ...(filter.accountId
        ? { entries: { some: { accountId: filter.accountId } } }
        : {}),
      ...(filter.search
        ? {
            OR: [
              { voucherNo: { contains: filter.search, mode: 'insensitive' } },
              { narration: { contains: filter.search, mode: 'insensitive' } },
              { reference: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  async findMany(
    schoolId: string,
    filter: VoucherFilter,
    page = 1,
    limit = 20,
  ): Promise<{ rows: VoucherWithEntries[]; total: number }> {
    const where = this.where(schoolId, filter);
    const [rows, total] = await Promise.all([
      this.prisma.voucher.findMany({
        where,
        include: RELATIONS,
        orderBy: [{ date: 'desc' }, { voucherNo: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.voucher.count({ where }),
    ]);
    return { rows, total };
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<VoucherWithEntries | null> {
    return this.prisma.voucher.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: RELATIONS,
    });
  }

  /**
   * The auto-posting idempotency probe. Backed by
   * `uq_vouchers_source_ref` — the query is the fast path, the index is
   * the guarantee under a concurrent replay.
   */
  async findBySourceRef(
    sourceRef: string,
    schoolId: string,
  ): Promise<Voucher | null> {
    return this.prisma.voucher.findFirst({
      where: {
        schoolId,
        sourceRef,
        deletedAt: null,
        status: { not: VoucherStatus.CANCELLED },
      },
    });
  }

  async create(
    data: Prisma.VoucherUncheckedCreateInput,
    entries: Array<Omit<Prisma.VoucherEntryUncheckedCreateInput, 'voucherId'>>,
    tx?: PrismaClientLike,
  ): Promise<Voucher> {
    const client = (tx ?? this.prisma) as PrismaService;
    const voucher = await client.voucher.create({ data });
    if (entries.length > 0) {
      await client.voucherEntry.createMany({
        data: entries.map((entry) => ({ ...entry, voucherId: voucher.id })),
      });
    }
    return voucher;
  }

  async update(
    id: string,
    data: Prisma.VoucherUncheckedUpdateInput,
    tx?: PrismaClientLike,
  ): Promise<Voucher> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.voucher.update({ where: { id }, data });
  }

  /**
   * Replace a draft's lines wholesale. Entries are hard-deleted (the
   * model doc explains why) so an edit cannot leave a half-updated
   * voucher that balances by accident.
   */
  async replaceEntries(
    voucherId: string,
    entries: Array<Omit<Prisma.VoucherEntryUncheckedCreateInput, 'voucherId'>>,
    tx?: PrismaClientLike,
  ): Promise<void> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.voucherEntry.deleteMany({ where: { voucherId } });
    if (entries.length > 0) {
      await client.voucherEntry.createMany({
        data: entries.map((entry) => ({ ...entry, voucherId })),
      });
    }
  }

  async softDelete(id: string, tx?: PrismaClientLike): Promise<void> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.voucher.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  // ── the reads every report is built from ────────────────────────────

  /**
   * The ledger predicate: **every voucher that was ever posted.**
   *
   * Not `status = POSTED`, which is the obvious version and is wrong.
   * Cancelling a posted voucher does not un-post it — the money moved,
   * it was reported, and the correction is the mirror-image reversal
   * that `cancel()` writes. Excluding the CANCELLED original would leave
   * only the reversal standing, and the books would then be wrong by the
   * original amount *in the opposite direction* — a cancelled 25,000
   * receipt would read as 25,000 of negative income. (Found by the M20
   * e2e suite, which asserts the three statements agree.)
   *
   * A DRAFT never carries `posted_at`, and a cancelled DRAFT is
   * soft-deleted outright, so this predicate admits exactly the
   * documents that belong in a ledger and nothing else.
   */
  async findEntries(params: {
    schoolId: string;
    from?: Date;
    to?: Date;
    accountIds?: string[];
  }): Promise<EntryRow[]> {
    const rows = await this.prisma.voucherEntry.findMany({
      where: {
        schoolId: params.schoolId,
        ...(params.accountIds ? { accountId: { in: params.accountIds } } : {}),
        voucher: {
          deletedAt: null,
          postedAt: { not: null },
          ...(params.from || params.to
            ? {
                date: {
                  ...(params.from ? { gte: params.from } : {}),
                  ...(params.to ? { lte: params.to } : {}),
                },
              }
            : {}),
        },
      },
      include: {
        voucher: {
          select: {
            id: true,
            voucherNo: true,
            type: true,
            date: true,
            narration: true,
            reference: true,
          },
        },
      },
      orderBy: [
        { voucher: { date: 'asc' } },
        { voucher: { voucherNo: 'asc' } },
      ],
    });

    return rows.map((row) => ({
      entryId: row.id,
      voucherId: row.voucher.id,
      voucherNo: row.voucher.voucherNo,
      voucherType: row.voucher.type,
      date: row.voucher.date,
      narration: row.voucher.narration,
      entryNarration: row.narration,
      reference: row.voucher.reference,
      accountId: row.accountId,
      debit: row.debit,
      credit: row.credit,
    }));
  }

  /**
   * Grouped debit/credit per account for a window — one query, not N.
   * Same "ever posted" predicate as `findEntries`; see its doc.
   */
  async sumByAccount(params: {
    schoolId: string;
    from?: Date;
    to?: Date;
  }): Promise<Map<string, { debit: number; credit: number }>> {
    const rows = await this.prisma.voucherEntry.groupBy({
      by: ['accountId'],
      where: {
        schoolId: params.schoolId,
        voucher: {
          deletedAt: null,
          postedAt: { not: null },
          ...(params.from || params.to
            ? {
                date: {
                  ...(params.from ? { gte: params.from } : {}),
                  ...(params.to ? { lte: params.to } : {}),
                },
              }
            : {}),
        },
      },
      _sum: { debit: true, credit: true },
    });

    return new Map(
      rows.map((row) => [
        row.accountId,
        {
          debit: Number(row._sum.debit ?? 0),
          credit: Number(row._sum.credit ?? 0),
        },
      ]),
    );
  }

  /** Draft vouchers dated in a range — the period-close guard. */
  async countDraftsInRange(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    return this.prisma.voucher.count({
      where: {
        schoolId,
        deletedAt: null,
        status: VoucherStatus.DRAFT,
        date: { gte: from, lte: to },
      },
    });
  }

  async countInPeriod(schoolId: string, periodId: string): Promise<number> {
    return this.prisma.voucher.count({
      where: { schoolId, fiscalPeriodId: periodId, deletedAt: null },
    });
  }

  async withTransaction<R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
  ): Promise<R> {
    return this.prisma.$transaction(fn);
  }
}
