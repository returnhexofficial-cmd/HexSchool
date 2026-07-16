import { Injectable } from '@nestjs/common';
import { Department, Prisma } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

@Injectable()
export class DepartmentsRepository extends BaseRepository<
  Department,
  Prisma.DepartmentWhereInput,
  Prisma.DepartmentUncheckedCreateInput,
  Prisma.DepartmentUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.department, 'Department');
  }

  /** Live subjects still pointing here (delete guard). */
  async countReferences(id: string): Promise<number> {
    return this.prisma.subject.count({
      where: { departmentId: id, deletedAt: null },
    });
  }
}
