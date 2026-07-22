import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  ExamStatus,
  MarkStatus,
  SessionStatus,
} from '../../../common/constants';
import { MarksService } from './marks.service';

const actor = {
  sub: 'user-1',
  schoolId: 'school-1',
  userType: 'STAFF',
} as never;

const paper = (over: Record<string, unknown> = {}) => ({
  examSubjectId: 'es-1',
  examId: 'exam-1',
  classId: 'cls-7',
  className: 'Class 7',
  subjectId: 'sub-1',
  subjectName: 'Bangla',
  subjectNameBn: null,
  subjectCode: 'BAN',
  fullMarks: 100,
  passMarks: 33,
  componentMarks: {},
  componentPassMarks: {},
  isOptional: false,
  displayOrder: 0,
  ...over,
});

/**
 * The per-cell reasons behind a refused save. They travel in
 * `error.details.marks` (the shape the grid paints), so pulling them out
 * typed beats matching on a nested `expect.objectContaining`.
 */
const refusedCells = async (
  saving: Promise<unknown>,
): Promise<Array<{ enrollmentId: string; field: string; message: string }>> => {
  try {
    await saving;
  } catch (error) {
    const body = (error as BadRequestException).getResponse() as {
      details?: {
        marks?: Array<{ enrollmentId: string; field: string; message: string }>;
      };
    };
    return body.details?.marks ?? [];
  }
  throw new Error('Expected the save to be refused, but it succeeded');
};

const enrollment = (id: string, roll: number) => ({
  id,
  studentId: `st-${id}`,
  rollNo: roll,
  sectionId: 'sec-1',
  classId: 'cls-7',
  optionalSubjectId: null,
  student: {
    studentUid: `HXS-${roll}`,
    firstName: 'Rahim',
    lastName: `Uddin ${roll}`,
  },
  section: { name: 'A' },
});

