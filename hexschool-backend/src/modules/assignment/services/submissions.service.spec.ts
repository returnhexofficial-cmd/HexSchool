import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AssignmentStatus, SubmissionStatus } from '@prisma/client';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SubmissionsService } from './submissions.service';

const SCHOOL = 'school-1';
const ASSIGNMENT_ID = 'assignment-1';
const HOUR = 3_600_000;

const actor = {
  sub: 'user-1',
  schoolId: SCHOOL,
  userType: UserType.STUDENT,
} as AccessTokenPayload;

const teacherActor = {
  sub: 'user-teacher',
  schoolId: SCHOOL,
  userType: UserType.TEACHER,
} as AccessTokenPayload;

function build(
  over: {
    assignment?: Partial<{
      status: AssignmentStatus;
      dueAt: Date;
      allowLate: boolean;
      fullMarks: number | null;
    }>;
    existing?: { status: SubmissionStatus; attempt: number } | null;
    roster?: string[];
    cfg?: Partial<{
      allowResubmission: boolean;
      resubmissionUntilDue: boolean;
      enabled: boolean;
    }>;
    codes?: string[];
  } = {},
) {
  const assignment = {
    id: ASSIGNMENT_ID,
    schoolId: SCHOOL,
    sessionId: 'session-1',
    sectionId: 'section-1',
    subjectId: 'subject-1',
    teacherId: 'teacher-1',
    title: 'Newton’s laws',
    status: AssignmentStatus.PUBLISHED,
    dueAt: new Date(Date.now() + HOUR),
    allowLate: false,
    fullMarks: 20,
    ...over.assignment,
  };

  const submissions = {
    findOneFor: jest.fn().mockResolvedValue(
      over.existing
        ? {
            id: 'sub-1',
            status: over.existing.status,
            attempt: over.existing.attempt,
          }
        : null,
    ),
    upsertSubmission: jest
      .fn()
      .mockImplementation((_key: unknown, data: Record<string, unknown>) =>
        Promise.resolve({ id: 'sub-1', ...data }),
      ),
    findForAssignment: jest.fn().mockResolvedValue([]),
    findByIds: jest.fn().mockResolvedValue([]),
    findDetail: jest.fn(),
    evaluate: jest
      .fn()
      .mockImplementation((id: string, data: Record<string, unknown>) =>
        Promise.resolve({ id, ...data }),
      ),
    withTransaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) =>
      fn({}),
    ),
  };

  const assignmentsService = {
    findOrFail: jest.fn().mockResolvedValue(assignment),
    statsFor: jest.fn().mockResolvedValue({ expected: 1, submitted: 0 }),
  };

  const policy = {
    assertMayTouch: jest.fn().mockResolvedValue({ seesAll: true }),
    has: jest
      .fn()
      .mockImplementation((_a: unknown, code: string) =>
        Promise.resolve((over.codes ?? ['assignment.evaluate']).includes(code)),
      ),
  };

  const rosterIds = over.roster ?? ['enrollment-1'];
  const enrollments = {
    getSectionStudents: jest.fn().mockResolvedValue(
      rosterIds.map((id, index) => ({
        id,
        rollNo: index + 1,
        student: {
          id: `student-${index + 1}`,
          firstName: 'Rahim',
          lastName: 'Uddin',
          studentUid: `UID-${index + 1}`,
        },
      })),
    ),
  };

  const config = {
    load: jest.fn().mockResolvedValue({
      enabled: true,
      allowResubmission: true,
      resubmissionUntilDue: true,
      limits: {
        maxCount: 3,
        maxBytes: 10 * 1024 * 1024,
        allowedTypes: ['pdf'],
      },
      ...over.cfg,
    }),
  };

  const service = new SubmissionsService(
    submissions as never,
    { countSubmissions: jest.fn() } as never,
    assignmentsService as never,
    policy as never,
    config as never,
    enrollments as never,
    { set: jest.fn() } as never,
  );

  return { service, submissions, policy, assignment, enrollments };
}

