import { Injectable } from '@nestjs/common';
import { ExamStatus, Prisma } from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const RELATIONS = {
  subject: {
    select: { id: true, name: true, nameBn: true, code: true, type: true },
  },
  class: { select: { id: true, name: true, numericLevel: true } },
  exam: {
    select: {
      id: true,
      name: true,
      status: true,
      startDate: true,
      endDate: true,
      sessionId: true,
    },
  },
} satisfies Prisma.ExamSubjectInclude;

export type ExamSubjectWithRelations = Prisma.ExamSubjectGetPayload<{
  include: typeof RELATIONS;
}>;

/**
 * Exam papers. Composite-identity child rows with no soft delete — the
 * bulk endpoint replaces an exam's papers wholesale and the audit log
 * keeps the diff (the M06 `class_subjects` / M13 `timetable_entries`
 * pattern).
 */
@Injectable()
export class ExamSubjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findForExam(
    examId: string,
    tx?: PrismaClientLike,
  ): Promise<ExamSubjectWithRelations[]> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.examSubject.findMany({
      where: { examId },
      include: RELATIONS,
      orderBy: [
        { class: { numericLevel: 'asc' } },
        { examDate: 'asc' },
        { subject: { name: 'asc' } },
      ],
    });
  }

  async findById(
    id: string,
    schoolId: string,
  ): Promise<ExamSubjectWithRelations | null> {
    return this.prisma.examSubject.findFirst({
      where: { id, schoolId },
      include: RELATIONS,
    });
  }

  /** Papers of one sitting date — the seat plan's candidate source. */
  async findForExamDate(
    examId: string,
    date: Date,
  ): Promise<ExamSubjectWithRelations[]> {
    return this.prisma.examSubject.findMany({
      where: { examId, examDate: date },
      include: RELATIONS,
      orderBy: [{ class: { numericLevel: 'asc' } }, { startTime: 'asc' }],
    });
  }

  /**
   * Scheduled sittings of OTHER live exams in the same session — rooms
   * are a school-wide resource, so the clash engine must see them.
   */
  async findScheduledForSession(
    schoolId: string,
    sessionId: string,
    excludeExamId: string,
  ): Promise<ExamSubjectWithRelations[]> {
    return this.prisma.examSubject.findMany({
      where: {
        schoolId,
        examDate: { not: null },
        exam: {
          is: {
            sessionId,
            deletedAt: null,
            id: { not: excludeExamId },
            status: { notIn: [ExamStatus.DRAFT, ExamStatus.ARCHIVED] },
          },
        },
      },
      include: RELATIONS,
    });
  }

  /** Distinct sitting dates of an exam, ascending (the routine's day axis). */
  async findExamDates(examId: string): Promise<Date[]> {
    const rows = await this.prisma.examSubject.findMany({
      where: { examId, examDate: { not: null } },
      distinct: ['examDate'],
      select: { examDate: true },
      orderBy: { examDate: 'asc' },
    });
    return rows.map((r) => r.examDate).filter((d): d is Date => d !== null);
  }

  async countForExam(examId: string, tx?: PrismaClientLike): Promise<number> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.examSubject.count({ where: { examId } });
  }

  async countUnscheduled(examId: string): Promise<number> {
    return this.prisma.examSubject.count({
      where: { examId, examDate: null },
    });
  }

  async create(
    data: Prisma.ExamSubjectUncheckedCreateInput,
    tx?: PrismaClientLike,
  ): Promise<ExamSubjectWithRelations> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.examSubject.create({ data, include: RELATIONS });
  }

  async createMany(
    rows: Prisma.ExamSubjectUncheckedCreateInput[],
    tx?: PrismaClientLike,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const client = (tx ?? this.prisma) as PrismaService;
    const { count } = await client.examSubject.createMany({ data: rows });
    return count;
  }

  async update(
    id: string,
    data: Prisma.ExamSubjectUncheckedUpdateInput,
    tx?: PrismaClientLike,
  ): Promise<ExamSubjectWithRelations> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.examSubject.update({
      where: { id },
      data,
      include: RELATIONS,
    });
  }

  async deleteMany(ids: string[], tx?: PrismaClientLike): Promise<number> {
    if (ids.length === 0) return 0;
    const client = (tx ?? this.prisma) as PrismaService;
    const { count } = await client.examSubject.deleteMany({
      where: { id: { in: ids } },
    });
    return count;
  }

  /** Drop every paper of the classes leaving an exam. */
  async deleteForClasses(
    examId: string,
    classIds: string[],
    tx?: PrismaClientLike,
  ): Promise<number> {
    if (classIds.length === 0) return 0;
    const client = (tx ?? this.prisma) as PrismaService;
    const { count } = await client.examSubject.deleteMany({
      where: { examId, classId: { in: classIds } },
    });
    return count;
  }

  /** Move every sitting of one date to another (the postponement tool). */
  async shiftDate(
    examId: string,
    from: Date,
    to: Date,
    actorId: string,
    tx?: PrismaClientLike,
  ): Promise<number> {
    const client = (tx ?? this.prisma) as PrismaService;
    const { count } = await client.examSubject.updateMany({
      where: { examId, examDate: from },
      data: { examDate: to, updatedBy: actorId },
    });
    return count;
  }
}
