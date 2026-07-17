import { Injectable } from '@nestjs/common';
import { Prisma, StudentMedicalInfo } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/** 1:1 health record — not soft-deletable (cascades with the student). */
@Injectable()
export class StudentMedicalRepository extends BaseRepository<
  StudentMedicalInfo,
  Prisma.StudentMedicalInfoWhereInput,
  Prisma.StudentMedicalInfoUncheckedCreateInput,
  Prisma.StudentMedicalInfoUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.studentMedicalInfo, 'StudentMedicalInfo', {
      softDeletable: false,
    });
  }

  async findForStudent(studentId: string): Promise<StudentMedicalInfo | null> {
    return this.prisma.studentMedicalInfo.findUnique({ where: { studentId } });
  }

  async upsertForStudent(
    studentId: string,
    schoolId: string,
    data: Omit<
      Prisma.StudentMedicalInfoUncheckedCreateInput,
      'studentId' | 'schoolId'
    >,
  ): Promise<StudentMedicalInfo> {
    return this.prisma.studentMedicalInfo.upsert({
      where: { studentId },
      create: { ...data, studentId, schoolId },
      update: data,
    });
  }
}
