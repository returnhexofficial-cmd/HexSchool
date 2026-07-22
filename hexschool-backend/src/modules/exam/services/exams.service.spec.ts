import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ExamStatus, SessionStatus, UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { ExamsService } from './exams.service';

/**
 * The exam-aggregate rules the roadmap (M14 §4/§6) makes non-negotiable:
 * the window lives inside the session, the status machine is guarded at
 * three points, and the grading system is frozen at PUBLISH.
 */
describe('ExamsService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };

  const EXAM: {
    id: string;
    schoolId: string;
    sessionId: string;
    examTypeId: string;
    name: string;
    startDate: Date;
    endDate: Date;
    gradingSystemId: string;
    status: ExamStatus;
    examType: { id: string; name: string; weight: null };
    session: { id: string; name: string; status: SessionStatus };
    gradingSystem: { id: string; name: string; isDefault: boolean };
    examClasses: Array<{
      classId: string;
      class: { id: string; name: string; numericLevel: number };
    }>;
  } = {
    id: 'exam-1',
    schoolId: 'school-1',
    sessionId: 'ses-1',
    examTypeId: 'type-1',
    name: 'Half Yearly 2026',
    startDate: new Date('2026-06-01'),
    endDate: new Date('2026-06-15'),
    gradingSystemId: 'grade-1',
    status: ExamStatus.DRAFT,
    examType: { id: 'type-1', name: 'Half Yearly', weight: null },
    session: { id: 'ses-1', name: '2026', status: SessionStatus.ACTIVE },
    gradingSystem: { id: 'grade-1', name: 'NCTB', isDefault: true },
    examClasses: [
      {
        classId: 'cls-7',
        class: { id: 'cls-7', name: 'Class 7', numericLevel: 7 },
      },
    ],
  };

  let exams: Record<string, jest.Mock>;
  let examSubjects: Record<string, jest.Mock>;
  let seatPlans: Record<string, jest.Mock>;
  let classes: Record<string, jest.Mock>;
  let classSubjects: Record<string, jest.Mock>;
  let gradingSystems: Record<string, jest.Mock>;
  let sessions: Record<string, jest.Mock>;
  let config: Record<string, jest.Mock>;
  let permissions: Record<string, jest.Mock>;
  let resultGate: Record<string, jest.Mock>;
  let auditContext: Record<string, jest.Mock>;
  let service: ExamsService;

  const exam = (over: Partial<typeof EXAM> = {}) => ({ ...EXAM, ...over });

  beforeEach(() => {
    exams = {
      findDetail: jest.fn().mockResolvedValue(exam()),
      findByName: jest.fn().mockResolvedValue(null),
      findClassIds: jest.fn().mockResolvedValue(['cls-7']),
      setClasses: jest.fn().mockResolvedValue(undefined),
      setStatus: jest.fn().mockResolvedValue(exam()),
      create: jest
        .fn()
        .mockImplementation((data: object) =>
          Promise.resolve({ id: 'exam-new', ...data }),
        ),
      update: jest.fn().mockResolvedValue(exam()),
      softDelete: jest.fn().mockResolvedValue(undefined),
      paginateList: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      withTransaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => unknown) => fn({})),
    };
    examSubjects = {
      countForExam: jest.fn().mockResolvedValue(4),
      countUnscheduled: jest.fn().mockResolvedValue(0),
      findExamDates: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue(0),
      deleteForClasses: jest.fn().mockResolvedValue(0),
    };
    seatPlans = { countForExam: jest.fn().mockResolvedValue(0) };
    classes = {
      findById: jest.fn().mockResolvedValue({ id: 'cls-7', name: 'Class 7' }),
    };
    classSubjects = { findForClassSession: jest.fn().mockResolvedValue([]) };
    gradingSystems = {
      findById: jest.fn().mockResolvedValue({ id: 'grade-1' }),
      findAllWithPoints: jest
        .fn()
        .mockResolvedValue([{ id: 'grade-1', isDefault: true }]),
      findByIdWithPoints: jest.fn().mockResolvedValue({
        id: 'grade-1',
        name: 'NCTB Standard',
        gradePoints: [
          {
            grade: 'A+',
            point: { toString: () => '5.00' },
            minMark: 80,
            maxMark: 100,
          },
        ],
      }),
    };
    sessions = {
      getById: jest.fn().mockResolvedValue({
        id: 'ses-1',
        name: '2026',
        status: SessionStatus.ACTIVE,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      }),
      getCurrent: jest.fn().mockResolvedValue({ id: 'ses-1' }),
    };
    config = {
      load: jest.fn().mockResolvedValue({
        defaultFullMarks: 100,
        defaultPassMark: 33,
      }),
    };
    permissions = { getUserPermissionCodes: jest.fn().mockResolvedValue([]) };
    resultGate = { canPublish: jest.fn().mockResolvedValue({ ready: true }) };
    auditContext = { set: jest.fn() };

    service = new ExamsService(
      exams as never,
      examSubjects as never,
      seatPlans as never,
      classes as never,
      classSubjects as never,
      gradingSystems as never,
      sessions as never,
      config as never,
      permissions as never,
      auditContext as never,
      resultGate as never,
    );
  });

  /** The column payload the service handed to `setStatus`, typed. */
  const statusUpdate = (): {
    status: ExamStatus;
    resultPublishAt?: Date;
    gradingSnapshot?: {
      gradingSystemId: string;
      name: string;
      gradePoints: Array<Record<string, unknown>>;
    };
  } =>
    (
      exams.setStatus.mock.calls[0] as [
        string,
        {
          status: ExamStatus;
          resultPublishAt?: Date;
          gradingSnapshot?: {
            gradingSystemId: string;
            name: string;
            gradePoints: Array<Record<string, unknown>>;
          };
        },
      ]
    )[1];

  const create = (over: Record<string, unknown> = {}) =>
    service.create(
      {
        examTypeId: 'type-1',
        name: 'Half Yearly 2026',
        startDate: '2026-06-01',
        endDate: '2026-06-15',
        ...over,
      },
      actor,
    );

  describe('the exam window must sit inside the session', () => {
    it('accepts a window fully inside it', async () => {
      await expect(create()).resolves.toBeDefined();
    });

    it('refuses a start before the session', async () => {
      await expect(create({ startDate: '2025-12-01' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses an end after the session', async () => {
      await expect(create({ endDate: '2027-02-01' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses an inverted window', async () => {
      await expect(
        create({ startDate: '2026-06-15', endDate: '2026-06-01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a single-day exam', async () => {
      await expect(
        create({ startDate: '2026-06-05', endDate: '2026-06-05' }),
      ).resolves.toBeDefined();
    });
  });

  describe('session writability (the M05 read-only rule)', () => {
    it('refuses to create an exam in a COMPLETED session', async () => {
      sessions.getById.mockResolvedValue({
        id: 'ses-1',
        name: '2025',
        status: SessionStatus.COMPLETED,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      });
      await expect(create()).rejects.toThrow(/COMPLETED/);
    });
  });

  it('refuses a duplicate exam name within the session', async () => {
    exams.findByName.mockResolvedValue({ id: 'other' });
    await expect(create()).rejects.toThrow(ConflictException);
  });

  describe('grading system resolution', () => {
    it('falls back to the school default when none is given', async () => {
      await create();
      expect(exams.create).toHaveBeenCalledWith(
        expect.objectContaining({ gradingSystemId: 'grade-1' }),
        expect.anything(),
      );
    });

    it('refuses when the school has no default configured', async () => {
      gradingSystems.findAllWithPoints.mockResolvedValue([]);
      await expect(create()).rejects.toThrow(/No default grading system/);
    });

    it('refuses an unknown explicit grading system', async () => {
      gradingSystems.findById.mockResolvedValue(null);
      await expect(create({ gradingSystemId: 'ghost' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('status machine guards', () => {
    const move = (to: ExamStatus, over: Record<string, unknown> = {}) =>
      service.changeStatus('exam-1', { status: to, ...over }, actor);

    it('refuses an illegal jump', async () => {
      await expect(move(ExamStatus.PUBLISHED)).rejects.toThrow(
        BadRequestException,
      );
    });

    describe('→ SCHEDULED needs a complete routine', () => {
      it('refuses when no class is attached', async () => {
        exams.findDetail.mockResolvedValue(exam({ examClasses: [] }));
        await expect(move(ExamStatus.SCHEDULED)).rejects.toThrow(
          /at least one class/,
        );
      });

      it('refuses when the exam has no papers', async () => {
        examSubjects.countForExam.mockResolvedValue(0);
        await expect(move(ExamStatus.SCHEDULED)).rejects.toThrow(/no papers/);
      });

      it('refuses while papers are still unscheduled', async () => {
        examSubjects.countUnscheduled.mockResolvedValue(3);
        await expect(move(ExamStatus.SCHEDULED)).rejects.toThrow(
          /3 paper\(s\) still have no date/,
        );
      });

      it('passes when every paper is scheduled', async () => {
        await expect(move(ExamStatus.SCHEDULED)).resolves.toBeDefined();
      });
    });

    describe('→ MARK_ENTRY is gated on the exam being over', () => {
      const ongoing = () =>
        exam({
          status: ExamStatus.ONGOING,
          endDate: new Date('2099-01-01'),
        });

      it('allows it once the end date has passed', async () => {
        exams.findDetail.mockResolvedValue(
          exam({ status: ExamStatus.ONGOING, endDate: new Date('2020-01-01') }),
        );
        await expect(move(ExamStatus.MARK_ENTRY)).resolves.toBeDefined();
      });

      it('refuses an early open without an override', async () => {
        exams.findDetail.mockResolvedValue(ongoing());
        await expect(move(ExamStatus.MARK_ENTRY)).rejects.toThrow(
          /override=true/,
        );
      });

      it('refuses an early open without the exam.status permission', async () => {
        exams.findDetail.mockResolvedValue(ongoing());
        await expect(
          move(ExamStatus.MARK_ENTRY, { override: true }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('allows an early open with the permission', async () => {
        exams.findDetail.mockResolvedValue(ongoing());
        permissions.getUserPermissionCodes.mockResolvedValue(['exam.status']);
        await expect(
          move(ExamStatus.MARK_ENTRY, { override: true }),
        ).resolves.toBeDefined();
      });

      it('lets a Super Admin open early without a permission lookup', async () => {
        exams.findDetail.mockResolvedValue(ongoing());
        await expect(
          service.changeStatus(
            'exam-1',
            { status: ExamStatus.MARK_ENTRY, override: true },
            { ...actor, userType: UserType.SUPER_ADMIN },
          ),
        ).resolves.toBeDefined();
        expect(permissions.getUserPermissionCodes).not.toHaveBeenCalled();
      });
    });

    describe('→ PUBLISHED is gated by the Module 15 result processor', () => {
      beforeEach(() => {
        exams.findDetail.mockResolvedValue(
          exam({ status: ExamStatus.PROCESSING }),
        );
      });

      it('refuses when the gate says results are not ready', async () => {
        resultGate.canPublish.mockResolvedValue({
          ready: false,
          reason: '2 papers still unprocessed',
        });
        await expect(move(ExamStatus.PUBLISHED)).rejects.toThrow(
          ConflictException,
        );
      });

      it('freezes the grade scale into grading_snapshot on publish', async () => {
        await move(ExamStatus.PUBLISHED);

        const data = statusUpdate();
        expect(data.status).toBe(ExamStatus.PUBLISHED);
        expect(data.resultPublishAt).toBeInstanceOf(Date);
        expect(data.gradingSnapshot).toMatchObject({
          gradingSystemId: 'grade-1',
          name: 'NCTB Standard',
        });
        expect(data.gradingSnapshot?.gradePoints).toEqual([
          { grade: 'A+', point: '5.00', minMark: 80, maxMark: 100 },
        ]);
      });

      it('never snapshots on a non-publish transition', async () => {
        await move(ExamStatus.MARK_ENTRY);
        expect(statusUpdate().gradingSnapshot).toBeUndefined();
      });

      it('refuses to publish when the grading system has been deleted', async () => {
        gradingSystems.findByIdWithPoints.mockResolvedValue(null);
        await expect(move(ExamStatus.PUBLISHED)).rejects.toThrow(
          /no longer exists/,
        );
      });
    });
  });

  describe('narrowing the window cannot strand a sitting', () => {
    it('refuses when a scheduled sitting would fall outside', async () => {
      examSubjects.findExamDates.mockResolvedValue([new Date('2026-06-14')]);
      await expect(
        service.update('exam-1', { endDate: '2026-06-10' }, actor),
      ).rejects.toThrow(/would fall outside the new window/);
    });

    it('allows it when every sitting still fits', async () => {
      examSubjects.findExamDates.mockResolvedValue([new Date('2026-06-05')]);
      await expect(
        service.update('exam-1', { endDate: '2026-06-10' }, actor),
      ).resolves.toBeDefined();
    });
  });

  describe('shape edits freeze once mark entry opens', () => {
    it('refuses a class change in MARK_ENTRY', async () => {
      exams.findDetail.mockResolvedValue(
        exam({ status: ExamStatus.MARK_ENTRY }),
      );
      await expect(
        service.setClasses('exam-1', { classIds: ['cls-8'] }, actor),
      ).rejects.toThrow(/frozen/);
    });

    it('drops papers of a detached class', async () => {
      await service.setClasses('exam-1', { classIds: ['cls-8'] }, actor);
      expect(examSubjects.deleteForClasses).toHaveBeenCalledWith(
        'exam-1',
        ['cls-7'],
        expect.anything(),
      );
    });
  });

  describe('delete', () => {
    it('deletes a DRAFT', async () => {
      await service.remove('exam-1', actor);
      expect(exams.softDelete).toHaveBeenCalledWith('exam-1');
    });

    it('refuses anything past DRAFT', async () => {
      exams.findDetail.mockResolvedValue(exam({ status: ExamStatus.ONGOING }));
      await expect(service.remove('exam-1', actor)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  it('reports the legal next statuses on the overview', async () => {
    const detail = await service.getDetail('exam-1', 'school-1');
    expect(detail.nextStatuses).toEqual([
      ExamStatus.SCHEDULED,
      ExamStatus.ARCHIVED,
    ]);
    expect(detail.papers).toEqual({ total: 4, scheduled: 4, unscheduled: 0 });
  });
});
