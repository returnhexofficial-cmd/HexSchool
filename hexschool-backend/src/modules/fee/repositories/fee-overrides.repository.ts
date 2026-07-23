import { Injectable } from '@nestjs/common';
import { Prisma, StudentFeeOverride } from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const RELATIONS = {
  feeHead: { select: { id: true, name: true, code: true } },
  enrollment: {
    select: {
      id: true,
      rollNo: true,
      classId: true,
      sectionId: true,
      student: {
        select: { id: true, studentUid: true, firstName: true, lastName: true },
      },
    },
  },
} satisfies Prisma.StudentFeeOverrideInclude;

export type FeeOverrideWithRelations = Prisma.StudentFeeOverrideGetPayload<{
  include: typeof RELATIONS;
}>;

/** Per-candidate concessions (discount / waiver / scholarship). */
@Injectable()
export class FeeOverridesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findForEnrollment(
    enrollmentId: string,
  ): Promise<FeeOverrideWithRelations[]> {
    return this.prisma.studentFeeOverride.findMany({
      where: { enrollmentId, deletedAt: null },
      include: RELATIONS,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Concessions in force on a given date. `valid_from`/`valid_to` are
   * open-ended when null, which is how a whole-session scholarship is
   * expressed — and how a mid-year transport opt-out is bounded.
   */
  async findEffective(
    enrollmentIds: string[],
    on: Date,
  ): Promise<StudentFeeOverride[]> {
    if (enrollmentIds.length === 0) return [];
    return this.prisma.studentFeeOverride.findMany({
      where: {
        enrollmentId: { in: enrollmentIds },
        deletedAt: null,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: on } }] },
          { OR: [{ validTo: null }, { validTo: { gte: on } }] },
        ],
      },
    });
  }

  async findById(
    id: string,
    schoolId: string,
  ): Promise<FeeOverrideWithRelations | null> {
    return this.prisma.studentFeeOverride.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: RELATIONS,
    });
  }

  async create(
    data: Prisma.StudentFeeOverrideUncheckedCreateInput,
    tx?: PrismaClientLike,
  ): Promise<StudentFeeOverride> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.studentFeeOverride.create({ data });
  }

  async update(
    id: string,
    data: Prisma.StudentFeeOverrideUncheckedUpdateInput,
  ): Promise<StudentFeeOverride> {
    return this.prisma.studentFeeOverride.update({ where: { id }, data });
  }

  async softDelete(id: string, actorId: string): Promise<void> {
    await this.prisma.studentFeeOverride.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: actorId },
    });
  }
}
