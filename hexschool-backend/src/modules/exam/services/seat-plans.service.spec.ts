import { ConflictException } from '@nestjs/common';
import { SeatPlanStrategy, UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SeatPlansService } from './seat-plans.service';

/**
 * Roadmap M14 §6: "Only enrolled ACTIVE students of attached classes are
 * candidates; optional-subject students only sit their chosen optional."
 * That rule — not the seating arithmetic, which the engine spec covers —
 * is what these tests are for.
 */
describe('SeatPlansService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };

  const EXAM = {
    id: 'exam-1',
    schoolId: 'school-1',
    sessionId: 'ses-1',
    name: 'Half Yearly',
    status: 'SCHEDULED',
    examClasses: [{ classId: 'cls-9' }],
  };

  const enrollment = (
    id: string,
    rollNo: number,
    optionalSubjectId: string | null = null,
  ) => ({
    id,
    classId: 'cls-9',
    rollNo,
    studentId: `stu-${id}`,
    optionalSubjectId,
    student: {
      studentUid: `UID-${id}`,
      firstName: 'S',
      lastName: id,
    },
    class: { id: 'cls-9', name: 'Class 9' },
    section: { id: 'sec-a', name: 'A' },
  });

  const paper = (subjectId: string) => ({
    id: `paper-${subjectId}`,
    examId: 'exam-1',
    classId: 'cls-9',
    subjectId,
    class: { name: 'Class 9' },
    subject: { name: subjectId },
  });

  let seatPlans: Record<string, jest.Mock>;
  let examSubjects: Record<string, jest.Mock>;
  let enrollments: Record<string, jest.Mock>;
  let classSubjects: Record<string, jest.Mock>;
  let exams: Record<string, jest.Mock>;
  let config: Record<string, jest.Mock>;
  let auditContext: Record<string, jest.Mock>;
  let service: SeatPlansService;

  beforeEach(() => {
    seatPlans = {
      findForExam: jest.fn().mockResolvedValue([]),
      findSeatedEnrollmentIds: jest.fn().mockResolvedValue(new Set()),
      replaceForDate: jest.fn().mockResolvedValue({ rooms: 1, seats: 3 }),
      addEntry: jest.fn().mockResolvedValue(undefined),
      deleteForDate: jest.fn().mockResolvedValue(1),
    };
    examSubjects = {
      findForExamDate: jest.fn().mockResolvedValue([paper('bangla')]),
    };
    enrollments = {
      findClassRoster: jest
        .fn()
        .mockResolvedValue([
          enrollment('a', 1),
          enrollment('b', 2),
          enrollment('c', 3),
        ]),
      findById: jest.fn().mockResolvedValue(enrollment('late', 99)),
      findDetail: jest.fn().mockResolvedValue(enrollment('late', 99)),
    };
    classSubjects = {
      findForClassSession: jest
        .fn()
        .mockResolvedValue([{ subjectId: 'bangla', isOptional: false }]),
    };
    exams = { loadExam: jest.fn().mockResolvedValue(EXAM) };
    config = {
      load: jest.fn().mockResolvedValue({
        seatPlanDefaultCapacity: 30,
        seatPlanDefaultStrategy: SeatPlanStrategy.SERPENTINE,
      }),
    };
    auditContext = { set: jest.fn() };

    service = new SeatPlansService(
      seatPlans as never,
      examSubjects as never,
      enrollments as never,
      classSubjects as never,
      exams as never,
      config as never,
      auditContext as never,
    );
  });

  const generate = (over: Record<string, unknown> = {}) =>
    service.generate(
      'exam-1',
      {
        date: '2026-06-02',
        rooms: [{ room: 'H1', capacity: 30 }],
        ...over,
      },
      actor,
    );

  describe('candidate resolution', () => {
    it('seats the whole class for a compulsory paper', async () => {
      const rows = await service.candidates('exam-1', 'school-1', '2026-06-02');
      expect(rows.map((r) => r.enrollmentId)).toEqual(['a', 'b', 'c']);
    });

    it('seats only the choosers for an OPTIONAL paper', async () => {
      classSubjects.findForClassSession.mockResolvedValue([
        { subjectId: 'higher-math', isOptional: true },
      ]);
      examSubjects.findForExamDate.mockResolvedValue([paper('higher-math')]);
      enrollments.findClassRoster.mockResolvedValue([
        enrollment('a', 1, 'higher-math'),
        enrollment('b', 2, null),
        enrollment('c', 3, 'biology'),
      ]);

      const rows = await service.candidates('exam-1', 'school-1', '2026-06-02');
      expect(rows.map((r) => r.enrollmentId)).toEqual(['a']);
    });

    it('never double-seats a student sitting two papers that day', async () => {
      examSubjects.findForExamDate.mockResolvedValue([
        paper('bangla'),
        paper('english'),
      ]);
      classSubjects.findForClassSession.mockResolvedValue([
        { subjectId: 'bangla', isOptional: false },
        { subjectId: 'english', isOptional: false },
      ]);

      const rows = await service.candidates('exam-1', 'school-1', '2026-06-02');
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((r) => r.enrollmentId)).size).toBe(3);
    });

    it('orders candidates by class, then section, then roll', async () => {
      enrollments.findClassRoster.mockResolvedValue([
        enrollment('c', 3),
        enrollment('a', 1),
        enrollment('b', 2),
      ]);
      const rows = await service.candidates('exam-1', 'school-1', '2026-06-02');
      expect(rows.map((r) => r.rollNo)).toEqual([1, 2, 3]);
    });
  });

  describe('generation guards', () => {
    it('refuses a date with no scheduled papers', async () => {
      examSubjects.findForExamDate.mockResolvedValue([]);
      await expect(generate()).rejects.toThrow(/No papers are scheduled/);
    });

    it('refuses when nobody sits anything that day', async () => {
      enrollments.findClassRoster.mockResolvedValue([]);
      await expect(generate()).rejects.toThrow(/No active candidates/);
    });

    it('refuses duplicate room names (they would collide on the unique index)', async () => {
      await expect(
        generate({
          rooms: [
            { room: 'H1', capacity: 10 },
            { room: ' h1 ', capacity: 10 },
          ],
        }),
      ).rejects.toThrow(/unique within a date/);
    });

    it('refuses when total capacity is short of the candidate count', async () => {
      await expect(
        generate({ rooms: [{ room: 'H1', capacity: 2 }] }),
      ).rejects.toThrow(/only 2 seat\(s\)/);
    });

    it('refuses an ARCHIVED exam', async () => {
      exams.loadExam.mockResolvedValue({ ...EXAM, status: 'ARCHIVED' });
      await expect(generate()).rejects.toThrow(ConflictException);
    });
  });

  describe('generation', () => {
    it('writes every room of the date in one replace call', async () => {
      const result = await generate();
      expect(seatPlans.replaceForDate).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        date: '2026-06-02',
        strategy: SeatPlanStrategy.SERPENTINE,
        candidates: 3,
        capacity: 30,
      });
    });

    it('falls back to the configured default strategy', async () => {
      config.load.mockResolvedValue({
        seatPlanDefaultCapacity: 30,
        seatPlanDefaultStrategy: SeatPlanStrategy.INTERLEAVE,
      });
      const result = await generate();
      expect(result.strategy).toBe(SeatPlanStrategy.INTERLEAVE);
    });

    it('honours an explicit strategy over the default', async () => {
      const result = await generate({
        strategy: SeatPlanStrategy.INTERLEAVE,
      });
      expect(result.strategy).toBe(SeatPlanStrategy.INTERLEAVE);
    });
  });

  describe('appending a late enrollee', () => {
    const withPlan = (seats: number, capacity = 3) =>
      seatPlans.findForExam.mockResolvedValue([
        {
          id: 'plan-1',
          room: 'H1',
          capacity,
          entries: Array.from({ length: seats }, (_, i) => ({
            enrollmentId: `e${i}`,
            seatNo: i + 1,
          })),
        },
      ]);

    const append = () =>
      service.appendCandidate(
        'exam-1',
        { date: '2026-06-02', enrollmentId: 'late' },
        actor,
      );

    it('refuses when no plan exists for the date', async () => {
      seatPlans.findForExam.mockResolvedValue([]);
      await expect(append()).rejects.toThrow(/generate one first/);
    });

    it('takes the next free seat without disturbing the others', async () => {
      withPlan(2);
      await expect(append()).resolves.toEqual({ room: 'H1', seatNo: 3 });
      expect(seatPlans.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({ seatPlanId: 'plan-1', seatNo: 3 }),
      );
      // Crucially NOT a regeneration — printed admit cards stay valid.
      expect(seatPlans.replaceForDate).not.toHaveBeenCalled();
    });

    it('refuses a candidate who already has a seat that date', async () => {
      withPlan(2);
      seatPlans.findSeatedEnrollmentIds.mockResolvedValue(new Set(['late']));
      await expect(append()).rejects.toThrow(/already has a seat/);
    });

    it('refuses when every room is full', async () => {
      withPlan(3, 3);
      await expect(append()).rejects.toThrow(/Every room is full/);
    });

    it('refuses an unknown enrollment', async () => {
      withPlan(1);
      enrollments.findById.mockResolvedValue(null);
      await expect(append()).rejects.toThrow(/not found/);
    });
  });

  it('refuses to delete a plan for a date that has none', async () => {
    seatPlans.deleteForDate.mockResolvedValue(0);
    await expect(
      service.removeForDate('exam-1', '2026-06-02', actor),
    ).rejects.toThrow(/No seat plan exists/);
  });
});
