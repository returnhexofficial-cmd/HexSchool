import { Injectable } from '@nestjs/common';
import { Prisma, StaffDocument } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/** Hard-deleted (delete also removes the S3 object) — audit keeps history. */
@Injectable()
export class StaffDocumentsRepository extends BaseRepository<
  StaffDocument,
  Prisma.StaffDocumentWhereInput,
  Prisma.StaffDocumentUncheckedCreateInput,
  Prisma.StaffDocumentUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.staffDocument, 'Staff document', {
      softDeletable: false,
    });
  }

  async listForStaff(staffId: string): Promise<StaffDocument[]> {
    return this.prisma.staffDocument.findMany({
      where: { staffId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async hardDelete(id: string): Promise<void> {
    await this.prisma.staffDocument.delete({ where: { id } });
  }
}
