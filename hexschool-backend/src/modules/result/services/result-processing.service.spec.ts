import { ConflictException } from '@nestjs/common';
import {
  ExamStatus,
  MarkStatus,
  ResultRunStatus,
  ResultStatus,
} from '../../../common/constants';
import { ResultProcessingService } from './result-processing.service';
import { NCTB } from '../calc/grading-snapshot.spec';

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

const enrollment = {
  id: 'en-1',
  studentId: 'st-1',
  rollNo: 1,
  classId: 'cls-7',
  sectionId: 'sec-1',
  optionalSubjectId: null,
  student: { firstName: 'Rahim', lastName: 'Uddin' },
};

const markRow = (over: Record<string, unknown> = {}) => ({
  id: 'mark-1',
  enrollmentId: 'en-1',
  examSubjectId: 'es-1',
  cq: null,
  mcq: null,
  practical: null,
  ca: null,
  total: 82,
  isAbsent: false,
  ...over,
});

describe('ResultProcessingService', () => {
  let runs: Record<string, jest.Mock>;
  let results: Record<string, jest.Mock>;
  let marks: Record<string, jest.Mock>;
  let candidates: Record<string, jest.Mock>;
  let exams: Record<string, jest.Mock>;
  let gradingSystems: Record<string, jest.Mock>;
  let config: { load: jest.Mock };
  let service: ResultProcessingService;

  const examRow = (over: Record<string, unknown> = {}) => ({
    id: 'exam-1',
    name: 'Half-Yearly',
    status: ExamStatus.MARK_ENTRY,
    sessionId: 'sess-1',
    examTypeId: 'type-1',
    gradingSystemId: 'gs-1',
    gradingSnapshot: NCTB,
    ...over,
  });

  beforeEach(() => {
    runs = {
      findById: jest.fn().mockResolvedValue({
        id: 'run-1',
        examId: 'exam-1',
        status: ResultRunStatus.QUEUED,
        override: false,
        scopeEnrollmentId: null,
        triggeredBy: 'user-1',
      }),
      findLatest: jest.fn().mockResolvedValue(null),
      findLatestCompleted: jest.fn().mockResolvedValue(null),
      findActive: jest.fn().mockResolvedValue(null),
      findRecent: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'run-1', examId: 'exam-1' }),
      update: jest.fn((_id: string, data: Record<string, unknown>) =>
        Promise.resolve({ id: 'run-1', ...data }),
      ),
    };
    results = {
      countForExam: jest.fn().mockResolvedValue(0),
      countByStatus: jest.fn().mockResolvedValue([]),
      findForCandidate: jest.fn().mockResolvedValue(null),
      findForExam: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue('res-1'),
      setMerit: jest.fn(),
      withTransaction: jest.fn((fn: (tx: unknown) => unknown) =>
        Promise.resolve(fn({})),
      ),
    };
    marks = {
      findForExam: jest.fn().mockResolvedValue([markRow()]),
      countByStatusForExam: jest
        .fn()
        .mockResolvedValue([
          { examSubjectId: 'es-1', status: MarkStatus.LOCKED, count: 1 },
        ]),
      lastChangedAt: jest.fn().mockResolvedValue(null),
      setGrade: jest.fn(),
    };
    candidates = {
      loadPapers: jest.fn().mockResolvedValue([paper()]),
      candidatesForExam: jest
        .fn()
        .mockResolvedValue(new Map([['en-1', enrollment]])),
      papersForCandidate: jest.fn().mockReturnValue([paper()]),
    };
    exams = {
      findDetail: jest.fn().mockResolvedValue(examRow()),
      setStatus: jest.fn(),
    };
    gradingSystems = { findByIdWithPoints: jest.fn() };
    config = {
      load: jest.fn().mockResolvedValue({
        graceMarks: 0,
        graceMaxSubjects: 1,
        optionalBonusBase: 2,
        meritTiebreak: 'NONE',
        requireLockedMarks: true,
      }),
    };

    service = new ResultProcessingService(
      runs as never,
      results as never,
      marks as never,
      candidates as never,
      exams as never,
      gradingSystems as never,
      config as never,
      { set: jest.fn() } as never,
    );
  });

  describe('enqueue', () => {
    it('creates a QUEUED run and moves the exam to PROCESSING', async () => {
      await service.enqueue('exam-1', {}, actor);

      expect(runs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          examId: 'exam-1',
          status: ResultRunStatus.QUEUED,
        }),
      );
      expect(exams.setStatus).toHaveBeenCalledWith(
        'exam-1',
        expect.objectContaining({ status: ExamStatus.PROCESSING }),
      );
    });

    it('refuses when a paper is not LOCKED, listing the offenders', async () => {
      marks.countByStatusForExam.mockResolvedValue([
        { examSubjectId: 'es-1', status: MarkStatus.SUBMITTED, count: 1 },
      ]);

      await expect(service.enqueue('exam-1', {}, actor)).rejects.toThrow(
        /not LOCKED/,
      );
    });

    it('treats a paper with NO marks as unlocked', async () => {
      // An untouched paper is exactly what the gate exists to catch —
      // "nothing to lock" must not read as "locked".
      marks.countByStatusForExam.mockResolvedValue([]);

      await expect(service.enqueue('exam-1', {}, actor)).rejects.toThrow(
        /not LOCKED/,
      );
    });

    it('lets override through, and records it on the run', async () => {
      marks.countByStatusForExam.mockResolvedValue([]);

      await service.enqueue('exam-1', { override: true }, actor);

      expect(runs.create).toHaveBeenCalledWith(
        expect.objectContaining({ override: true }),
      );
    });

    it('refuses a second concurrent run', async () => {
      // Two runs would race the merit pass and rank half the exam
      // against the other half's GPAs.
      runs.findActive.mockResolvedValue({
        id: 'run-0',
        status: ResultRunStatus.RUNNING,
      });

      await expect(service.enqueue('exam-1', {}, actor)).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuses on an exam that has not reached mark entry', async () => {
      exams.findDetail.mockResolvedValue(examRow({ status: ExamStatus.DRAFT }));

      await expect(service.enqueue('exam-1', {}, actor)).rejects.toThrow(
        /no marks to process/,
      );
    });
  });

  describe('execute', () => {
    it('writes a result and the per-subject grade back onto the mark', async () => {
      const run = await service.execute('run-1', 'school-1');

      expect(marks.setGrade).toHaveBeenCalledWith(
        'mark-1',
        expect.objectContaining({ grade: 'A+', gradePoint: 5 }),
        expect.anything(),
      );
      expect(results.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          enrollmentId: 'en-1',
          gpa: 5,
          grade: 'A+',
          status: ResultStatus.PASSED,
        }),
        expect.anything(),
      );
      expect(run.status).toBe(ResultRunStatus.COMPLETED);
    });

    it('assigns merit in a second pass', async () => {
      await service.execute('run-1', 'school-1');

      expect(results.setMerit).toHaveBeenCalledWith(
        'res-1',
        { section: 1, class: 1 },
        expect.anything(),
      );
    });

    it('reports a missing mark as an issue and an INCOMPLETE result', async () => {
      marks.findForExam.mockResolvedValue([]);

      const run = await service.execute('run-1', 'school-1');

      expect(results.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ status: ResultStatus.INCOMPLETE }),
        expect.anything(),
      );
      expect(run.issues).toEqual([
        expect.objectContaining({ kind: 'MISSING_MARKS' }),
      ]);
    });

    it('never releases a WITHHELD result by recomputing it', async () => {
      results.findForCandidate.mockResolvedValue({
        status: ResultStatus.WITHHELD,
        withheldReason: 'Outstanding dues',
        publishedAt: null,
      });

      await service.execute('run-1', 'school-1');

      expect(results.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ResultStatus.WITHHELD,
          withheldReason: 'Outstanding dues',
        }),
        expect.anything(),
      );
    });

    it('records a failure on the run instead of throwing', async () => {
      candidates.loadPapers.mockResolvedValue([]);

      const run = await service.execute('run-1', 'school-1');

      expect(run.status).toBe(ResultRunStatus.FAILED);
      expect(String(run.error)).toMatch(/no papers/);
    });

    it('is a no-op on an already COMPLETED run', async () => {
      runs.findById.mockResolvedValue({
        id: 'run-1',
        examId: 'exam-1',
        status: ResultRunStatus.COMPLETED,
      });

      await service.execute('run-1', 'school-1');
      expect(results.upsert).not.toHaveBeenCalled();
    });
  });

  describe('grade-scale freezing', () => {
    it('freezes the live scale onto the exam on the FIRST run', async () => {
      // M14 froze at PUBLISH, which left results graded through a table
      // that could still change before publication.
      exams.findDetail.mockResolvedValue(examRow({ gradingSnapshot: null }));
      gradingSystems.findByIdWithPoints.mockResolvedValue({
        id: 'gs-1',
        name: 'NCTB Standard',
        gradePoints: NCTB.gradePoints.map((band) => ({
          ...band,
          point: { toString: () => String(band.point) },
        })),
      });

      await service.execute('run-1', 'school-1');

      const [examArg, payload] = exams.setStatus.mock.calls[0] as [
        string,
        { gradingSnapshot: { name: string; gradePoints: unknown[] } },
      ];
      expect(examArg).toBe('exam-1');
      expect(payload.gradingSnapshot.name).toBe('NCTB Standard');
      expect(payload.gradingSnapshot.gradePoints.length).toBeGreaterThan(0);
    });

    it('reuses the frozen copy on later runs, never the live table', async () => {
      await service.execute('run-1', 'school-1');
      expect(gradingSystems.findByIdWithPoints).not.toHaveBeenCalled();
    });
  });

  describe('status', () => {
    it('flags results as stale when a mark moved after the last run', async () => {
      results.countForExam.mockResolvedValue(30);
      runs.findLatestCompleted.mockResolvedValue({
        id: 'run-1',
        finishedAt: new Date('2026-07-22T10:00:00Z'),
      });
      marks.lastChangedAt.mockResolvedValue(new Date('2026-07-22T11:00:00Z'));

      const status = await service.status('exam-1', 'school-1');
      expect(status.stale).toBe(true);
    });

    it('is not stale when nothing has changed since', async () => {
      results.countForExam.mockResolvedValue(30);
      runs.findLatestCompleted.mockResolvedValue({
        id: 'run-1',
        finishedAt: new Date('2026-07-22T10:00:00Z'),
      });
      marks.lastChangedAt.mockResolvedValue(new Date('2026-07-22T09:00:00Z'));

      const status = await service.status('exam-1', 'school-1');
      expect(status.stale).toBe(false);
    });
  });
});
