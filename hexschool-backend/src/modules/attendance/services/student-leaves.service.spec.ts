import { BadRequestException, ConflictException } from '@nestjs/common';
import { LeaveStatus, UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { StudentLeavesService } from './student-leaves.service';

describe('StudentLeavesService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };

  let leaves: Record<string, jest.Mock>;
  let attendances: Record<string, jest.Mock>;
  let students: Record<string, jest.Mock>;
  let enrollments: Record<string, jest.Mock>;
  let sessions: Record<string, jest.Mock>;
  let service: StudentLeavesService;

  const pending = {
    id: 'leave-1',
    studentId: 'stu-1',
    sessionId: 'ses-1',
    status: LeaveStatus.PENDING,
    fromDate: new Date('2026-07-20'),
    toDate: new Date('2026-07-22'),
    reason: 'Fever',
  };

  beforeEach(() => {
    leaves = {
      create: jest.fn().mockResolvedValue({ id: 'leave-1' }),
      findDetail: jest.fn().mockResolvedValue(pending),
      findOverlapping: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      softDelete: jest.fn(),
      paginateList: jest.fn(),
      withTransaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => unknown) => fn({})),
    };
    attendances = { convertAbsentToLeave: jest.fn().mockResolvedValue(3) };
    students = {
      findByIdOrFail: jest
        .fn()
        .mockResolvedValue({ id: 'stu-1', studentUid: 'HXS-1' }),
    };
    enrollments = {
      findAll: jest.fn().mockResolvedValue([{ id: 'enr-1' }, { id: 'enr-2' }]),
      findLiveByStudentSession: jest.fn().mockResolvedValue({ id: 'enr-1' }),
    };
    sessions = {
      findByIdOrFail: jest.fn().mockResolvedValue({
        id: 'ses-1',
        name: '2026',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      }),
      findCurrent: jest.fn().mockResolvedValue({ id: 'ses-1', name: '2026' }),
    };

    service = new StudentLeavesService(
      leaves as never,
      attendances as never,
      students as never,
      enrollments as never,
      sessions as never,
      { set: jest.fn() } as never,
    );
  });

  const createDto = (overrides: object = {}) => ({
    studentId: 'stu-1',
    fromDate: '2026-07-20',
    toDate: '2026-07-22',
    reason: 'Fever',
    ...overrides,
  });

  it('creates a PENDING application for the current session', async () => {
    await service.create(createDto(), actor);
    expect(leaves.create).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 'stu-1', sessionId: 'ses-1' }),
    );
  });

  it('rejects an inverted date range', async () => {
    await expect(
      service.create(
        createDto({ fromDate: '2026-07-22', toDate: '2026-07-20' }) as never,
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects dates outside the session', async () => {
    await expect(
      service.create(
        createDto({ fromDate: '2027-01-05', toDate: '2027-01-06' }) as never,
        actor,
      ),
    ).rejects.toThrow(/inside session/);
  });

  it('rejects a range overlapping an open or approved leave', async () => {
    leaves.findOverlapping.mockResolvedValue([{ id: 'leave-0' }]);
    await expect(
      service.create(createDto() as never, actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a student with no active enrollment', async () => {
    enrollments.findLiveByStudentSession.mockResolvedValue(null);
    await expect(service.create(createDto() as never, actor)).rejects.toThrow(
      /no active enrollment/,
    );
  });

  it('approving retro-marks recorded ABSENT days as LEAVE', async () => {
    const result = await service.approve('leave-1', {}, actor);
    expect(result.correctedDays).toBe(3);
    expect(attendances.convertAbsentToLeave).toHaveBeenCalledWith(
      ['enr-1', 'enr-2'],
      pending.fromDate,
      pending.toDate,
      'actor-1',
      expect.anything(),
    );
    expect(leaves.update).toHaveBeenCalledWith(
      'leave-1',
      expect.objectContaining({ status: LeaveStatus.APPROVED }),
      expect.anything(),
    );
  });

  it('only PENDING applications can be decided, edited or deleted', async () => {
    leaves.findDetail.mockResolvedValue({
      ...pending,
      status: LeaveStatus.APPROVED,
    });
    await expect(service.approve('leave-1', {}, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.reject('leave-1', {}, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.update('leave-1', { reason: 'x' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.remove('leave-1', actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejecting leaves attendance untouched', async () => {
    await service.reject('leave-1', { note: 'No document' }, actor);
    expect(attendances.convertAbsentToLeave).not.toHaveBeenCalled();
    expect(leaves.update).toHaveBeenCalledWith(
      'leave-1',
      expect.objectContaining({ status: LeaveStatus.REJECTED }),
    );
  });
});
