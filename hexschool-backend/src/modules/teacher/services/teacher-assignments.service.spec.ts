import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { NoopTimetableConflictChecker } from '../interfaces/timetable-conflict.interface';
import { TeacherAssignmentsService } from './teacher-assignments.service';

const admin: AccessTokenPayload = {
  sub: 'actor-1',
  schoolId: 'school-1',
  userType: UserType.ADMIN,
};

const dto = () => ({
  sessionId: 'sess-1',
  sectionId: 'sec-1',
  subjectId: 'sub-1',
  teacherId: 'teacher-1',
});

describe('TeacherAssignmentsService', () => {
  let assignments: Record<string, jest.Mock>;
  let teachers: Record<string, jest.Mock>;
  let teacherSubjects: Record<string, jest.Mock>;
  let sections: Record<string, jest.Mock>;
  let subjects: Record<string, jest.Mock>;
  let sessions: Record<string, jest.Mock>;
  let permissions: Record<string, jest.Mock>;
  let service: TeacherAssignmentsService;

  beforeEach(() => {
    assignments = {
      list: jest.fn().mockResolvedValue([{ id: 'a-1' }]),
      findBySlot: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
      upsertSlot: jest.fn().mockResolvedValue({ id: 'a-1' }),
      remove: jest.fn(),
      transferAll: jest.fn().mockResolvedValue(3),
      distinctSubjectIdsForTeacher: jest
        .fn()
        .mockResolvedValue(['sub-1', 'sub-2']),
      countForTeacher: jest.fn(),
      workloadCounts: jest.fn(),
    };
    teachers = {
      findByIdOrFail: jest
        .fn()
        .mockResolvedValue({ id: 'teacher-1', status: 'ACTIVE' }),
      findAll: jest.fn(),
    };
    teacherSubjects = { hasExpertise: jest.fn().mockResolvedValue(true) };
    sections = {
      findByIdOrFail: jest
        .fn()
        .mockResolvedValue({ id: 'sec-1', sessionId: 'sess-1' }),
    };
    subjects = { findByIdOrFail: jest.fn() };
    sessions = { getById: jest.fn(), getCurrent: jest.fn() };
    permissions = { getUserPermissionCodes: jest.fn().mockResolvedValue([]) };

    service = new TeacherAssignmentsService(
      assignments as never,
      teachers as never,
      teacherSubjects as never,
      sections as never,
      subjects as never,
      sessions as never,
      permissions as never,
      { set: jest.fn() } as never,
      // Periods/week (M13) is additive to these cases — an empty routine
      // reports 0 and leaves the assignment rules under test alone.
      { periodsPerWeek: jest.fn().mockResolvedValue([]) } as never,
      new NoopTimetableConflictChecker(),
    );
  });

  it('assigns when expertise matches (upsert = replace semantics)', async () => {
    assignments.findBySlot.mockResolvedValue({
      id: 'a-1',
      teacherId: 'previous-teacher',
    });
    await service.assign(dto(), admin);
    expect(assignments.upsertSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        sectionId: 'sec-1',
        subjectId: 'sub-1',
        teacherId: 'teacher-1',
      }),
    );
  });

  it('section in another session → 400', async () => {
    sections.findByIdOrFail.mockResolvedValue({
      id: 'sec-1',
      sessionId: 'other-session',
    });
    await expect(service.assign(dto(), admin)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('inactive teacher → 400', async () => {
    teachers.findByIdOrFail.mockResolvedValue({
      id: 'teacher-1',
      status: 'RESIGNED',
    });
    await expect(service.assign(dto(), admin)).rejects.toThrow(
      'only ACTIVE teachers',
    );
  });

  describe('expertise rule', () => {
    beforeEach(() => teacherSubjects.hasExpertise.mockResolvedValue(false));

    it('mismatch without override → 409', async () => {
      await expect(service.assign(dto(), admin)).rejects.toThrow(
        ConflictException,
      );
      expect(assignments.upsertSlot).not.toHaveBeenCalled();
    });

    it('override without the permission → 403', async () => {
      await expect(
        service.assign({ ...dto(), override: true }, admin),
      ).rejects.toThrow(ForbiddenException);
    });

    it('override with teacher.assign.override succeeds', async () => {
      permissions.getUserPermissionCodes.mockResolvedValue([
        'teacher.assign.override',
      ]);
      await service.assign({ ...dto(), override: true }, admin);
      expect(assignments.upsertSlot).toHaveBeenCalled();
    });

    it('super admins bypass the override permission', async () => {
      await service.assign(
        { ...dto(), override: true },
        {
          ...admin,
          userType: UserType.SUPER_ADMIN,
        },
      );
      expect(assignments.upsertSlot).toHaveBeenCalled();
    });
  });

  describe('transfer', () => {
    it('same source and target → 400', async () => {
      await expect(
        service.transfer(
          {
            fromTeacherId: 't-1',
            toTeacherId: 't-1',
            sessionId: 'sess-1',
          },
          admin,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('target lacking expertise → 409 without override', async () => {
      teacherSubjects.hasExpertise.mockResolvedValue(false);
      await expect(
        service.transfer(
          {
            fromTeacherId: 't-1',
            toTeacherId: 't-2',
            sessionId: 'sess-1',
          },
          admin,
        ),
      ).rejects.toThrow(ConflictException);
      expect(assignments.transferAll).not.toHaveBeenCalled();
    });

    it('moves every assignment when the target covers the subjects', async () => {
      const result = await service.transfer(
        { fromTeacherId: 't-1', toTeacherId: 't-2', sessionId: 'sess-1' },
        admin,
      );
      expect(result).toEqual({ transferred: 3 });
      expect(assignments.transferAll).toHaveBeenCalledWith(
        't-1',
        't-2',
        'sess-1',
        'actor-1',
      );
    });

    it('no assignments → transfers 0 without touching anything', async () => {
      assignments.distinctSubjectIdsForTeacher.mockResolvedValue([]);
      const result = await service.transfer(
        { fromTeacherId: 't-1', toTeacherId: 't-2', sessionId: 'sess-1' },
        admin,
      );
      expect(result).toEqual({ transferred: 0 });
      expect(assignments.transferAll).not.toHaveBeenCalled();
    });
  });
});