describe('MarksService', () => {
  let marks: Record<string, jest.Mock>;
  let corrections: Record<string, jest.Mock>;
  let candidates: Record<string, jest.Mock>;
  let exams: Record<string, jest.Mock>;
  let sessions: Record<string, jest.Mock>;
  let auditContext: { set: jest.Mock };
  let service: MarksService;

  beforeEach(() => {
    marks = {
      findForPaper: jest.fn().mockResolvedValue([]),
      saveGrid: jest.fn().mockResolvedValue(2),
      setStatusForPaper: jest.fn().mockResolvedValue(2),
      countByStatusForExam: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      update: jest.fn(),
      withTransaction: jest.fn((fn: (tx: unknown) => unknown) =>
        Promise.resolve(fn({})),
      ),
    };
    corrections = { create: jest.fn(), findForExam: jest.fn() };
    candidates = {
      loadPapers: jest.fn().mockResolvedValue([paper()]),
      candidatesForPaper: jest
        .fn()
        .mockResolvedValue([enrollment('en-1', 1), enrollment('en-2', 2)]),
    };
    exams = {
      loadExam: jest.fn().mockResolvedValue({
        id: 'exam-1',
        name: 'Half-Yearly',
        status: ExamStatus.MARK_ENTRY,
        sessionId: 'sess-1',
      }),
    };
    sessions = {
      getById: jest
        .fn()
        .mockResolvedValue({ name: '2026', status: SessionStatus.ACTIVE }),
    };
    auditContext = { set: jest.fn() };

    service = new MarksService(
      marks as never,
      corrections as never,
      candidates as never,
      exams as never,
      sessions as never,
      { getUserPermissionCodes: jest.fn().mockResolvedValue([]) } as never,
      auditContext as never,
    );
  });

  /** The rows the service handed to `saveGrid`, typed. */
  const savedRows = (): Array<Record<string, unknown>> =>
    (marks.saveGrid.mock.calls[0] as [Array<Record<string, unknown>>])[0];

  describe('grid', () => {
    it('lists the roster with blanks for candidates not yet marked', async () => {
      const grid = await service.grid(
        'exam-1',
        { examSubjectId: 'es-1' },
        'school-1',
      );

      expect(grid.rows).toHaveLength(2);
      expect(grid.rows[0].markId).toBeNull();
      expect(grid.entered).toBe(0);
      expect(grid.status).toBe(MarkStatus.DRAFT);
      expect(grid.editable).toBe(true);
    });

    it('advertises the component columns of a split paper', async () => {
      candidates.loadPapers.mockResolvedValue([
        paper({ componentMarks: { cq: 75, practical: 25 } }),
      ]);

      const grid = await service.grid(
        'exam-1',
        { examSubjectId: 'es-1' },
        'school-1',
      );

      expect(grid.components).toEqual(['cq', 'practical']);
    });

    it('404s for a paper that is not on this exam', async () => {
      await expect(
        service.grid('exam-1', { examSubjectId: 'other' }, 'school-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('save', () => {
    it('stores the grid and clears any grade a previous run wrote', async () => {
      await service.save(
        'exam-1',
        {
          examSubjectId: 'es-1',
          marks: [
            { enrollmentId: 'en-1', total: 67 },
            { enrollmentId: 'en-2', isAbsent: true },
          ],
        },
        actor,
      );

      const rows = savedRows();
      expect(rows[0]).toMatchObject({
        total: 67,
        grade: null,
        gradePoint: null,
      });
      // An absent candidate carries no marks at all — the DB CHECK
      // enforces the same thing.
      expect(rows[1]).toMatchObject({ total: 0, isAbsent: true, cq: null });
    });

    it('derives a split paper’s total from its components', async () => {
      candidates.loadPapers.mockResolvedValue([
        paper({ componentMarks: { cq: 75, practical: 25 } }),
      ]);

      await service.save(
        'exam-1',
        {
          examSubjectId: 'es-1',
          marks: [{ enrollmentId: 'en-1', cq: 60, practical: 20 }],
        },
        actor,
      );

      expect(savedRows()[0]).toMatchObject({ total: 80 });
    });

    it('refuses the WHOLE payload when one cell is invalid', async () => {
      await expect(
        service.save(
          'exam-1',
          {
            examSubjectId: 'es-1',
            marks: [
              { enrollmentId: 'en-1', total: 67 },
              { enrollmentId: 'en-2', total: 140 },
            ],
          },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);

      // Nothing saved — half a section is worse than a rejection.
      expect(marks.saveGrid).not.toHaveBeenCalled();
    });

    it('refuses a candidate who is not on the paper’s roster', async () => {
      // The per-cell reason travels in `error.details.marks` — that is
      // what the grid paints; the top-level message is just the count.
      const errors = await refusedCells(
        service.save(
          'exam-1',
          {
            examSubjectId: 'es-1',
            marks: [{ enrollmentId: 'stranger', total: 50 }],
          },
          actor,
        ),
      );

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toMatch(/not on the paper/);
    });

    it('names the optional-subject case specifically', async () => {
      candidates.loadPapers.mockResolvedValue([paper({ isOptional: true })]);
      candidates.candidatesForPaper.mockResolvedValue([]);

      const errors = await refusedCells(
        service.save(
          'exam-1',
          {
            examSubjectId: 'es-1',
            marks: [{ enrollmentId: 'en-1', total: 50 }],
          },
          actor,
        ),
      );

      expect(errors[0].message).toMatch(/did not take the optional subject/);
    });

    it('refuses to overwrite a LOCKED paper', async () => {
      marks.findForPaper.mockResolvedValue([
        { enrollmentId: 'en-1', status: MarkStatus.LOCKED },
      ]);

      await expect(
        service.save(
          'exam-1',
          {
            examSubjectId: 'es-1',
            marks: [{ enrollmentId: 'en-1', total: 50 }],
          },
          actor,
        ),
      ).rejects.toThrow(/use the correction flow/);
    });

    it('refuses while the exam is not in MARK_ENTRY', async () => {
      exams.loadExam.mockResolvedValue({
        id: 'exam-1',
        name: 'Half-Yearly',
        status: ExamStatus.SCHEDULED,
        sessionId: 'sess-1',
      });

      await expect(
        service.save('exam-1', { examSubjectId: 'es-1', marks: [] }, actor),
      ).rejects.toThrow(/move it to MARK_ENTRY/);
    });

    it('refuses in a COMPLETED session (the M05 read-only rule)', async () => {
      sessions.getById.mockResolvedValue({
        name: '2025',
        status: SessionStatus.COMPLETED,
      });

      await expect(
        service.save('exam-1', { examSubjectId: 'es-1', marks: [] }, actor),
      ).rejects.toThrow(/read-only/);
    });
  });

  describe('lifecycle', () => {
    it('submits a complete DRAFT paper', async () => {
      marks.findForPaper.mockResolvedValue([
        { enrollmentId: 'en-1', status: MarkStatus.DRAFT },
        { enrollmentId: 'en-2', status: MarkStatus.DRAFT },
      ]);

      const result = await service.submit('exam-1', 'es-1', actor);

      expect(result.status).toBe(MarkStatus.SUBMITTED);
      expect(marks.setStatusForPaper).toHaveBeenCalledWith(
        'es-1',
        [MarkStatus.DRAFT],
        expect.objectContaining({ status: MarkStatus.SUBMITTED }),
      );
    });

    it('refuses to submit a partially-entered paper', async () => {
      // A verifier signing off on a sheet with three students missing is
      // exactly the mistake this guard exists for.
      marks.findForPaper.mockResolvedValue([
        { enrollmentId: 'en-1', status: MarkStatus.DRAFT },
      ]);

      await expect(service.submit('exam-1', 'es-1', actor)).rejects.toThrow(
        /1 candidate\(s\) still have no mark/,
      );
    });

    it('refuses to verify something that was never submitted', async () => {
      marks.findForPaper.mockResolvedValue([
        { enrollmentId: 'en-1', status: MarkStatus.DRAFT },
      ]);

      await expect(service.verify('exam-1', 'es-1', actor)).rejects.toThrow(
        ConflictException,
      );
    });

    it('locks a verified paper', async () => {
      marks.findForPaper.mockResolvedValue([
        { enrollmentId: 'en-1', status: MarkStatus.VERIFIED },
      ]);

      const result = await service.lock('exam-1', 'es-1', actor);
      expect(result.status).toBe(MarkStatus.LOCKED);
    });

    it('refuses any move on a paper with no marks at all', async () => {
      await expect(service.submit('exam-1', 'es-1', actor)).rejects.toThrow(
        /No marks have been entered/,
      );
    });
  });

  describe('correction', () => {
    const locked = {
      id: 'mark-1',
      examId: 'exam-1',
      examSubjectId: 'es-1',
      enrollmentId: 'en-1',
      status: MarkStatus.LOCKED,
      cq: null,
      mcq: null,
      practical: null,
      ca: null,
      total: 45,
      isAbsent: false,
      grade: 'C',
      remarks: null,
    };

    it('logs the change before touching the mark', async () => {
      marks.findById.mockResolvedValue(locked);

      const result = await service.correct(
        'exam-1',
        'mark-1',
        {
          enrollmentId: 'en-1',
          total: 55,
          reason: 'Re-check: page 3 unmarked',
        },
        actor,
      );

      const [logged] = corrections.create.mock.calls[0] as [
        {
          markId: string;
          oldValues: { total: number };
          newValues: { total: number };
          reason: string;
        },
      ];
      expect(logged.markId).toBe('mark-1');
      expect(logged.oldValues.total).toBe(45);
      expect(logged.newValues.total).toBe(55);
      expect(logged.reason).toBe('Re-check: page 3 unmarked');
      // The grade is cleared, never recomputed here — only a run may
      // write one, because it has to redo the GPA and merit too.
      expect(marks.update).toHaveBeenCalledWith(
        'mark-1',
        expect.objectContaining({ grade: null, gradePoint: null }),
        expect.anything(),
      );
      expect(result.reprocess).toBe(true);
    });

    it('refuses to correct a mark that is not locked', async () => {
      marks.findById.mockResolvedValue({ ...locked, status: MarkStatus.DRAFT });

      await expect(
        service.correct(
          'exam-1',
          'mark-1',
          { enrollmentId: 'en-1', total: 55, reason: 'x' },
          actor,
        ),
      ).rejects.toThrow(/edit the grid instead/);
    });

    it('validates the corrected value against the paper', async () => {
      marks.findById.mockResolvedValue(locked);

      await expect(
        service.correct(
          'exam-1',
          'mark-1',
          { enrollmentId: 'en-1', total: 150, reason: 'typo' },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(corrections.create).not.toHaveBeenCalled();
    });
  });

  describe('paperStatuses', () => {
    it('reports an untouched paper as DRAFT, not locked', async () => {
      // The processing gate depends on this: "no marks" must never look
      // like "nothing left to lock".
      const statuses = await service.paperStatuses('exam-1', 'school-1');

      expect(statuses[0]).toMatchObject({
        status: MarkStatus.DRAFT,
        entered: 0,
        candidates: 2,
        locked: false,
      });
    });

    it('reports a fully locked paper as locked', async () => {
      marks.countByStatusForExam.mockResolvedValue([
        { examSubjectId: 'es-1', status: MarkStatus.LOCKED, count: 2 },
      ]);

      const statuses = await service.paperStatuses('exam-1', 'school-1');
      expect(statuses[0]).toMatchObject({
        status: MarkStatus.LOCKED,
        locked: true,
      });
    });

    it('reports a half-submitted paper by its furthest-back mark', async () => {
      marks.countByStatusForExam.mockResolvedValue([
        { examSubjectId: 'es-1', status: MarkStatus.SUBMITTED, count: 1 },
        { examSubjectId: 'es-1', status: MarkStatus.DRAFT, count: 1 },
      ]);

      const statuses = await service.paperStatuses('exam-1', 'school-1');
      expect(statuses[0].status).toBe(MarkStatus.DRAFT);
    });
  });
});
