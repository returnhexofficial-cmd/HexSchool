import { Injectable } from '@nestjs/common';
import { ExamType, Prisma } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

@Injectable()
export class ExamTypesRepository extends BaseRepository<
  ExamType,
  Prisma.ExamTypeWhereInput,
  Prisma.ExamTypeUncheckedCreateInput,
  Prisma.ExamTypeUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.examType, 'ExamType');
  }

  async findAllForSchool(schoolId: string): Promise<ExamType[]> {
    return this.prisma.examType.findMany({
      where: { schoolId, deletedAt: null },
      orderBy: [{ name: 'asc' }],
    });
  }

  /** Case-insensitive name lookup behind `uq_exam_types_name`. */
  async findByName(
    schoolId: string,
    name: string,
    excludeId?: string,
  ): Promise<ExamType | null> {
    return this.prisma.examType.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  /** Exams referencing this type — the delete guard. */
  async countExams(examTypeId: string): Promise<number> {
    return this.prisma.exam.count({
      where: { examTypeId, deletedAt: null },
    });
  }
}
