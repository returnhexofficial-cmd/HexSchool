import { Injectable } from '@nestjs/common';
import { Prisma, TeacherSectionSubject } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';

const ASSIGNMENT_INCLUDE = {
  teacher: {
    select: { id: true, firstName: true, lastName: true, employeeId: true },
  },
  section: {
    select: {
      id: true,
      name: true,
      roomNo: true,
      class: { select: { id: true, name: true, numericLevel: true } },
      shift: { select: { id: true, name: true } },
    },
  },
  subject: { select: { id: true, name: true, code: true } },
} satisfies Prisma.TeacherSectionSubjectInclude;

export type AssignmentWithRelations = Prisma.TeacherSectionSubjectGetPayload<{
  include: typeof ASSIGNMENT_INCLUDE;
}>;

/**
 * teacher_section_subjects — who teaches what where. One teacher per
 * (session, section, subject): the upsert REPLACES the holder;
 * reassignment history lives in audit_logs (roadmap M08 §6).
 */
@Injectable()
export class TeacherAssignmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findBySlot(
    sessionId: string,
    sectionId: string,
    subjectId: string,
  ): Promise<TeacherSectionSubject | null> {
    return this.prisma.teacherSectionSubject.findUnique({
      where: {
        sessionId_sectionId_subjectId: { sessionId, sectionId, subjectId },
      },
    });
  }

  async findById(id: string): Promise<TeacherSectionSubject | null> {
    return this.prisma.teacherSectionSubject.findUnique({ where: { id } });
  }

  async list(
    filter: {
      sessionId: string;
      sectionId?: string;
      teacherId?: string;
    },
    schoolId: string,
  ): Promise<AssignmentWithRelations[]> {
    return this.prisma.teacherSectionSubject.findMany({
      where: { schoolId, ...filter },
      include: ASSIGNMENT_INCLUDE,
      orderBy: [
        { section: { class: { numericLevel: 'asc' } } },
        { section: { name: 'asc' } },
        { subject: { name: 'asc' } },
      ],
    });
  }

  /** Claim/replace the slot's holder. */
  async upsertSlot(params: {
    schoolId: string;
    sessionId: string;
    sectionId: string;
    subjectId: string;
    teacherId: string;
    actorId: string;
  }): Promise<TeacherSectionSubject> {
    const { schoolId, sessionId, sectionId, subjectId, teacherId, actorId } =
      params;
    return this.prisma.teacherSectionSubject.upsert({
      where: {
        sessionId_sectionId_subjectId: { sessionId, sectionId, subjectId },
      },
      create: {
        schoolId,
        sessionId,
        sectionId,
        subjectId,
        teacherId,
        createdBy: actorId,
        updatedBy: actorId,
      },
      update: { teacherId, updatedBy: actorId },
    });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.teacherSectionSubject.delete({ where: { id } });
  }

  async countForTeacher(teacherId: string, sessionId: string): Promise<number> {
    return this.prisma.teacherSectionSubject.count({
      where: { teacherId, sessionId },
    });
  }

  /** Move every assignment of a teacher in a session to another teacher. */
  async transferAll(
    fromTeacherId: string,
    toTeacherId: string,
    sessionId: string,
    actorId: string,
  ): Promise<number> {
    const result = await this.prisma.teacherSectionSubject.updateMany({
      where: { teacherId: fromTeacherId, sessionId },
      data: { teacherId: toTeacherId, updatedBy: actorId },
    });
    return result.count;
  }

  /** Distinct subjects a teacher holds in a session (transfer expertise check). */
  async distinctSubjectIdsForTeacher(
    teacherId: string,
    sessionId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.teacherSectionSubject.findMany({
      where: { teacherId, sessionId },
      select: { subjectId: true },
      distinct: ['subjectId'],
    });
    return rows.map((r) => r.subjectId);
  }

  /** Assignment counts per teacher for one session (interim workload). */
  async workloadCounts(
    sessionId: string,
    schoolId: string,
  ): Promise<Array<{ teacherId: string; assignments: number }>> {
    const rows = await this.prisma.teacherSectionSubject.groupBy({
      by: ['teacherId'],
      where: { sessionId, schoolId },
      _count: { teacherId: true },
    });
    return rows.map((r) => ({
      teacherId: r.teacherId,
      assignments: r._count.teacherId,
    }));
  }
}
