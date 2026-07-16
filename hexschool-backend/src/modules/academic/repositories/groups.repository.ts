import { Injectable } from '@nestjs/common';
import { Group, Prisma } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

@Injectable()
export class GroupsRepository extends BaseRepository<
  Group,
  Prisma.GroupWhereInput,
  Prisma.GroupUncheckedCreateInput,
  Prisma.GroupUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.group, 'Group');
  }

  /** Live sections + curriculum rows still pointing here (delete guard). */
  async countReferences(id: string): Promise<number> {
    const [sections, classSubjects] = await Promise.all([
      this.prisma.section.count({ where: { groupId: id, deletedAt: null } }),
      this.prisma.classSubject.count({ where: { groupId: id } }),
    ]);
    return sections + classSubjects;
  }
}
