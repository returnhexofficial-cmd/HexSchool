import { Injectable } from '@nestjs/common';
import { GradePoint, GradingSystem, Prisma } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

export type GradingSystemWithPoints = GradingSystem & {
  gradePoints: GradePoint[];
};

@Injectable()
export class GradingSystemsRepository extends BaseRepository<
  GradingSystem,
  Prisma.GradingSystemWhereInput,
  Prisma.GradingSystemUncheckedCreateInput,
  Prisma.GradingSystemUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.gradingSystem, 'GradingSystem');
  }

  async findAllWithPoints(
    schoolId: string,
  ): Promise<GradingSystemWithPoints[]> {
    return this.prisma.gradingSystem.findMany({
      where: { schoolId, deletedAt: null },
      include: { gradePoints: { orderBy: { minMark: 'desc' } } },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async findByIdWithPoints(
    id: string,
    schoolId: string,
  ): Promise<GradingSystemWithPoints | null> {
    return this.prisma.gradingSystem.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: { gradePoints: { orderBy: { minMark: 'desc' } } },
    });
  }

  /** Create system + bands in one transaction. */
  async createWithPoints(
    data: Prisma.GradingSystemUncheckedCreateInput,
    points: Array<
      Omit<Prisma.GradePointUncheckedCreateInput, 'gradingSystemId'>
    >,
  ): Promise<GradingSystemWithPoints> {
    return this.prisma.$transaction(async (tx) => {
      const system = await tx.gradingSystem.create({ data });
      await tx.gradePoint.createMany({
        data: points.map((p) => ({ ...p, gradingSystemId: system.id })),
      });
      return await tx.gradingSystem.findUniqueOrThrow({
        where: { id: system.id },
        include: { gradePoints: { orderBy: { minMark: 'desc' } } },
      });
    });
  }

  /** Update fields and replace all bands wholesale (single transaction). */
  async updateWithPoints(
    id: string,
    data: Prisma.GradingSystemUncheckedUpdateInput,
    points:
      | Array<Omit<Prisma.GradePointUncheckedCreateInput, 'gradingSystemId'>>
      | undefined,
  ): Promise<GradingSystemWithPoints> {
    return this.prisma.$transaction(async (tx) => {
      await tx.gradingSystem.update({ where: { id }, data });
      if (points) {
        await tx.gradePoint.deleteMany({ where: { gradingSystemId: id } });
        await tx.gradePoint.createMany({
          data: points.map((p) => ({ ...p, gradingSystemId: id })),
        });
      }
      return await tx.gradingSystem.findUniqueOrThrow({
        where: { id },
        include: { gradePoints: { orderBy: { minMark: 'desc' } } },
      });
    });
  }

  /** Transactional default switch: demote current, promote target. */
  async setDefault(id: string, schoolId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.gradingSystem.updateMany({
        where: { schoolId, isDefault: true, deletedAt: null },
        data: { isDefault: false },
      });
      await tx.gradingSystem.update({
        where: { id },
        data: { isDefault: true },
      });
    });
  }
}
