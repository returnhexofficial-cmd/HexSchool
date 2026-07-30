import { Injectable } from '@nestjs/common';
import { LearningMaterial, LearningMaterialType, Prisma } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const MATERIAL_INCLUDE = {
  class: { select: { id: true, name: true, numericLevel: true } },
  section: { select: { id: true, name: true } },
  subject: { select: { id: true, name: true, nameBn: true, code: true } },
  teacher: {
    select: { id: true, firstName: true, lastName: true, employeeId: true },
  },
} satisfies Prisma.LearningMaterialInclude;

export type MaterialWithRelations = Prisma.LearningMaterialGetPayload<{
  include: typeof MATERIAL_INCLUDE;
}>;

export interface MaterialFilter {
  sessionId?: string;
  classId?: string;
  sectionId?: string;
  subjectId?: string;
  teacherId?: string;
  type?: LearningMaterialType;
  search?: string;
}

@Injectable()
export class LearningMaterialsRepository extends BaseRepository<
  LearningMaterial,
  Prisma.LearningMaterialWhereInput,
  Prisma.LearningMaterialUncheckedCreateInput,
  Prisma.LearningMaterialUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.learningMaterial, 'LearningMaterial');
  }

  private whereFor(
    schoolId: string,
    filter: MaterialFilter,
  ): Prisma.LearningMaterialWhereInput {
    return {
      schoolId,
      deletedAt: null,
      ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
      ...(filter.classId ? { classId: filter.classId } : {}),
      ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
      ...(filter.subjectId ? { subjectId: filter.subjectId } : {}),
      ...(filter.teacherId ? { teacherId: filter.teacherId } : {}),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.search
        ? { title: { contains: filter.search, mode: 'insensitive' } }
        : {}),
    };
  }

  async findMany(
    schoolId: string,
    filter: MaterialFilter,
    page: number,
    limit: number,
  ): Promise<{ rows: MaterialWithRelations[]; total: number }> {
    const where = this.whereFor(schoolId, filter);
    const [rows, total] = await Promise.all([
      this.prisma.learningMaterial.findMany({
        where,
        include: MATERIAL_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.learningMaterial.count({ where }),
    ]);
    return { rows, total };
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<MaterialWithRelations | null> {
    return this.prisma.learningMaterial.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: MATERIAL_INCLUDE,
    });
  }

  /**
   * What one enrolled candidate may see: their class's materials, scoped
   * to their own section OR class-wide (`section_id IS NULL`).
   *
   * The NULL branch has to be written out rather than left to a
   * `sectionId: undefined` filter, because a missing filter means "every
   * section" — the opposite of what a class-wide note is. That is the
   * M06 COALESCE-index lesson in query form: a nullable scope column
   * needs the NULL case stated.
   */
  async findVisibleFor(
    schoolId: string,
    sessionId: string,
    classId: string,
    sectionId: string,
    filter: { subjectId?: string; type?: LearningMaterialType } = {},
  ): Promise<MaterialWithRelations[]> {
    return this.prisma.learningMaterial.findMany({
      where: {
        schoolId,
        deletedAt: null,
        sessionId,
        classId,
        OR: [{ sectionId }, { sectionId: null }],
        ...(filter.subjectId ? { subjectId: filter.subjectId } : {}),
        ...(filter.type ? { type: filter.type } : {}),
      },
      include: MATERIAL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }
}
