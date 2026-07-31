import { Injectable } from '@nestjs/common';
import {
  Prisma,
  StockVerification,
  StockVerificationStatus,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

@Injectable()
export class StockVerificationsRepository extends BaseRepository<
  StockVerification,
  Prisma.StockVerificationWhereInput,
  Prisma.StockVerificationUncheckedCreateInput,
  Prisma.StockVerificationUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.stockVerification, 'StockVerification');
  }

  async findMany(
    schoolId: string,
    page: number,
    limit: number,
  ): Promise<{ rows: StockVerification[]; total: number }> {
    const where: Prisma.StockVerificationWhereInput = {
      schoolId,
      deletedAt: null,
    };
    const [rows, total] = await Promise.all([
      this.prisma.stockVerification.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stockVerification.count({ where }),
    ]);
    return { rows, total };
  }

  /** The one that is open, if any — `uq_stock_verifications_open` holds. */
  async findOpen(schoolId: string): Promise<StockVerification | null> {
    return this.prisma.stockVerification.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        status: StockVerificationStatus.IN_PROGRESS,
      },
    });
  }

  async scans(
    verificationId: string,
    tx?: PrismaClientLike,
  ): Promise<Array<{ copyId: string | null; accessionNo: string }>> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.stockVerificationScan.findMany({
      where: { verificationId },
      select: { copyId: true, accessionNo: true },
      orderBy: { scannedAt: 'asc' },
    });
  }

  /**
   * Record a scan. Scanning the same shelf twice is normal, so a repeat
   * of a resolved copy is silently ignored — `skipDuplicates` against
   * `uq_stock_verification_scans_copy`. An *unresolved* code has no id
   * to be unique on, so it is de-duplicated by the engine at close.
   */
  async addScan(
    verificationId: string,
    copyId: string | null,
    accessionNo: string,
  ): Promise<void> {
    await this.prisma.stockVerificationScan.createMany({
      data: [{ verificationId, copyId, accessionNo }],
      skipDuplicates: true,
    });
  }

  async scanCount(verificationId: string): Promise<number> {
    return this.prisma.stockVerificationScan.count({
      where: { verificationId },
    });
  }
}
