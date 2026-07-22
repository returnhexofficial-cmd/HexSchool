import { BadRequestException, ConflictException } from '@nestjs/common';
import { ExamStatus, UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import type { Sitting } from '../calc/exam-clash.engine';
import { ExamSubjectsService } from './exam-subjects.service';

/**
 * The paper grid: whole-payload validation (a bad row never half-saves),
 * the all-or-nothing sitting rule, and the roadmap §8 curriculum sync.
 */
describe('ExamSubjectsService', () => {
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
    status: ExamStatus.DRAFT,
    startDate: new Date('2026-06-01'),
    endDate: new Date('2026-06-15'),
    examClasses: [
      { classId: 'cls-9', class: { id: 'cls-9', name: 'Class 9' } },
    ],
  };

  let examSubjects: Record<string, jest.Mock>;
  let examsRepo: Record<string, jest.Mock>;
  let classSubjects: Record<string, jest.Mock>;
  let subjects: Record<string, jest.Mock>;
  let exams: Record<string, jest.Mock>;
  let clashes: Record<string, jest.Mock>;
  let config: Record<string, jest.Mock>;
  let auditContext: Record<string, jest.Mock>;
  let service: ExamSubjectsService;

  beforeEach(() => {
    examSubjects = {
      findForExam: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
      createMany: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'new' }),
      update: jest.fn().mockResolvedValue({ id: 'es-1' }),
      deleteMany: jest.fn().mockResolvedValue(0),
    };
    examsRepo = {
      withTransaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => unknown) => fn({})),
    };
    classSubjects = { findForClassSession: jest.fn().mockResolvedValue([]) };
    subjects = {
      findById: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve({ id, name: `Subject ${id}` }),
        ),
    };
    exams = { loadExam: jest.fn().mockResolvedValue(EXAM) };
    clashes = {
      assertScheduleAllowed: jest.fn().mockResolvedValue([]),
      // Mirrors the real mapping closely enough for the callers under
      // test; ExamClashService has its own spec for the mapping itself.
      toSitting: jest.fn().mockImplementation((row: Record<string, never>) => {
        const start = row.startTime
          ? (row.startTime as Date).getUTCHours() * 60 +
            (row.startTime as Date).getUTCMinutes()
          : 0;
        return {
          examSubjectId: row.id,
          examId: row.examId,
          classId: row.classId,
          classLabel: 'Class 9',
          subjectId: row.subjectId,
          subjectName: 'x',
          date: row.examDate
            ? (row.examDate as Date).toISOString().slice(0, 10)
            : '',
          startMinutes: start,
          endMinutes: start + ((row.durationMin as unknown as number) ?? 0),
          room: row.room ?? null,
        };
      }),
    };
    config = {
      load: jest
        .fn()
        .mockResolvedValue({ defaultFullMarks: 100, defaultPassMark: 33 }),
    };
    auditContext = { set: jest.fn() };

    service = new ExamSubjectsService(
      examSubjects as never,
      examsRepo as never,
      classSubjects as never,
      subjects as never,
      exams as never,
      clashes as never,
      config as never,
      auditContext as never,
      // M15 delete guard: no marks entered by default.
      { existsForPapers: jest.fn().mockResolvedValue(0) } as never,
    );
  });

  const row = (over: Record<string, unknown> = {}) => ({
    classId: 'cls-9',
    subjectId: 'bangla',
    fullMarks: 100,
    passMarks: 33,
    ...over,
  });

  const replace = (
    subjectRows: Array<Record<string, unknown>>,
    override = false,
  ) =>
    service.replace(
      'exam-1',
      { subjects: subjectRows, override } as never,
      actor,
    );

  /** The sittings the service handed to the clash engine, typed. */
  const scheduledCandidates = (): Sitting[] =>
    (clashes.assertScheduleAllowed.mock.calls[0] as [unknown, Sitting[]])[1];

  const errorsOf = async (
    subjectRows: Array<Record<string, unknown>>,
  ): Promise<string[]> => {
    try {
      await replace(subjectRows);
    } catch (err) {
      const body = (err as { response: { details: { errors: string[] } } })
        .response;
      return body.details.errors;
    }
    throw new Error('expected a BadRequestException');
  };

  describe('whole-payload validation', () => {
    it('accepts a valid grid', async () => {
      await expect(replace([row()])).resolves.toMatchObject({ saved: 1 });
    });

    it('refuses a class that is not attached to the exam', async () => {
      const errors = await errorsOf([row({ classId: 'cls-7' })]);
      expect(errors[0]).toContain('not attached');
    });

    it('refuses a duplicate class+subject pair', async () => {
      const errors = await errorsOf([row(), row()]);
      expect(errors[0]).toContain('duplicate class+subject');
    });

    it('reports EVERY bad row, not just the first', async () => {
      const errors = await errorsOf([
        row({ passMarks: 200 }),
        row({ subjectId: 'english', fullMarks: 0 }),
      ]);
      expect(errors.length).toBeGreaterThanOrEqual(2);
      expect(errors.some((e) => e.includes('row 1'))).toBe(true);
      expect(errors.some((e) => e.includes('row 2'))).toBe(true);
    });

    it('writes nothing when any row is invalid', async () => {
      await errorsOf([row(), row({ subjectId: 'english', passMarks: 500 })]);
      expect(examSubjects.create).not.toHaveBeenCalled();
      expect(examSubjects.update).not.toHaveBeenCalled();
      expect(examSubjects.deleteMany).not.toHaveBeenCalled();
    });

    it('surfaces a component-sum mismatch', async () => {
      const errors = await errorsOf([row({ cqMarks: 60, mcqMarks: 30 })]);
      expect(errors.some((e) => e.includes('add up to full marks'))).toBe(true);
    });
  });

  describe('a sitting is all-or-nothing', () => {
    it('accepts date + time + duration together', async () => {
      await expect(
        replace([
          row({
            examDate: '2026-06-02',
            startTime: '10:00',
            durationMin: 180,
          }),
        ]),
      ).resolves.toMatchObject({ saved: 1 });
    });

    it('refuses a date without a time', async () => {
      const errors = await errorsOf([row({ examDate: '2026-06-02' })]);
      expect(errors[0]).toContain('together');
    });

    it('refuses an impossible calendar date', async () => {
      const errors = await errorsOf([
        row({ examDate: '2026-02-30', startTime: '10:00', durationMin: 90 }),
      ]);
      expect(errors[0]).toContain('not a valid calendar date');
    });

    it('leaves a paper unscheduled when no schedule fields are given', async () => {
      await replace([row()]);
      expect(examSubjects.create).toHaveBeenCalledWith(
        expect.objectContaining({ examDate: null, startTime: null }),
        expect.anything(),
      );
    });
  });

  describe('replacement semantics', () => {
    it('updates a surviving paper in place, keeping its id', async () => {
      examSubjects.findForExam.mockResolvedValue([
        {
          id: 'es-1',
          classId: 'cls-9',
          subjectId: 'bangla',
          subject: { name: 'Bangla' },
        },
      ]);
      await replace([row({ fullMarks: 80, passMarks: 26 })]);
      expect(examSubjects.update).toHaveBeenCalledWith(
        'es-1',
        expect.objectContaining({ fullMarks: 80 }),
        expect.anything(),
      );
      expect(examSubjects.create).not.toHaveBeenCalled();
    });

    it('drops papers absent from the payload', async () => {
      examSubjects.findForExam.mockResolvedValue([
        {
          id: 'es-old',
          classId: 'cls-9',
          subjectId: 'dropped',
          subject: { name: 'Dropped' },
        },
      ]);
      await replace([row()]);
      expect(examSubjects.deleteMany).toHaveBeenCalledWith(
        ['es-old'],
        expect.anything(),
      );
    });

    it('passes only SCHEDULED sittings to the clash engine', async () => {
      await replace([
        row(),
        row({
          subjectId: 'english',
          examDate: '2026-06-02',
          startTime: '10:00',
          durationMin: 120,
        }),
      ]);
      const candidates = scheduledCandidates();
      expect(candidates).toHaveLength(1);
      expect(candidates[0].subjectId).toBe('english');
    });
  });

  describe('frozen states', () => {
    it.each([ExamStatus.PUBLISHED, ExamStatus.ARCHIVED])(
      'refuses edits when the exam is %s',
      async (status) => {
        exams.loadExam.mockResolvedValue({ ...EXAM, status });
        await expect(replace([row()])).rejects.toThrow(ConflictException);
      },
    );
  });

  describe('curriculum sync (roadmap §8)', () => {
    it('reports subjects added to a class since the exam was built', async () => {
      classSubjects.findForClassSession.mockResolvedValue([
        { subjectId: 'bangla', subject: { name: 'Bangla', type: 'THEORY' } },
        { subjectId: 'ict', subject: { name: 'ICT', type: 'THEORY' } },
      ]);
      examSubjects.findForExam.mockResolvedValue([
        {
          id: 'es-1',
          classId: 'cls-9',
          subjectId: 'bangla',
          examDate: null,
          subject: { name: 'Bangla' },
        },
      ]);

      const diff = await service.syncPreview('exam-1', 'school-1');
      expect(diff.missing).toEqual([
        {
          classId: 'cls-9',
          className: 'Class 9',
          subjectId: 'ict',
          subjectName: 'ICT',
        },
      ]);
      expect(diff.stale).toEqual([]);
    });

    it('reports papers whose subject has left the curriculum', async () => {
      classSubjects.findForClassSession.mockResolvedValue([]);
      examSubjects.findForExam.mockResolvedValue([
        {
          id: 'es-1',
          classId: 'cls-9',
          subjectId: 'dropped',
          examDate: new Date('2026-06-02'),
          subject: { name: 'Dropped' },
        },
      ]);

      const diff = await service.syncPreview('exam-1', 'school-1');
      expect(diff.stale).toEqual([
        {
          examSubjectId: 'es-1',
          classId: 'cls-9',
          className: 'Class 9',
          subjectId: 'dropped',
          subjectName: 'Dropped',
          scheduled: true,
        },
      ]);
    });

    it('adds missing papers by default but never removes stale ones', async () => {
      classSubjects.findForClassSession.mockResolvedValue([
        {
          subjectId: 'ict',
          subject: { name: 'ICT', type: 'THEORY' },
          fullMarksDefault: 50,
        },
      ]);
      examSubjects.findForExam.mockResolvedValue([
        {
          id: 'es-1',
          classId: 'cls-9',
          subjectId: 'dropped',
          examDate: null,
          subject: { name: 'Dropped' },
        },
      ]);
      examSubjects.createMany.mockResolvedValue(1);

      const result = await service.syncApply('exam-1', {}, actor);
      expect(result.added).toBe(1);
      expect(result.removed).toBe(0);
      expect(examSubjects.deleteMany).not.toHaveBeenCalled();

      // Seeded from the curriculum's own full_marks_default.
      const rows = (
        examSubjects.createMany.mock.calls[0] as [
          Array<Record<string, unknown>>,
        ]
      )[0];
      expect(rows[0]).toMatchObject({ subjectId: 'ict', fullMarks: 50 });
    });

    it('removes stale papers only when explicitly asked', async () => {
      classSubjects.findForClassSession.mockResolvedValue([]);
      examSubjects.findForExam.mockResolvedValue([
        {
          id: 'es-1',
          classId: 'cls-9',
          subjectId: 'dropped',
          examDate: null,
          subject: { name: 'Dropped' },
        },
      ]);
      examSubjects.deleteMany.mockResolvedValue(1);

      const result = await service.syncApply(
        'exam-1',
        { addMissing: false, removeStale: true },
        actor,
      );
      expect(result.removed).toBe(1);
      expect(examSubjects.deleteMany).toHaveBeenCalledWith(['es-1']);
    });
  });

  describe('single-paper edit', () => {
    const paper = {
      id: 'es-1',
      examId: 'exam-1',
      classId: 'cls-9',
      subjectId: 'bangla',
      fullMarks: 100,
      passMarks: 33,
      examDate: null,
      room: null,
      class: { name: 'Class 9' },
      subject: { name: 'Bangla' },
    };

    it('refuses a paper belonging to another exam', async () => {
      examSubjects.findById.mockResolvedValue({ ...paper, examId: 'other' });
      await expect(
        service.update(
          'exam-1',
          'es-1',
          { fullMarks: 100, passMarks: 33 },
          actor,
        ),
      ).rejects.toThrow(/not found/);
    });

    it('runs the clash engine against every OTHER paper of the exam', async () => {
      examSubjects.findById.mockResolvedValue(paper);
      examSubjects.findForExam.mockResolvedValue([
        paper,
        {
          ...paper,
          id: 'es-2',
          subjectId: 'english',
          examDate: new Date('2026-06-03'),
          startTime: new Date('1970-01-01T10:00:00.000Z'),
          durationMin: 120,
          subject: { name: 'English' },
        },
      ]);

      await service.update(
        'exam-1',
        'es-1',
        {
          fullMarks: 100,
          passMarks: 33,
          examDate: '2026-06-02',
          startTime: '10:00',
          durationMin: 180,
        },
        actor,
      );

      expect(scheduledCandidates().map((c) => c.subjectId)).toEqual([
        'bangla',
        'english',
      ]);
    });

    it('refuses an invalid distribution', async () => {
      examSubjects.findById.mockResolvedValue(paper);
      await expect(
        service.update(
          'exam-1',
          'es-1',
          { fullMarks: 100, passMarks: 150 },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
