import { BadRequestException, ConflictException } from '@nestjs/common';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { MastersService, dateToTime, timeToDate } from './masters.service';

const repoMock = () => ({
  paginate: jest.fn(),
  findOne: jest.fn().mockResolvedValue(null),
  findByIdOrFail: jest.fn(),
  create: jest
    .fn()
    .mockImplementation((data: object) =>
      Promise.resolve({ id: 'new-id', ...data }),
    ),
  update: jest
    .fn()
    .mockImplementation((_id: string, data: object) =>
      Promise.resolve({ id: _id, ...data }),
    ),
  softDelete: jest.fn(),
  hardDelete: jest.fn(),
  countReferences: jest.fn().mockResolvedValue(0),
});

describe('MastersService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };

  let departments: ReturnType<typeof repoMock>;
  let shifts: ReturnType<typeof repoMock>;
  let classes: ReturnType<typeof repoMock>;
  let groups: ReturnType<typeof repoMock>;
  let subjects: ReturnType<typeof repoMock>;
  let service: MastersService;

  beforeEach(() => {
    departments = repoMock();
    shifts = repoMock();
    classes = repoMock();
    groups = repoMock();
    subjects = repoMock();
    service = new MastersService(
      departments as never,
      shifts as never,
      classes as never,
      groups as never,
      subjects as never,
      { set: jest.fn() } as never,
    );
  });

  it('time helpers round-trip HH:MM through TIME columns', () => {
    expect(dateToTime(timeToDate('07:30'))).toBe('07:30');
    expect(dateToTime(timeToDate('13:05'))).toBe('13:05');
  });

  it('shift start must be before end (create and update)', async () => {
    await expect(
      service.createShift(
        { name: 'Morning', startTime: '12:00', endTime: '08:00' },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);

    shifts.findByIdOrFail.mockResolvedValue({
      id: 's1',
      name: 'Morning',
      startTime: timeToDate('08:00'),
      endTime: timeToDate('12:00'),
    });
    await expect(
      service.updateShift('s1', { endTime: '07:00' }, actor),
    ).rejects.toThrow(BadRequestException);
  });

  it('duplicate identities → 409 (subject code, class level, group name)', async () => {
    subjects.findOne.mockResolvedValue({ id: 'existing' });
    await expect(
      service.createSubject({ name: 'Physics', code: 'PHY' }, actor),
    ).rejects.toThrow(ConflictException);

    classes.findOne.mockResolvedValue({ id: 'existing' });
    await expect(
      service.createClass({ name: 'Class 6', numericLevel: 6 }, actor),
    ).rejects.toThrow(ConflictException);

    groups.findOne.mockResolvedValue({ id: 'existing' });
    await expect(
      service.createGroup({ name: 'Science' }, actor),
    ).rejects.toThrow(ConflictException);
  });

  it('referenced masters cannot be deleted (explanatory 409)', async () => {
    for (const [repo, remove] of [
      [departments, () => service.removeDepartment('x', actor)],
      [shifts, () => service.removeShift('x', actor)],
      [classes, () => service.removeClass('x', actor)],
      [groups, () => service.removeGroup('x', actor)],
      [subjects, () => service.removeSubject('x', actor)],
    ] as const) {
      repo.findByIdOrFail.mockResolvedValue({ id: 'x', name: 'X', code: 'X' });
      repo.countReferences.mockResolvedValue(2);
      await expect(remove()).rejects.toThrow(ConflictException);
    }
  });

  it('unreferenced masters delete (shift hard, others soft)', async () => {
    shifts.findByIdOrFail.mockResolvedValue({ id: 's1', name: 'Morning' });
    await service.removeShift('s1', actor);
    expect(shifts.hardDelete).toHaveBeenCalledWith('s1');

    subjects.findByIdOrFail.mockResolvedValue({
      id: 'sub1',
      name: 'Physics',
      code: 'PHY',
    });
    await service.removeSubject('sub1', actor);
    expect(subjects.softDelete).toHaveBeenCalledWith('sub1');
  });

  it('subject with an unknown department fails via repo lookup', async () => {
    departments.findByIdOrFail.mockRejectedValue(new Error('not found'));
    await expect(
      service.createSubject(
        { name: 'Physics', code: 'PHY', departmentId: 'nope' },
        actor,
      ),
    ).rejects.toThrow('not found');
  });
});
