import { Injectable } from '@nestjs/common';
import { Prisma, TeacherQualification } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/** Child rows of a teacher (no school_id of their own; scoped via parent). */
@Injectable()
export class TeacherQualificationsRepository extends BaseRepository<
  TeacherQualification,
  Prisma.TeacherQualificationWhereInput,
  Prisma.TeacherQualificationUncheckedCreateInput,
  Prisma.TeacherQualificationUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.teacherQualification, 'Qualification', {
      softDeletable: false,
      schoolScoped: false,
    });
  }

  async listForTeacher(teacherId: string): Promise<TeacherQualification[]> {
    return this.prisma.teacherQualification.findMany({
      where: { teacherId },
      orderBy: { passingYear: 'desc' },
    });
  }

  async hardDelete(id: string): Promise<void> {
    await this.prisma.teacherQualification.delete({ where: { id } });
  }
}
