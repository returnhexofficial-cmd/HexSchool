import { Injectable } from '@nestjs/common';
import { MarkStatus, Prisma } from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const RELATIONS = {
  examSubject: {
    select: {
      id: true,
      classId: true,
      subjectId: true,
      fullMarks: true,
      passMarks: true,
      cqMarks: true,
      mcqMarks: true,
      practicalMarks: true,
      caMarks: true,
      cqPassMarks: true,
      mcqPassMarks: true,
      practicalPassMarks: true,
      caPassMarks: true,
      subject: { select: { id: true, name: true, nameBn: true, code: true } },
    },
  },
} satisfies Prisma.MarkInclude;

export type MarkWithPaper = Prisma.MarkGetPayload<{
  include: typeof RELATIONS;
}>;

/**
 * Marks. Composite-identity child rows (`uq(exam_subject_id,
 * enrollment_id)`) with no soft delete: a mark is re-entered in place,
 * never deleted and re-created, so its id stays stable for the
 * correction log to point at.
 *
 * Deliberately NOT a `BaseRepository` subclass — the base's soft-delete
 * scoping and single-model CRUD buy nothing here, while every query this
 * module needs is either a paper-scoped grid fetch or an exam-wide sweep
 * for the processor (the `EmployeeDirectoryRepository` precedent in M12).
 */
@Injectable()
export class MarksRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── reads ───────────────────────────────────────────────────────────

  /** The mark-entry grid: every mark for one paper. */
  async findForPaper(examSubjectId: string): Promise<MarkWithPaper[]> {
    return this.prisma.mark.findMany({
      where: { examSubjectId },
      include: RELATIONS,
    });
  }

  /** Every mark of an exam — the processor's single sweep. */
  async findForExam(
    examId: string,
    enrollmentId?: string,
  ): Promise<MarkWithPaper[]> {
    return this.prisma.mark.findMany({
      where: { examId, ...(enrollmentId ? { enrollmentId } : {}) },
      include: RELATIONS,
    });
  }

  async findById(id: string, schoolId: string): Promise<MarkWithPaper | null> {
    return this.prisma.mark.findFirst({
      where: { id, schoolId },
      include: RELATIONS,
    });
  }

  async findForEnrollments(enrollmentIds: string[]): Promise<MarkWithPaper[]> {
    if (enrollmentIds.length === 0) return [];
    return this.prisma.mark.findMany({
      where: { enrollmentId: { in: enrollmentIds } },
      include: RELATIONS,
    });
  }

  /**
   * Marks a student holds across every exam of a session — the transcript
   * and the M09 performance history.
   */
  async findForStudentSession(
    studentId: string,
    sessionId: string,
    schoolId: string,
  ): Promise<MarkWithPaper[]> {
    return this.prisma.mark.findMany({
      where: {
        schoolId,
        enrollment: { studentId, sessionId, deletedAt: null },
      },
      include: RELATIONS,
    });
  }

  /** Status roll-up per paper — what the lock/verify progress bar reads. */
  async countByStatusForExam(
    examId: string,
  ): Promise<
    Array<{ examSubjectId: string; status: MarkStatus; count: number }>
  > {
    const rows = await this.prisma.mark.groupBy({
      by: ['examSubjectId', 'status'],
      where: { examId },
      _count: { _all: true },
    });
    return rows.map((row) => ({
      examSubjectId: row.examSubjectId,
      status: row.status,
      count: row._count._all,
    }));
  }

  async countForExam(examId: string): Promise<number> {
    return this.prisma.mark.count({ where: { examId } });
  }

  /** Does ANY mark exist for these papers? The M14/M06 delete guards. */
  async existsForPapers(examSubjectIds: string[]): Promise<number> {
    if (examSubjectIds.length === 0) return 0;
    return this.prisma.mark.count({
      where: { examSubjectId: { in: examSubjectIds } },
    });
  }

  /** Does ANY mark exist for these enrollments? The M11 rollback guard. */
  async countForEnrollments(enrollmentIds: string[]): Promise<number> {
    if (enrollmentIds.length === 0) return 0;
    return this.prisma.mark.count({
      where: { enrollmentId: { in: enrollmentIds } },
    });
  }

  /** Marks of the class×subject pairs a curriculum edit would orphan. */
  async countForClassSubject(
    classId: string,
    subjectId: string,
    sessionId: string,
  ): Promise<number> {
    return this.prisma.mark.count({
      where: {
        examSubject: { classId, subjectId },
        exam: { sessionId, deletedAt: null },
      },
    });
  }

  /**
   * The latest moment any mark of an exam changed. The publication gate
   * compares it to the last processing run: a mark edited afterwards
   * means the results on file no longer describe the marks on file.
   */
  async lastChangedAt(examId: string): Promise<Date | null> {
    const row = await this.prisma.mark.findFirst({
      where: { examId },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    return row?.updatedAt ?? null;
  }

  // ── writes ──────────────────────────────────────────────────────────

  async upsert(
    data: Prisma.MarkUncheckedCreateInput,
    tx?: PrismaClientLike,
  ): Promise<MarkWithPaper> {
    const client = (tx ?? this.prisma) as PrismaService;
    const {
      schoolId,
      examId,
      examSubjectId,
      enrollmentId,
      createdBy,
      ...rest
    } = data;
    return client.mark.upsert({
      where: {
        examSubjectId_enrollmentId: { examSubjectId, enrollmentId },
      },
      create: {
        schoolId,
        examId,
        examSubjectId,
        enrollmentId,
        createdBy,
        ...rest,
      },
      update: rest,
      include: RELATIONS,
    });
  }

  async update(
    id: string,
    data: Prisma.MarkUncheckedUpdateInput,
    tx?: PrismaClientLike,
  ): Promise<MarkWithPaper> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.mark.update({ where: { id }, data, include: RELATIONS });
  }

  /**
   * Save a whole grid in one transaction. `createMany` cannot do it —
   * re-marking must update in place to keep each mark's id stable for
   * the correction log — so this is a loop of upserts inside one tx,
   * which is what makes the save all-or-nothing.
   */
  async saveGrid(rows: Prisma.MarkUncheckedCreateInput[]): Promise<number> {
    if (rows.length === 0) return 0;
    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        await this.upsert(row, tx);
      }
    });
    return rows.length;
  }

  /** Unit-of-work helper (BaseRepository's, re-exposed for this repo). */
  async withTransaction<R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
  ): Promise<R> {
    return this.prisma.$transaction(fn);
  }

  /** Bulk status move for one paper (submit / verify / lock). */
  async setStatusForPaper(
    examSubjectId: string,
    from: MarkStatus[],
    data: Prisma.MarkUncheckedUpdateManyInput,
    tx?: PrismaClientLike,
  ): Promise<number> {
    const client = (tx ?? this.prisma) as PrismaService;
    const { count } = await client.mark.updateMany({
      where: { examSubjectId, status: { in: from } },
      data,
    });
    return count;
  }

  /** Write back the grades a processing run computed. */
  async setGrade(
    id: string,
    data: {
      grade: string;
      gradePoint: Prisma.Decimal | number;
      graceApplied: Prisma.Decimal | number;
    },
    tx?: PrismaClientLike,
  ): Promise<void> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.mark.update({ where: { id }, data });
  }
}