describe('SubmissionsService.submit', () => {
  it('records an on-time first submission', async () => {
    const { service, submissions } = build();
    const saved = await service.submit(
      ASSIGNMENT_ID,
      'enrollment-1',
      { textAnswer: 'F = ma' },
      actor,
    );
    expect(saved).toMatchObject({ isLate: false, attempt: 1 });
    expect(submissions.upsertSubmission).toHaveBeenCalledWith(
      { assignmentId: ASSIGNMENT_ID, enrollmentId: 'enrollment-1' },
      expect.objectContaining({ status: SubmissionStatus.SUBMITTED }),
    );
  });

  it('refuses a candidate who is not in the assignment’s section', async () => {
    const { service } = build({ roster: ['someone-else'] });
    await expect(
      service.submit(ASSIGNMENT_ID, 'enrollment-1', { textAnswer: 'x' }, actor),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses an empty submission', async () => {
    const { service } = build();
    await expect(
      service.submit(ASSIGNMENT_ID, 'enrollment-1', {}, actor),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.submit(
        ASSIGNMENT_ID,
        'enrollment-1',
        { textAnswer: '   ' },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a submission to a DRAFT assignment', async () => {
    const { service } = build({
      assignment: { status: AssignmentStatus.DRAFT },
    });
    await expect(
      service.submit(ASSIGNMENT_ID, 'enrollment-1', { textAnswer: 'x' }, actor),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses a late submission when late is not allowed', async () => {
    const { service } = build({
      assignment: { dueAt: new Date(Date.now() - HOUR) },
    });
    await expect(
      service.submit(ASSIGNMENT_ID, 'enrollment-1', { textAnswer: 'x' }, actor),
    ).rejects.toThrow(ConflictException);
  });

  it('flags a late submission when allow_late is on', async () => {
    const { service } = build({
      assignment: { dueAt: new Date(Date.now() - HOUR), allowLate: true },
    });
    const saved = await service.submit(
      ASSIGNMENT_ID,
      'enrollment-1',
      { textAnswer: 'x' },
      actor,
    );
    expect(saved).toMatchObject({ isLate: true });
  });

  it('counts the REAL attempt number on a third submission', async () => {
    // The engine reports 2 for "any resubmission"; the stored value has
    // to be one more than what is on file, or every resubmission after
    // the first would read as attempt 2 forever.
    const { service } = build({
      existing: { status: SubmissionStatus.SUBMITTED, attempt: 2 },
    });
    const saved = await service.submit(
      ASSIGNMENT_ID,
      'enrollment-1',
      { textAnswer: 'x' },
      actor,
    );
    expect(saved).toMatchObject({
      attempt: 3,
      status: SubmissionStatus.RESUBMITTED,
    });
  });

  it('refuses overwriting an evaluated submission', async () => {
    const { service } = build({
      existing: { status: SubmissionStatus.EVALUATED, attempt: 1 },
    });
    await expect(
      service.submit(ASSIGNMENT_ID, 'enrollment-1', { textAnswer: 'x' }, actor),
    ).rejects.toThrow(/already been evaluated/i);
  });

  it('refuses an attachment of a disallowed type', async () => {
    const { service } = build();
    await expect(
      service.submit(
        ASSIGNMENT_ID,
        'enrollment-1',
        {
          attachments: [
            { key: 'k', name: 'payload.exe', size: 10, contentType: 'x' },
          ],
        },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('SubmissionsService.grid', () => {
  it('lists every roster candidate, submitted or not', async () => {
    const { service } = build({ roster: ['e1', 'e2'] });
    const { rows } = await service.grid(ASSIGNMENT_ID, teacherActor);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.submission === null)).toBe(true);
  });

  it('keeps a transferred-out submitter on the grid, flagged', async () => {
    const { service, submissions } = build({ roster: ['e1'] });
    submissions.findForAssignment.mockResolvedValue([
      {
        id: 'sub-9',
        enrollmentId: 'e9',
        status: SubmissionStatus.SUBMITTED,
        isLate: false,
        marks: null,
        attempt: 1,
        submittedAt: new Date(),
        enrollment: {
          rollNo: 12,
          student: {
            id: 'student-9',
            firstName: 'Karim',
            lastName: 'Mia',
            studentUid: 'UID-9',
          },
        },
      },
    ]);

    const { rows } = await service.grid(ASSIGNMENT_ID, teacherActor);
    expect(rows).toHaveLength(2);
    const moved = rows.find((r) => r.enrollmentId === 'e9');
    expect(moved).toMatchObject({ transferredOut: true });
    expect(moved?.submission).not.toBeNull();
  });

  it('sorts by roll number', async () => {
    const { service } = build({ roster: ['e1', 'e2', 'e3'] });
    const { rows } = await service.grid(ASSIGNMENT_ID, teacherActor);
    expect(rows.map((r) => r.rollNo)).toEqual([1, 2, 3]);
  });
});

describe('SubmissionsService.evaluateBulk', () => {
  const rowsFor = (ids: string[]) =>
    ids.map((id) => ({ submissionId: id, marks: 10 }));

  it('writes every row when the batch is clean', async () => {
    const { service, submissions } = build();
    submissions.findByIds.mockResolvedValue([
      { id: 's1', assignmentId: ASSIGNMENT_ID },
      { id: 's2', assignmentId: ASSIGNMENT_ID },
    ]);
    await expect(
      service.evaluateBulk(
        ASSIGNMENT_ID,
        { rows: rowsFor(['s1', 's2']) },
        teacherActor,
      ),
    ).resolves.toEqual({ updated: 2 });
    expect(submissions.evaluate).toHaveBeenCalledTimes(2);
  });

  it('writes NOTHING when one cell is over full marks', async () => {
    const { service, submissions } = build();
    submissions.findByIds.mockResolvedValue([
      { id: 's1', assignmentId: ASSIGNMENT_ID },
      { id: 's2', assignmentId: ASSIGNMENT_ID },
    ]);
    await expect(
      service.evaluateBulk(
        ASSIGNMENT_ID,
        {
          rows: [
            { submissionId: 's1', marks: 10 },
            { submissionId: 's2', marks: 99 },
          ],
        },
        teacherActor,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(submissions.evaluate).not.toHaveBeenCalled();
  });

  it('refuses a submission id belonging to a DIFFERENT assignment', async () => {
    // Without this a teacher who legitimately holds one section could
    // post another section's ids into the payload and mark them.
    const { service, submissions } = build();
    submissions.findByIds.mockResolvedValue([
      { id: 's1', assignmentId: 'some-other-assignment' },
    ]);
    const error = await service
      .evaluateBulk(ASSIGNMENT_ID, { rows: rowsFor(['s1']) }, teacherActor)
      .catch((e: BadRequestException) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(
      JSON.stringify((error as BadRequestException).getResponse()),
    ).toMatch(/does not belong to this assignment/i);
    expect(submissions.evaluate).not.toHaveBeenCalled();
  });

  it('refuses a caller without assignment.evaluate', async () => {
    const { service } = build({ codes: [] });
    await expect(
      service.evaluateBulk(
        ASSIGNMENT_ID,
        { rows: rowsFor(['s1']) },
        teacherActor,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('locks a CLOSED assignment against a caller without the override', async () => {
    const { service, submissions } = build({
      assignment: { status: AssignmentStatus.CLOSED },
      codes: ['assignment.evaluate'],
    });
    submissions.findByIds.mockResolvedValue([
      { id: 's1', assignmentId: ASSIGNMENT_ID },
    ]);
    await expect(
      service.evaluateBulk(
        ASSIGNMENT_ID,
        { rows: rowsFor(['s1']) },
        teacherActor,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('lets an override holder mark a CLOSED assignment', async () => {
    const { service, submissions } = build({
      assignment: { status: AssignmentStatus.CLOSED },
      codes: ['assignment.evaluate', 'assignment.evaluate.override'],
    });
    submissions.findByIds.mockResolvedValue([
      { id: 's1', assignmentId: ASSIGNMENT_ID },
    ]);
    await expect(
      service.evaluateBulk(
        ASSIGNMENT_ID,
        { rows: rowsFor(['s1']) },
        teacherActor,
      ),
    ).resolves.toEqual({ updated: 1 });
  });
});

describe('SubmissionsService.returnForRevision', () => {
  const detail = {
    id: 'sub-1',
    assignmentId: ASSIGNMENT_ID,
    status: SubmissionStatus.SUBMITTED,
    marks: 12,
  };

  it('clears the mark when work is handed back', async () => {
    // The mark described the work being replaced; leaving it would print
    // a grade for something nobody can read any more.
    const { service, submissions } = build();
    submissions.findDetail.mockResolvedValue(detail);

    const updated = await service.returnForRevision(
      'sub-1',
      { feedback: 'Question 3 is missing.' },
      teacherActor,
    );
    expect(updated).toMatchObject({
      marks: null,
      status: SubmissionStatus.RETURNED,
    });
  });

  it('refuses a return with no feedback', async () => {
    const { service, submissions } = build();
    submissions.findDetail.mockResolvedValue(detail);
    await expect(
      service.returnForRevision('sub-1', { feedback: '  ' }, teacherActor),
    ).rejects.toThrow(BadRequestException);
  });
});
