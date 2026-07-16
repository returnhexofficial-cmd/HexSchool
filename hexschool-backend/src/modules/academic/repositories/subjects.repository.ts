import { Injectable } from '@nestjs/common';
import { Prisma, Subject } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

@Injectable()
export class SubjectsRepository extends BaseRepository<
  Subject,
  Prisma.SubjectWhereInput,
  Prisma.SubjectUncheckedCreateInput,
  Prisma.SubjectUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.subject, 'Subject');
  }

  /** Curriculum rows still pointing here (delete guard; M15 adds marks). */
  async countReferences(id: string): Promise<number> {
    return this.prisma.classSubject.count({ where: { subjectId: id } });
  }
}
