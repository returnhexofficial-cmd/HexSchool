import { Injectable } from '@nestjs/common';
import {
  InventoryHolderType,
  Prisma,
  StockIssue,
  StockIssueItem,
  StockIssueStatus,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const ISSUE_INCLUDE = {
  issuedToDept: { select: { id: true, name: true, code: true } },
  items: {
    include: {
      item: {
        select: { id: true, code: true, name: true, unit: true, type: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.StockIssueInclude;

export type IssueWithLines = Prisma.StockIssueGetPayload<{
  include: typeof ISSUE_INCLUDE;
}>;

@Injectable()
export class StockIssuesRepository extends BaseRepository<
  StockIssue,
  Prisma.StockIssueWhereInput,
  Prisma.StockIssueUncheckedCreateInput,
  Prisma.StockIssueUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.stockIssue, 'StockIssue');
  }

  async findDetail(
    id: string,
    schoolId: string,
    tx?: PrismaClientLike,
  ): Promise<IssueWithLines | null> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.stockIssue.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: ISSUE_INCLUDE,
    });
  }

  async findManyLive(
    schoolId: string,
    filter: {
      status?: StockIssueStatus;
      issuedToType?: InventoryHolderType;
      departmentId?: string;
      from?: Date;
      to?: Date;
    } = {},
  ): Promise<IssueWithLines[]> {
    return this.prisma.stockIssue.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.issuedToType ? { issuedToType: filter.issuedToType } : {}),
        ...(filter.departmentId ? { issuedToDeptId: filter.departmentId } : {}),
        ...(filter.from || filter.to
          ? {
              issueDate: {
                ...(filter.from ? { gte: filter.from } : {}),
                ...(filter.to ? { lte: filter.to } : {}),
              },
            }
          : {}),
      },
      include: ISSUE_INCLUDE,
      orderBy: [{ issueDate: 'desc' }, { issueNo: 'desc' }],
    });
  }

  async createLines(
    lines: Prisma.StockIssueItemUncheckedCreateInput[],
    tx: PrismaClientLike,
  ): Promise<void> {
    const client = tx as PrismaService;
    if (lines.length > 0) {
      await client.stockIssueItem.createMany({ data: lines });
    }
  }

  async linesFor(
    issueId: string,
    tx?: PrismaClientLike,
  ): Promise<StockIssueItem[]> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.stockIssueItem.findMany({
      where: { issueId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Move `returned_qty` up by a delta rather than setting it, so two
   * partial returns of the same line cannot overwrite each other with a
   * value each computed from the row it read. `chk_stock_issue_items_
   * returned` is what refuses the result if the arithmetic still ends up
   * past `qty`.
   */
  async addReturned(
    issueItemId: string,
    delta: number,
    tx: PrismaClientLike,
  ): Promise<void> {
    const client = tx as PrismaService;
    await client.stockIssueItem.update({
      where: { id: issueItemId },
      data: { returnedQty: { increment: delta } },
    });
  }

  async setStatus(
    id: string,
    status: StockIssueStatus,
    actorId: string | null,
    tx: PrismaClientLike,
  ): Promise<void> {
    const client = tx as PrismaService;
    await client.stockIssue.update({
      where: { id },
      data: { status, updatedBy: actorId },
    });
  }
}
