import { Injectable } from '@nestjs/common';
import { FeeHead, Prisma } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/** Fee-head master (M06 structure-master pattern: soft-deleted, name-unique). */
@Injectable()
export class FeeHeadsRepository extends BaseRepository<
  FeeHead,
  Prisma.FeeHeadWhereInput,
  Prisma.FeeHeadUncheckedCreateInput,
  Prisma.FeeHeadUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.feeHead, 'FeeHead');
  }

  async findAllOrdered(schoolId: string): Promise<FeeHead[]> {
    return this.prisma.feeHead.findMany({
      where: { schoolId, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /** Case-insensitive name clash among live rows. */
  async findByName(
    schoolId: string,
    name: string,
    excludeId?: string,
  ): Promise<FeeHead | null> {
    return this.prisma.feeHead.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  /** Structures referencing this head — the delete guard. */
  async countStructures(feeHeadId: string): Promise<number> {
    return this.prisma.feeStructure.count({
      where: { feeHeadId, deletedAt: null },
    });
  }

  /** Invoice lines referencing this head — a billed head is history. */
  async countInvoiceItems(feeHeadId: string): Promise<number> {
    return this.prisma.invoiceItem.count({ where: { feeHeadId } });
  }
}
