import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import type { Sitting } from '../calc/exam-clash.engine';
import { ExamClashService, isScheduled } from './exam-clash.service';

/**
 * The two-tier override policy: structural clashes are never waivable,
 * the same-day policy is — and only with `exam.schedule.override`.
 */
describe('ExamClashService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };

  const EXAM = {
    id: 'exam-1',
    schoolId: 'school-1',
    sessionId: 'ses-1',
    startDate: new Date('2026-06-01'),
    endDate: new Date('2026-06-15'),
  };

  const sitting = (over: Partial<Sitting> = {}): Sitting => ({
    examSubjectId: 'es-1',
    examId: 'exam-1',
    classId: 'cls-9',
    classLabel: 'Class 9',
    subjectId: 'bangla',
    subjectName: 'Bangla',
    date: '2026-06-02',
    startMinutes: 600,
    endMinutes: 780,
    room: 'H1',
    ...over,
  });

  let examSubjects: Record<string, jest.Mock>;
  let config: Record<string, jest.Mock>;
  let permissions: Record<string, jest.Mock>;
  let service: ExamClashService;

  beforeEach(() => {
    examSubjects = {
      findScheduledForSession: jest.fn().mockResolvedValue([]),
    };
    config = {
      load: jest.fn().mockResolvedValue({
        checkRooms: true,
        allowMultiplePapersPerDay: false,
      }),
    };
    permissions = { getUserPermissionCodes: jest.fn().mockResolvedValue([]) };

    service = new ExamClashService(
      examSubjects as never,
      config as never,
      permissions as never,
    );
  });

  const assert = (candidates: Sitting[], override = false, who = actor) =>
    service.assertScheduleAllowed(EXAM as never, candidates, override, who);

  it('passes a clean routine and returns no warnings', async () => {
    await expect(assert([sitting()])).resolves.toEqual([]);
  });

  describe('structural clashes are never waivable', () => {
    const overlapping = [
      sitting(),
      sitting({
        examSubjectId: 'es-2',
        subjectId: 'english',
        subjectName: 'English',
        startMinutes: 660,
        room: 'H2',
      }),
    ];

    it('refuses a class sitting two papers at once', async () => {
      await expect(assert(overlapping)).rejects.toThrow(ConflictException);
    });

    it('still refuses it WITH override=true and the permission', async () => {
      permissions.getUserPermissionCodes.mockResolvedValue([
        'exam.schedule.override',
      ]);
      await expect(assert(overlapping, true)).rejects.toThrow(
        /nothing was saved/,
      );
    });

    it('refuses a date outside the exam window even for a Super Admin', async () => {
      await expect(
        assert([sitting({ date: '2026-07-01' })], true, {
          ...actor,
          userType: UserType.SUPER_ADMIN,
        }),
      ).rejects.toThrow(/nothing was saved/);
    });

    it('carries the offending cells in error.details for the grid', async () => {
      await assert(overlapping).catch((err: { response: unknown }) => {
        const body = err.response as {
          details: { clashes: Array<{ kind: string }> };
        };
        expect(body.details.clashes.length).toBeGreaterThan(0);
        expect(body.details.clashes[0].kind).toBe('CLASS_OVERLAP');
      });
      expect.assertions(2);
    });
  });

  describe('the same-day policy is waivable', () => {
    const sameDay = [
      sitting(),
      sitting({
        examSubjectId: 'es-2',
        subjectId: 'english',
        subjectName: 'English',
        startMinutes: 840,
        endMinutes: 960,
        room: 'H2',
      }),
    ];

    it('refuses without an override', async () => {
      await expect(assert(sameDay)).rejects.toThrow(/pass override=true/);
    });

    it('refuses with override but no permission', async () => {
      await expect(assert(sameDay, true)).rejects.toThrow(ForbiddenException);
    });

    it('allows it with override + permission, and reports the warning', async () => {
      permissions.getUserPermissionCodes.mockResolvedValue([
        'exam.schedule.override',
      ]);
      const warnings = await assert(sameDay, true);
      expect(warnings.map((w) => w.kind)).toEqual(['CLASS_SAME_DAY']);
    });

    it('lets a Super Admin waive it without a permission lookup', async () => {
      await expect(
        assert(sameDay, true, { ...actor, userType: UserType.SUPER_ADMIN }),
      ).resolves.toHaveLength(1);
      expect(permissions.getUserPermissionCodes).not.toHaveBeenCalled();
    });

    it('is not raised at all when the school allows multiple papers per day', async () => {
      config.load.mockResolvedValue({
        checkRooms: true,
        allowMultiplePapersPerDay: true,
      });
      await expect(assert(sameDay)).resolves.toEqual([]);
    });
  });

  it('treats other live exams of the session as room competition', async () => {
    examSubjects.findScheduledForSession.mockResolvedValue([
      {
        id: 'other-1',
        examId: 'exam-2',
        classId: 'cls-10',
        subjectId: 'physics',
        class: { name: 'Class 10' },
        subject: { name: 'Physics' },
        examDate: new Date('2026-06-02'),
        startTime: new Date('1970-01-01T10:00:00.000Z'),
        durationMin: 180,
        room: 'H1',
      },
    ]);
    await expect(assert([sitting()])).rejects.toThrow(/nothing was saved/);
  });

  describe('toSitting', () => {
    it('maps a saved paper onto engine coordinates', () => {
      const mapped = service.toSitting({
        id: 'es-9',
        examId: 'exam-1',
        classId: 'cls-9',
        subjectId: 'bangla',
        class: { name: 'Class 9' },
        subject: { name: 'Bangla' },
        examDate: new Date('2026-06-02'),
        startTime: new Date('1970-01-01T10:30:00.000Z'),
        durationMin: 120,
        room: 'H3',
      } as never);

      expect(mapped).toMatchObject({
        date: '2026-06-02',
        startMinutes: 630,
        endMinutes: 750,
        room: 'H3',
      });
      expect(isScheduled(mapped)).toBe(true);
    });

    it('marks an unscheduled paper as occupying nothing', () => {
      const mapped = service.toSitting({
        id: 'es-9',
        examId: 'exam-1',
        classId: 'cls-9',
        subjectId: 'bangla',
        class: { name: 'Class 9' },
        subject: { name: 'Bangla' },
        examDate: null,
        startTime: null,
        durationMin: null,
        room: null,
      } as never);

      expect(isScheduled(mapped)).toBe(false);
    });
  });
});
