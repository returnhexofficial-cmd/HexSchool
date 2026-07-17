import { Injectable } from '@nestjs/common';
import { Prisma, TeacherDocument } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/** Mirrors staff_documents: hard-deleted along with the S3 object. */
@Injectable()
export class TeacherDocumentsRepository extends BaseRepository<
  TeacherDocument,
  Prisma.TeacherDocumentWhereInput,
  Prisma.TeacherDocumentUncheckedCreateInput,
  Prisma.TeacherDocumentUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.teacherDocument, 'Teacher document', {
      softDeletable: false,
    });
  }

  async listForTeacher(teacherId: string): Promise<TeacherDocument[]> {
    return this.prisma.teacherDocument.findMany({
      where: { teacherId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async hardDelete(id: string): Promise<void> {
    await this.prisma.teacherDocument.delete({ where: { id } });
  }
}
