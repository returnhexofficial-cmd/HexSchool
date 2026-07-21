import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { RenumberStrategy } from '../dto';
import { EnrollmentsService } from './enrollments.service';

/** Minimal section fixture. */
const section = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'sec-1',
  schoolId: 'school-1',
  classId: 'class-6',
  sessionId: 'sess-1',
  groupId: null,
  shiftId: null,
  capacity: null,
  ...over,
});

const student = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'stu-1',
  studentUid: 'HS-2026-00001',
  firstName: 'Aisha',
  lastName: 'Rahman',
  status: 'ACTIVE',
  ...over,
});

describe('EnrollmentsService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };

  let enrollments: Record<string, jest.Mock>;
  let transfers: Record<string, jest.Mock>;
  let sections: Record<string, jest.Mock>;
  let classSubjects: Record<string, jest.Mock>;
  let students: Record<string, jest.Mock>;
  let permissions: Record<string, jest.Mock>;
  let service: EnrollmentsService;

  beforeEach(() => {
    enrollments = {
      findLiveByStudentSession: jest.fn().mockResolvedValue(null),
      maxRoll: jest.fn().mockResolvedValue(0),
      isRollTaken: jest.fn().mockResolvedValue(false),
      countActiveInSection: jest.fn().mockResolvedValue(0),
      create: jest
        .fn()
        .mockImplementation((data: object) =>
          Promise.resolve({ id: 'enr-new', ...data }),
        ),
      update: jest
        .fn()
        .mockImplementation((id: string, data: object) =>
          Promise.resolve({ id, ...data }),
        ),
      findByIdOrFail: jest.fn(),
      findDetail: jest
        .fn()
        .mockImplementation((id: string) => Promise.resolve({ id, rollNo: 1 })),
      findSectionRoster: jest.fn().mockResolvedValue([]),
      hardDelete: jest.fn(),
      withTransaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => unknown) => fn({})),
    };
    transfers = { create: jest.fn() };
    sections = { findByIdOrFail: jest.fn().mockResolvedValue(section()) };
    classSubjects = { findForClassSession: jest.fn().mockResolvedValue([]) };
    students = {
      findByIdOrFail: jest.fn().mockResolvedValue(student()),
      findManyDetailed: jest.fn().mockResolvedValue([student()]),
    };
    permissions = { getUserPermissionCodes: jest.fn().mockResolvedValue([]) };

    service = new EnrollmentsService(
      enrollments as never,
      transfers as never,
      sections as never,
      classSubjects as never,
      students as never,
      permissions as never,
      { set: jest.fn() } as never,
    );
  });

  describe('enroll', () => {
    const dto = {
      studentId: 'stu-1',
      sessionId: 'sess-1',
      sectionId: 'sec-1',
    };

    it('auto-assigns the next roll when none is given', async () => {
      enrollments.maxRoll.mockResolvedValue(7);
      await service.enroll(dto, actor);
      expect(enrollments.create).toHaveBeenCalledWith(
        expect.objectContaining({ rollNo: 8, sessionId: 'sess-1' }),
        expect.anything(),
      );
    });

    it('rejects a second enrollment in the same session', async () => {
      enrollments.findLiveByStudentSession.mockResolvedValue({
        id: 'existing',
      });
      await expect(service.enroll(dto, actor)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects an explicit roll already used in the section', async () => {
      enrollments.isRollTaken.mockResolvedValue(true);
      await expect(
        service.enroll({ ...dto, rollNo: 5 }, actor),
      ).rejects.toThrow(/Roll 5 is already used/);
    });

    it('rejects enrolling a non-active student', async () => {
      students.findByIdOrFail.mockResolvedValue(student({ status: 'DROPPED' }));
      await expect(service.enroll(dto, actor)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when the section is not in the given session', async () => {
      sections.findByIdOrFail.mockResolvedValue(
        section({ sessionId: 'other' }),
      );
      await expect(service.enroll(dto, actor)).rejects.toThrow(
        /does not belong to the given session/,
      );
    });

    it('blocks over-capacity enrollment without override', async () => {
      sections.findByIdOrFail.mockResolvedValue(section({ capacity: 2 }));
      enrollments.countActiveInSection.mockResolvedValue(2);
      await expect(service.enroll(dto, actor)).rejects.toThrow(/at capacity/);
    });

    it('allows over-capacity with override + permission', async () => {
      sections.findByIdOrFail.mockResolvedValue(section({ capacity: 2 }));
      enrollments.countActiveInSection.mockResolvedValue(2);
      permissions.getUserPermissionCodes.mockResolvedValue([
        'enrollment.capacity.override',
      ]);
      await expect(
        service.enroll({ ...dto, overrideCapacity: true }, actor),
      ).resolves.toBeDefined();
    });

    it('forbids override when the permission is missing', async () => {
      sections.findByIdOrFail.mockResolvedValue(section({ capacity: 1 }));
      enrollments.countActiveInSection.mockResolvedValue(1);
      permissions.getUserPermissionCodes.mockResolvedValue([]);
      await expect(
        service.enroll({ ...dto, overrideCapacity: true }, actor),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an optional subject not offered as optional by the class', async () => {
      classSubjects.findForClassSession.mockResolvedValue([
        { subjectId: 'sub-x', isOptional: false, groupId: null },
      ]);
      await expect(
        service.enroll({ ...dto, optionalSubjectId: 'sub-x' }, actor),
      ).rejects.toThrow(/optional subject/i);
    });
  });

  describe('transferSection', () => {
    beforeEach(() => {
      enrollments.findByIdOrFail.mockResolvedValue({
        id: 'enr-1',
        schoolId: 'school-1',
        classId: 'class-6',
        sessionId: 'sess-1',
        sectionId: 'sec-1',
        rollNo: 12,
        status: 'ACTIVE',
      });
    });

    it('keeps the roll when free in the target', async () => {
      sections.findByIdOrFail.mockResolvedValue(section({ id: 'sec-2' }));
      enrollments.isRollTaken.mockResolvedValue(false);
      await service.transferSection('enr-1', { toSectionId: 'sec-2' }, actor);
      expect(enrollments.update).toHaveBeenCalledWith(
        'enr-1',
        expect.objectContaining({ sectionId: 'sec-2', rollNo: 12 }),
        expect.anything(),
      );
      expect(transfers.create).toHaveBeenCalled();
    });

    it('reassigns the roll when taken in the target', async () => {
      sections.findByIdOrFail.mockResolvedValue(section({ id: 'sec-2' }));
      enrollments.isRollTaken.mockResolvedValue(true);
      enrollments.maxRoll.mockResolvedValue(30);
      await service.transferSection('enr-1', { toSectionId: 'sec-2' }, actor);
      expect(enrollments.update).toHaveBeenCalledWith(
        'enr-1',
        expect.objectContaining({ rollNo: 31 }),
        expect.anything(),
      );
    });

    it('rejects a target in a different class', async () => {
      sections.findByIdOrFail.mockResolvedValue(
        section({ id: 'sec-2', classId: 'class-9' }),
      );
      await expect(
        service.transferSection('enr-1', { toSectionId: 'sec-2' }, actor),
      ).rejects.toThrow(/same class/);
    });

    it('rejects transferring the same section', async () => {
      await expect(
        service.transferSection('enr-1', { toSectionId: 'sec-1' }, actor),
      ).rejects.toThrow(/current section/);
    });
  });

  describe('rollAssign', () => {
    it('renumbers sequentially via a two-phase update (temp negatives)', async () => {
      enrollments.findSectionRoster
        .mockResolvedValueOnce([
          { id: 'e1', rollNo: 5, student: { firstName: 'B', lastName: 'B' } },
          { id: 'e2', rollNo: 3, student: { firstName: 'A', lastName: 'A' } },
        ])
        .mockResolvedValueOnce([]);
      await service.rollAssign(
        {
          sectionId: 'sec-1',
          sessionId: 'sess-1',
          strategy: RenumberStrategy.SEQUENTIAL,
        },
        actor,
      );
      // Phase 1 parks negatives, phase 2 sets finals starting at 1
      // (sequential = by current roll: e2 first).
      const calls = enrollments.update.mock.calls as Array<
        [string, { rollNo: number }]
      >;
      const finals = calls
        .filter(([, data]) => data.rollNo > 0)
        .map(([id, data]) => [id, data.rollNo]);
      expect(finals).toEqual([
        ['e2', 1],
        ['e1', 2],
      ]);
    });
  });
});
