import { Injectable } from '@nestjs/common';
import { Prisma, TeacherEvaluation } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/** Kept once written; edits allowed (pre-M15 nothing snapshots them). */
@Injectable()
export class TeacherEvaluationsRepository extends BaseRepository<
  TeacherEvaluation,
  Prisma.TeacherEvaluationWhereInput,
  Prisma.TeacherEvaluationUncheckedCreateInput,
  Prisma.TeacherEvaluationUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.teacherEvaluation, 'Evaluation', {
      softDeletable: false,
    });
  }

  async listForTeacher(
    teacherId: string,
    sessionId?: string,
  ): Promise<TeacherEvaluation[]> {
    return this.prisma.teacherEvaluation.findMany({
      where: { teacherId, ...(sessionId ? { sessionId } : {}) },
      orderBy: { evaluatedAt: 'desc' },
    });
  }

  async hardDelete(id: string): Promise<void> {
    await this.prisma.teacherEvaluation.delete({ where: { id } });
  }
}
