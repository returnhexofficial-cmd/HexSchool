import { Injectable } from '@nestjs/common';
import {
  Budget,
  FiscalPeriod,
  FiscalPeriodStatus,
  PostingMap,
  PostingMapKind,
  Prisma,
} from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

export type PostingMapWithAccount = Prisma.PostingMapGetPayload<{
  include: {
    account: {
      select: { id: true; code: true; name: true; group: true; type: true };
    };
  };
}>;

export type BudgetWithAccount = Prisma.BudgetGetPayload<{
  include: {
    account: { select: { id: true; code: true; name: true; group: true } };
  };
}>;

/**
 * The three small configuration tables of the module — the posting map,
 * budgets and fiscal periods — in one repository.
 *
 * They are grouped rather than split three ways because they are read
 * together on nearly every path (a voucher post asks the period, an
 * auto-post asks the map, a variance report asks the budget) and none of
 * them carries enough query surface to justify its own class. The
 * Controller → Service → Repository direction is unchanged.
 */
@Injectable()
export class AccountingConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── posting map ─────────────────────────────────────────────────────

  async findMappings(
    schoolId: string,
    kind?: PostingMapKind,
  ): Promise<PostingMapWithAccount[]> {
    return this.prisma.postingMap.findMany({
      where: { schoolId, deletedAt: null, ...(kind ? { kind } : {}) },
      include: {
        account: {
          select: { id: true, code: true, name: true, group: true, type: true },
        },
      },
      orderBy: [{ kind: 'asc' }, { refKey: 'asc' }],
    });
  }

  async findMapping(
    schoolId: string,
    kind: PostingMapKind,
    refKey: string,
  ): Promise<PostingMap | null> {
    return this.prisma.postingMap.findFirst({
      where: { schoolId, kind, refKey, deletedAt: null },
    });
  }

  /**
   * Upsert by (kind, refKey). Written as find-then-write rather than a
   * Prisma `upsert` because the uniqueness that backs it is a PARTIAL
   * index (live rows only), which Prisma cannot target as a unique input.
   */
  async setMapping(
    params: {
      schoolId: string;
      kind: PostingMapKind;
      refKey: string;
      accountId: string;
      actorId: string;
    },
    tx?: PrismaClientLike,
  ): Promise<PostingMap> {
    const client = (tx ?? this.prisma) as PrismaService;
    const existing = await client.postingMap.findFirst({
      where: {
        schoolId: params.schoolId,
        kind: params.kind,
        refKey: params.refKey,
        deletedAt: null,
      },
    });
    if (existing) {
      return client.postingMap.update({
        where: { id: existing.id },
        data: { accountId: params.accountId, updatedBy: params.actorId },
      });
    }
    return client.postingMap.create({
      data: {
        schoolId: params.schoolId,
        kind: params.kind,
        refKey: params.refKey,
        accountId: params.accountId,
        createdBy: params.actorId,
        updatedBy: params.actorId,
      },
    });
  }

  async clearMapping(
    schoolId: string,
    kind: PostingMapKind,
    refKey: string,
  ): Promise<void> {
    await this.prisma.postingMap.updateMany({
      where: { schoolId, kind, refKey, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  // ── budgets ─────────────────────────────────────────────────────────

  async findBudgets(
    schoolId: string,
    sessionId: string,
  ): Promise<BudgetWithAccount[]> {
    return this.prisma.budget.findMany({
      where: { schoolId, sessionId, deletedAt: null },
      include: {
        account: { select: { id: true, code: true, name: true, group: true } },
      },
      orderBy: [{ account: { code: 'asc' } }, { month: 'asc' }],
    });
  }

  async findBudgetById(id: string, schoolId: string): Promise<Budget | null> {
    return this.prisma.budget.findFirst({
      where: { id, schoolId, deletedAt: null },
    });
  }

  async findBudgetIdentity(params: {
    schoolId: string;
    sessionId: string;
    accountId: string;
    month: number | null;
    excludeId?: string;
  }): Promise<Budget | null> {
    return this.prisma.budget.findFirst({
      where: {
        schoolId: params.schoolId,
        sessionId: params.sessionId,
        accountId: params.accountId,
        month: params.month,
        deletedAt: null,
        ...(params.excludeId ? { id: { not: params.excludeId } } : {}),
      },
    });
  }

  async createBudget(data: Prisma.BudgetUncheckedCreateInput): Promise<Budget> {
    return this.prisma.budget.create({ data });
  }

  async updateBudget(
    id: string,
    data: Prisma.BudgetUncheckedUpdateInput,
  ): Promise<Budget> {
    return this.prisma.budget.update({ where: { id }, data });
  }

  async softDeleteBudget(id: string): Promise<void> {
    await this.prisma.budget.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  // ── fiscal periods ──────────────────────────────────────────────────

  async findPeriods(schoolId: string): Promise<FiscalPeriod[]> {
    return this.prisma.fiscalPeriod.findMany({
      where: { schoolId, deletedAt: null },
      orderBy: { startDate: 'desc' },
    });
  }

  async findPeriodById(
    id: string,
    schoolId: string,
  ): Promise<FiscalPeriod | null> {
    return this.prisma.fiscalPeriod.findFirst({
      where: { id, schoolId, deletedAt: null },
    });
  }

  /** The period a date falls in, if any. */
  async findPeriodForDate(
    schoolId: string,
    date: Date,
  ): Promise<FiscalPeriod | null> {
    return this.prisma.fiscalPeriod.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        startDate: { lte: date },
        endDate: { gte: date },
      },
    });
  }

  /** The earliest OPEN period on or after a date — the §8 backdate target. */
  async findEarliestOpenPeriodFrom(
    schoolId: string,
    date: Date,
  ): Promise<FiscalPeriod | null> {
    return this.prisma.fiscalPeriod.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        status: FiscalPeriodStatus.OPEN,
        endDate: { gte: date },
      },
      orderBy: { startDate: 'asc' },
    });
  }

  /** Any live period whose range overlaps [from, to] — the M05 rule. */
  async findOverlappingPeriod(params: {
    schoolId: string;
    from: Date;
    to: Date;
    excludeId?: string;
  }): Promise<FiscalPeriod | null> {
    return this.prisma.fiscalPeriod.findFirst({
      where: {
        schoolId: params.schoolId,
        deletedAt: null,
        startDate: { lte: params.to },
        endDate: { gte: params.from },
        ...(params.excludeId ? { id: { not: params.excludeId } } : {}),
      },
    });
  }

  async createPeriod(
    data: Prisma.FiscalPeriodUncheckedCreateInput,
  ): Promise<FiscalPeriod> {
    return this.prisma.fiscalPeriod.create({ data });
  }

  async updatePeriod(
    id: string,
    data: Prisma.FiscalPeriodUncheckedUpdateInput,
  ): Promise<FiscalPeriod> {
    return this.prisma.fiscalPeriod.update({ where: { id }, data });
  }

  async softDeletePeriod(id: string): Promise<void> {
    await this.prisma.fiscalPeriod.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
}
