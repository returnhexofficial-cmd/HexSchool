import { BadRequestException, ConflictException } from '@nestjs/common';
import { LeaveStatus, UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { TEACHER_EVENTS } from '../events/teacher.events';
import { TeacherLeavesService } from './teacher-leaves.service';

const actor: AccessTokenPayload = {
  sub: 'actor-1',
  schoolId: 'school-1',
  userType: UserType.ADMIN,
};

const currentSession = {
  id: 'sess-1',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
};

describe('TeacherLeavesService', () => {
  let leaves: Record<string, jest.Mock>;
  let teachers: Record<string, jest.Mock>;
  let sessions: Record<string, jest.Mock>;
  let events: { emit: jest.Mock };
  let service: TeacherLeavesService;

  beforeEach(() => {
    leaves = {
      paginateList: jest.fn(),
      findById: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((data: object) =>
          Promise.resolve({ id: 'leave-1', ...data }),
        ),
      update: jest
        .fn()
        .mockImplementation((id: string, data: object) =>
          Promise.resolve({ id, ...data }),
        ),
      hardDelete: jest.fn(),
      countApprovedOverlaps: jest.fn().mockResolvedValue(0),
    };
    teachers = {
      findByIdOrFail: jest
        .fn()
        .mockResolvedValue({ id: 't-1', firstName: 'A', lastName: 'B' }),
    };
    sessions = { getCurrent: jest.fn().mockResolvedValue(currentSession) };
    events = { emit: jest.fn() };

    service = new TeacherLeavesService(
      leaves as never,
      teachers as never,
      sessions as never,
      { set: jest.fn() } as never,
      events as never,
    );
  });

  const createDto = () => ({
    teacherId: 't-1',
    fromDate: '2026-03-01',
    toDate: '2026-03-05',
  });

  describe('create', () => {
    it('accepts a range inside the current session', async () => {
      const leave = await service.create(createDto(), actor);
      expect(leave.id).toBe('leave-1');
    });

    it('from after to → 400', async () => {
      await expect(
        service.create({ ...createDto(), fromDate: '2026-03-06' }, actor),
      ).rejects.toThrow('on or before');
    });

    it('outside the current session → 400', async () => {
      await expect(
        service.create(
          { ...createDto(), fromDate: '2025-12-20', toDate: '2026-01-02' },
          actor,
        ),
      ).rejects.toThrow('within the current session');
    });

    it('no current session → 400', async () => {
      sessions.getCurrent.mockResolvedValue(null);
      await expect(service.create(createDto(), actor)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('overlapping an APPROVED leave → 409', async () => {
      leaves.countApprovedOverlaps.mockResolvedValue(1);
      await expect(service.create(createDto(), actor)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('approve', () => {
    const pending = {
      id: 'leave-1',
      teacherId: 't-1',
      status: LeaveStatus.PENDING,
      fromDate: new Date('2026-03-01'),
      toDate: new Date('2026-03-05'),
      type: 'CASUAL',
    };

    it('approves a PENDING leave and emits the M12 hook', async () => {
      leaves.findById.mockResolvedValue(pending);
      await service.approve('leave-1', actor);

      expect(leaves.update).toHaveBeenCalledWith(
        'leave-1',
        expect.objectContaining({
          status: LeaveStatus.APPROVED,
          approvedBy: 'actor-1',
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        TEACHER_EVENTS.LEAVE_APPROVED,
        expect.objectContaining({
          leaveId: 'leave-1',
          teacherId: 't-1',
          fromDate: '2026-03-01',
          toDate: '2026-03-05',
        }),
      );
    });

    it('re-checks the APPROVED overlap at approval time → 409', async () => {
      leaves.findById.mockResolvedValue(pending);
      leaves.countApprovedOverlaps.mockResolvedValue(1);
      await expect(service.approve('leave-1', actor)).rejects.toThrow(
        ConflictException,
      );
    });

    it('a decided leave cannot be approved again', async () => {
      leaves.findById.mockResolvedValue({
        ...pending,
        status: LeaveStatus.APPROVED,
      });
      await expect(service.approve('leave-1', actor)).rejects.toThrow(
        'Only PENDING leaves',
      );
    });
  });

  describe('PENDING-only mutations', () => {
    it('editing an APPROVED leave → 400', async () => {
      leaves.findById.mockResolvedValue({
        id: 'leave-1',
        status: LeaveStatus.APPROVED,
      });
      await expect(
        service.update('leave-1', { reason: 'x' }, actor),
      ).rejects.toThrow(BadRequestException);
    });

    it('deleting a REJECTED leave → 400', async () => {
      leaves.findById.mockResolvedValue({
        id: 'leave-1',
        status: LeaveStatus.REJECTED,
      });
      await expect(service.remove('leave-1', actor)).rejects.toThrow(
        BadRequestException,
      );
      expect(leaves.hardDelete).not.toHaveBeenCalled();
    });
  });
});
