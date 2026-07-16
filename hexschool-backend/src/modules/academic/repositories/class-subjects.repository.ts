import { Injectable } from '@nestjs/common';
import { ClassSubject, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';

export type ClassSubjectWithRelations = Prisma.ClassSubjectGetPayload<{
  include: {
    subject: {
      select: { id: true; name: true; code: true; type: true };
    };
    group: { select: { id: true; name: true } };
  };
}>;

/**
 * Curriculum mapping rows. Composite-identity mapping table (no soft
 * delete) — replaced wholesale by the bulk assign endpoint; still the
 * only ORM touchpoint for the entity.
 */
@Injectable()
export class ClassSubjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findForClassSession(
    classId: string,
    sessionId: string,
    schoolId: string,
  ): Promise<ClassSubjectWithRelations[]> {
    return this.prisma.classSubject.findMany({
      where: { classId, sessionId, schoolId },
      include: {
        subject: { select: { id: true, name: true, code: true, type: true } },
        group: { select: { id: true, name: true } },
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  /** Full replacement for one class+session (single transaction). */
  async replaceForClassSession(
    params: {
      schoolId: string;
      classId: string;
      sessionId: string;
    },
    rows: Array<
      Omit<
        Prisma.ClassSubjectUncheckedCreateInput,
        'schoolId' | 'classId' | 'sessionId'
      >
    >,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.classSubject.deleteMany({
        where: { classId: params.classId, sessionId: params.sessionId },
      });
      if (rows.length > 0) {
        await tx.classSubject.createMany({
          data: rows.map((row) => ({ ...row, ...params })),
        });
      }
    });
  }

  /** All mapping rows of a session (clone source/target). */
  async findForSession(
    schoolId: string,
    sessionId: string,
  ): Promise<ClassSubject[]> {
    return this.prisma.classSubject.findMany({
      where: { schoolId, sessionId },
    });
  }

  async createMany(
    rows: Prisma.ClassSubjectUncheckedCreateInput[],
  ): Promise<number> {
    const { count } = await this.prisma.classSubject.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return count;
  }
}
