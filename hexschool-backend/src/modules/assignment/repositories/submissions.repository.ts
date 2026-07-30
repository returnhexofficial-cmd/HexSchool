import { Injectable } from '@nestjs/common';
import { AssignmentSubmission, Prisma } from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const SUBMISSION_INCLUDE = {
  enrollment: {
    select: {
      id: true,
      rollNo: true,
      sectionId: true,
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          studentUid: true,
          photoUrl: true,
        },
      },
    },
  },
} satisfies Prisma.AssignmentSubmissionInclude;

export type SubmissionWithStudent = Prisma.AssignmentSubmissionGetPayload<{
  include: typeof SUBMISSION_INCLUDE;
}>;

/**
 * `assignment_submissions` — one row per candidate per assignment, keyed
 * on `enrollment_id`. **No soft delete**: a resubmission overwrites the
 * row so the evaluation hanging off its id stays attached (the M15
 * `marks` rule), which is also what lets the identity index be a plain
 * unique rather than a partial one.
 */
@Injectable()
export class SubmissionsRepository extends BaseRepository<
  AssignmentSubmission,
  Prisma.AssignmentSubmissionWhereInput,
  Prisma.AssignmentSubmissionUncheckedCreateInput,
  Prisma.AssignmentSubmissionUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.assignmentSubmission, 'Submission', {
      softDeletable: false,
    });
  }

  async findForAssignment(
    assignmentId: string,
    schoolId: string,
  ): Promise<SubmissionWithStudent[]> {
    return this.prisma.assignmentSubmission.findMany({
      where: { assignmentId, schoolId },
      include: SUBMISSION_INCLUDE,
      orderBy: [{ enrollment: { rollNo: 'asc' } }],
    });
  }

  async findOneFor(
    assignmentId: string,
    enrollmentId: string,
    tx?: PrismaClientLike,
  ): Promise<AssignmentSubmission | null> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.assignmentSubmission.findUnique({
      where: {
        assignmentId_enrollmentId: { assignmentId, enrollmentId },
      },
    });
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<
    | (SubmissionWithStudent & {
        assignment: {
          id: string;
          title: string;
          fullMarks: Prisma.Decimal | null;
          status: string;
          sectionId: string;
          subjectId: string;
          sessionId: string;
          teacherId: string;
        };
      })
    | null
  > {
    return this.prisma.assignmentSubmission.findFirst({
      where: { id, schoolId },
      include: {
        ...SUBMISSION_INCLUDE,
        assignment: {
          select: {
            id: true,
            title: true,
            fullMarks: true,
            status: true,
            sectionId: true,
            subjectId: true,
            sessionId: true,
            teacherId: true,
          },
        },
      },
    });
  }

  /** Every submission a set of enrollments has made — the portal's list. */
  async findForEnrollments(
    schoolId: string,
    enrollmentIds: string[],
  ): Promise<AssignmentSubmission[]> {
    if (enrollmentIds.length === 0) return [];
    return this.prisma.assignmentSubmission.findMany({
      where: { schoolId, enrollmentId: { in: enrollmentIds } },
      orderBy: { submittedAt: 'desc' },
    });
  }

  async findByIds(
    ids: string[],
    schoolId: string,
  ): Promise<AssignmentSubmission[]> {
    if (ids.length === 0) return [];
    return this.prisma.assignmentSubmission.findMany({
      where: { id: { in: ids }, schoolId },
    });
  }

  /**
   * Insert-or-replace the candidate's row. Written as an upsert on the
   * identity index rather than read-then-write, because a student who
   * double-taps Submit on a slow phone connection is the ordinary case
   * here, not the exotic one — and two inserts would race the unique.
   */
  async upsertSubmission(
    key: { assignmentId: string; enrollmentId: string },
    data: {
      schoolId: string;
      textAnswer: string | null;
      attachmentUrls: Prisma.InputJsonValue;
      submittedAt: Date;
      isLate: boolean;
      attempt: number;
      status: AssignmentSubmission['status'];
      actorId: string | null;
    },
    tx?: PrismaClientLike,
  ): Promise<AssignmentSubmission> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.assignmentSubmission.upsert({
      where: { assignmentId_enrollmentId: key },
      create: {
        ...key,
        schoolId: data.schoolId,
        textAnswer: data.textAnswer,
        attachmentUrls: data.attachmentUrls,
        submittedAt: data.submittedAt,
        isLate: data.isLate,
        attempt: data.attempt,
        status: data.status,
        createdBy: data.actorId,
        updatedBy: data.actorId,
      },
      update: {
        textAnswer: data.textAnswer,
        attachmentUrls: data.attachmentUrls,
        submittedAt: data.submittedAt,
        isLate: data.isLate,
        attempt: data.attempt,
        status: data.status,
        // A resubmission is new work, so whatever was said about the old
        // work no longer describes what is on file. Clearing it is the
        // M15 rule that re-entering a mark clears its grade.
        marks: null,
        feedback: null,
        evaluatedBy: null,
        evaluatedAt: null,
        updatedBy: data.actorId,
      },
    });
  }

  async evaluate(
    id: string,
    data: {
      marks: Prisma.Decimal | number | null;
      feedback: string | null;
      status: AssignmentSubmission['status'];
      evaluatedBy: string;
      evaluatedAt: Date;
    },
    tx?: PrismaClientLike,
  ): Promise<AssignmentSubmission> {
    const client = (tx ?? this.prisma) as PrismaService;
    return client.assignmentSubmission.update({
      where: { id },
      data: {
        marks: data.marks,
        feedback: data.feedback,
        status: data.status,
        evaluatedBy: data.evaluatedBy,
        evaluatedAt: data.evaluatedAt,
        updatedBy: data.evaluatedBy,
      },
    });
  }

  /** Which of these assignments the enrollment has already handed in. */
  async statusByAssignment(
    enrollmentIds: string[],
    assignmentIds: string[],
  ): Promise<Map<string, AssignmentSubmission>> {
    if (enrollmentIds.length === 0 || assignmentIds.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.assignmentSubmission.findMany({
      where: {
        enrollmentId: { in: enrollmentIds },
        assignmentId: { in: assignmentIds },
      },
    });
    return new Map(rows.map((r) => [r.assignmentId, r]));
  }
}
