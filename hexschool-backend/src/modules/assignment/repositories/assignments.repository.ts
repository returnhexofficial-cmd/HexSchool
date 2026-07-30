import { Injectable } from '@nestjs/common';
import {
  Assignment,
  AssignmentStatus,
  AssignmentType,
  Prisma,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const ASSIGNMENT_INCLUDE = {
  section: {
    select: {
      id: true,
      name: true,
      class: { select: { id: true, name: true, numericLevel: true } },
    },
  },
  subject: { select: { id: true, name: true, nameBn: true, code: true } },
  teacher: {
    select: { id: true, firstName: true, lastName: true, employeeId: true },
  },
} satisfies Prisma.AssignmentInclude;

export type AssignmentWithRelations = Prisma.AssignmentGetPayload<{
  include: typeof ASSIGNMENT_INCLUDE;
}>;

export interface AssignmentFilter {
  sessionId?: string;
  sectionId?: string;
  sectionIds?: string[];
  subjectId?: string;
  teacherId?: string;
  type?: AssignmentType;
  status?: AssignmentStatus;
  /** Only assignments due inside this window. */
  dueFrom?: Date;
  dueTo?: Date;
  search?: string;
}

@Injectable()
export class AssignmentsRepository extends BaseRepository<
  Assignment,
  Prisma.AssignmentWhereInput,
  Prisma.AssignmentUncheckedCreateInput,
  Prisma.AssignmentUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.assignment, 'Assignment');
  }

  private whereFor(
    schoolId: string,
    filter: AssignmentFilter,
  ): Prisma.AssignmentWhereInput {
    return {
      schoolId,
      deletedAt: null,
      ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
      ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
      ...(filter.sectionIds ? { sectionId: { in: filter.sectionIds } } : {}),
      ...(filter.subjectId ? { subjectId: filter.subjectId } : {}),
      ...(filter.teacherId ? { teacherId: filter.teacherId } : {}),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.dueFrom || filter.dueTo
        ? {
            dueAt: {
              ...(filter.dueFrom ? { gte: filter.dueFrom } : {}),
              ...(filter.dueTo ? { lte: filter.dueTo } : {}),
            },
          }
        : {}),
      ...(filter.search
        ? { title: { contains: filter.search, mode: 'insensitive' } }
        : {}),
    };
  }

  async findMany(
    schoolId: string,
    filter: AssignmentFilter,
    page: number,
    limit: number,
  ): Promise<{ rows: AssignmentWithRelations[]; total: number }> {
    const where = this.whereFor(schoolId, filter);
    const [rows, total] = await Promise.all([
      this.prisma.assignment.findMany({
        where,
        include: ASSIGNMENT_INCLUDE,
        orderBy: [{ dueAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.assignment.count({ where }),
    ]);
    return { rows, total };
  }

  /** Unpaginated — the portal reads a student's whole session at once. */
  async findAllFor(
    schoolId: string,
    filter: AssignmentFilter,
  ): Promise<AssignmentWithRelations[]> {
    return this.prisma.assignment.findMany({
      where: this.whereFor(schoolId, filter),
      include: ASSIGNMENT_INCLUDE,
      orderBy: [{ dueAt: 'desc' }],
    });
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<AssignmentWithRelations | null> {
    return this.prisma.assignment.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: ASSIGNMENT_INCLUDE,
    });
  }

  async countSubmissions(assignmentId: string): Promise<number> {
    return this.prisma.assignmentSubmission.count({ where: { assignmentId } });
  }

  /**
   * Published assignments whose deadline falls inside the reminder
   * window and which have not been reminded about yet. The
   * `due_reminder_sent_at IS NULL` predicate is the job's idempotency —
   * a column on the row the job acts on, the M12 `absent_notified_at`
   * pattern.
   */
  async findDueForReminder(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<AssignmentWithRelations[]> {
    return this.prisma.assignment.findMany({
      where: {
        schoolId,
        deletedAt: null,
        status: AssignmentStatus.PUBLISHED,
        dueReminderSentAt: null,
        dueAt: { gt: from, lte: to },
      },
      include: ASSIGNMENT_INCLUDE,
    });
  }

  /**
   * Published assignments past due by at least `cutoff` with nothing
   * handed in and no nudge sent yet (roadmap §8 "zero-submission
   * auto-close reminder to teacher after due+3d").
   */
  async findStaleWithoutSubmissions(
    schoolId: string,
    cutoff: Date,
  ): Promise<AssignmentWithRelations[]> {
    return this.prisma.assignment.findMany({
      where: {
        schoolId,
        deletedAt: null,
        status: AssignmentStatus.PUBLISHED,
        noSubmissionAlertAt: null,
        dueAt: { lte: cutoff },
        submissions: { none: {} },
      },
      include: ASSIGNMENT_INCLUDE,
    });
  }

  async markNotified(
    id: string,
    field: 'dueReminderSentAt' | 'noSubmissionAlertAt',
    at: Date,
    tx?: PrismaClientLike,
  ): Promise<void> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.assignment.update({
      where: { id },
      data: { [field]: at },
    });
  }
}
