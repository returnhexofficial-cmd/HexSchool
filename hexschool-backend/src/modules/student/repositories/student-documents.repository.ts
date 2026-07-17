import { Injectable } from '@nestjs/common';
import { Prisma, StudentDocument } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/** Hard-deleted with their S3 object (staff/teacher documents pattern). */
@Injectable()
export class StudentDocumentsRepository extends BaseRepository<
  StudentDocument,
  Prisma.StudentDocumentWhereInput,
  Prisma.StudentDocumentUncheckedCreateInput,
  Prisma.StudentDocumentUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.studentDocument, 'StudentDocument', {
      softDeletable: false,
    });
  }

  async listForStudent(studentId: string): Promise<StudentDocument[]> {
    return this.prisma.studentDocument.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async hardDelete(id: string): Promise<void> {
    await this.prisma.studentDocument.delete({ where: { id } });
  }
}
