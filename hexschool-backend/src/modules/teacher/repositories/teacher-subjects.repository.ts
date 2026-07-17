import { Injectable } from '@nestjs/common';
import { Subject } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * Expertise join table (composite PK ⇒ standalone repository, same as
 * user_roles). What a teacher CAN teach — assignments check against it.
 */
@Injectable()
export class TeacherSubjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findSubjectsForTeacher(teacherId: string): Promise<Subject[]> {
    const rows = await this.prisma.teacherSubject.findMany({
      where: { teacherId },
      select: { subject: true },
      orderBy: { subject: { name: 'asc' } },
    });
    return rows.map((r) => r.subject);
  }

  async hasExpertise(teacherId: string, subjectId: string): Promise<boolean> {
    const row = await this.prisma.teacherSubject.findUnique({
      where: { teacherId_subjectId: { teacherId, subjectId } },
    });
    return row !== null;
  }

  /** Replace the whole expertise set atomically. */
  async replaceForTeacher(
    teacherId: string,
    subjectIds: string[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.teacherSubject.deleteMany({
        where: { teacherId, subjectId: { notIn: subjectIds } },
      });
      if (subjectIds.length > 0) {
        await tx.teacherSubject.createMany({
          data: subjectIds.map((subjectId) => ({ teacherId, subjectId })),
          skipDuplicates: true,
        });
      }
    });
  }
}
