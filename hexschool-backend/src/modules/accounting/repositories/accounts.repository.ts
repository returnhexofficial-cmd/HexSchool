import { Injectable } from '@nestjs/common';
import { Account, AccountGroup, AccountType, Prisma } from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

export interface AccountFilter {
  group?: AccountGroup;
  type?: AccountType;
  parentId?: string | null;
  activeOnly?: boolean;
  /** Leaves only — what a voucher's account picker offers. */
  postableOnly?: boolean;
  search?: string;
}

@Injectable()
export class AccountsRepository extends BaseRepository<
  Account,
  Prisma.AccountWhereInput,
  Prisma.AccountUncheckedCreateInput,
  Prisma.AccountUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => (client as PrismaService).account, 'Account', {
      softDeletable: true,
      schoolScoped: true,
    });
  }

  private filterWhere(
    schoolId: string,
    filter: AccountFilter,
  ): Prisma.AccountWhereInput {
    return {
      schoolId,
      deletedAt: null,
      ...(filter.group ? { group: filter.group } : {}),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.parentId !== undefined ? { parentId: filter.parentId } : {}),
      ...(filter.activeOnly ? { isActive: true } : {}),
      ...(filter.postableOnly ? { isGroup: false, isActive: true } : {}),
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search, mode: 'insensitive' } },
              { code: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  /**
   * Every live account of the school. The tree is built in the engine, so
   * this is one flat query rather than a recursive walk — a school's COA
   * is a few hundred rows at most, and loading it whole means the cycle
   * check and the code suggester can see the graph they are reasoning about.
   */
  async findAllForSchool(
    schoolId: string,
    filter: AccountFilter = {},
  ): Promise<Account[]> {
    return this.prisma.account.findMany({
      where: this.filterWhere(schoolId, filter),
      orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
    });
  }

  async findByCode(
    code: string,
    schoolId: string,
    excludeId?: string,
  ): Promise<Account | null> {
    return this.prisma.account.findFirst({
      where: {
        schoolId,
        code,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  /** The system accounts auto-posting resolves by slug-free lookup. */
  async findSystem(schoolId: string): Promise<Account[]> {
    return this.prisma.account.findMany({
      where: { schoolId, deletedAt: null, isSystem: true },
    });
  }

  async countChildren(accountId: string): Promise<number> {
    return this.prisma.account.count({
      where: { parentId: accountId, deletedAt: null },
    });
  }

  /** Whether anything was ever posted to this account — the delete guard. */
  async countEntries(accountId: string): Promise<number> {
    return this.prisma.voucherEntry.count({ where: { accountId } });
  }

  async countBudgets(accountId: string): Promise<number> {
    return this.prisma.budget.count({
      where: { accountId, deletedAt: null },
    });
  }

  async countPostingMaps(accountId: string): Promise<number> {
    return this.prisma.postingMap.count({
      where: { accountId, deletedAt: null },
    });
  }

  async createMany(
    data: Prisma.AccountUncheckedCreateInput[],
    tx?: PrismaClientLike,
  ): Promise<void> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.account.createMany({ data });
  }
}
