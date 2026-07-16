import { Injectable } from '@nestjs/common';
import { Prisma, SchoolClass } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

@Injectable()
export class ClassesRepository extends BaseRepository<
  SchoolClass,
  Prisma.SchoolClassWhereInput,
  Prisma.SchoolClassUncheckedCreateInput,
  Prisma.SchoolClassUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.schoolClass, 'Class');
  }

  /** Live sections + curriculum rows still pointing here (delete guard). */
  async countReferences(id: string): Promise<number> {
    const [sections, classSubjects] = await Promise.all([
      this.prisma.section.count({ where: { classId: id, deletedAt: null } }),
      this.prisma.classSubject.count({ where: { classId: id } }),
    ]);
    return sections + classSubjects;
  }
}
