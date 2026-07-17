import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  EmploymentType,
  Gender,
  StaffDesignation,
  StaffStatus,
  UserType,
} from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { STAFF_EVENTS } from '../events/staff.events';
import { CreateStaffDto } from '../dto';
import { StaffService } from './staff.service';

const actor: AccessTokenPayload = {
  sub: 'actor-1',
  schoolId: 'school-1',
  userType: UserType.ADMIN,
};

const validDto = (): CreateStaffDto => ({
  phone: '01712345678',
  firstName: 'Rahim',
  lastName: 'Uddin',
  designation: StaffDesignation.ACCOUNTANT,
  gender: Gender.MALE,
  dob: '1990-04-10',
  joiningDate: '2020-01-15',
  employmentType: EmploymentType.PERMANENT,
});

describe('StaffService', () => {
  let staffProfiles: Record<string, jest.Mock>;
  let users: Record<string, jest.Mock>;
  let refreshTokens: Record<string, jest.Mock>;
  let roles: Record<string, jest.Mock>;
  let userRoles: Record<string, jest.Mock>;
  let departments: Record<string, jest.Mock>;
  let schools: Record<string, jest.Mock>;
  let passwords: Record<string, jest.Mock>;
  let settings: Record<string, jest.Mock>;
  let sequences: Record<string, jest.Mock>;
  let storage: Record<string, jest.Mock>;
  let events: { emit: jest.Mock };
  let service: StaffService;

  beforeEach(() => {
    staffProfiles = {
      paginateList: jest.fn(),
      findDetail: jest.fn().mockResolvedValue({ id: 'staff-1' }),
      findByIdOrFail: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      countByNid: jest.fn().mockResolvedValue(0),
      create: jest
        .fn()
        .mockImplementation((data: object) =>
          Promise.resolve({ id: 'staff-1', ...data }),
        ),
      update: jest
        .fn()
        .mockImplementation((id: string, data: object) =>
          Promise.resolve({ id, ...data }),
        ),
      withTransaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
          fn({ tx: true }),
        ),
    };
    users = {
      findOne: jest.fn().mockResolvedValue(null),
      findByIdOrFail: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((data: object) =>
          Promise.resolve({ id: 'user-1', ...data }),
        ),
      update: jest.fn(),
    };
    refreshTokens = { revokeAllForUser: jest.fn() };
    roles = { findBySlug: jest.fn().mockResolvedValue({ id: 'role-1' }) };
    userRoles = { assignRole: jest.fn() };
    departments = { findByIdOrFail: jest.fn() };
    schools = {
      findByIdOrFail: jest
        .fn()
        .mockResolvedValue({ id: 'school-1', code: 'HXS' }),
    };
    passwords = { hash: jest.fn().mockResolvedValue('hashed') };
    settings = {
      getValue: jest.fn().mockResolvedValue('{SCHOOL_CODE}-S-{YY}{SEQ4}'),
    };
    sequences = {
      nextDocumentNumber: jest.fn().mockResolvedValue('HXS-S-200001'),
    };
    storage = {
      upload: jest.fn(),
      getSignedUrl: jest.fn().mockResolvedValue('https://signed'),
      delete: jest.fn(),
    };
    events = { emit: jest.fn() };

    service = new StaffService(
      staffProfiles as never,
      users as never,
      refreshTokens as never,
      roles as never,
      userRoles as never,
      departments as never,
      schools as never,
      passwords as never,
      settings as never,
      sequences as never,
      storage as never,
      { set: jest.fn() } as never,
      events as never,
    );
  });

  describe('create', () => {
    it('requires an email or a phone number', async () => {
      await expect(
        service.create({ ...validDto(), phone: undefined }, actor),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects staff younger than 18', async () => {
      const dto = validDto();
      dto.dob = '2020-01-01';
      dto.joiningDate = '2026-01-01';
      await expect(service.create(dto, actor)).rejects.toThrow(
        'at least 18 years old',
      );
    });

    it('rejects a joining date in the future', async () => {
      const dto = validDto();
      dto.joiningDate = '2093-01-01';
      await expect(service.create(dto, actor)).rejects.toThrow(
        'cannot be in the future',
      );
    });

    it('rejects an email already held by another user → 409', async () => {
      users.findOne.mockResolvedValue({ id: 'someone-else' });
      await expect(
        service.create({ ...validDto(), email: 'x@y.com' }, actor),
      ).rejects.toThrow(ConflictException);
    });

    it('creates user + profile in ONE transaction with a sequence-issued id', async () => {
      await service.create(validDto(), actor);

      // Everything ran against the same tx client.
      const tx = { tx: true };
      expect(sequences.nextDocumentNumber).toHaveBeenCalledWith(
        expect.objectContaining({
          schoolId: 'school-1',
          counterKey: 'staff:20', // joining year 2020
          schoolCode: 'HXS',
          tx,
        }),
      );
      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userType: UserType.STAFF,
          mustChangePassword: true,
          phone: '01712345678',
        }),
        tx,
      );
      expect(staffProfiles.create).toHaveBeenCalledWith(
        expect.objectContaining({ employeeId: 'HXS-S-200001' }),
        tx,
      );
      // Accountant designation → accountant system role, in the same tx.
      expect(roles.findBySlug).toHaveBeenCalledWith('school-1', 'accountant');
      expect(userRoles.assignRole).toHaveBeenCalledWith('user-1', 'role-1', tx);
    });

    it('emits staff.created with the one-time temp password', async () => {
      await service.create(validDto(), actor);
      expect(events.emit).toHaveBeenCalledWith(
        STAFF_EVENTS.CREATED,
        expect.objectContaining({
          phone: '01712345678',
          tempPassword: expect.stringMatching(/^.{8,}$/) as string,
        }),
      );
      // The password must have been hashed BEFORE storage.
      expect(passwords.hash).toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('rejects a no-op transition', async () => {
      staffProfiles.findByIdOrFail.mockResolvedValue({
        id: 'staff-1',
        userId: 'user-1',
        status: StaffStatus.ACTIVE,
      });
      await expect(
        service.updateStatus(
          'staff-1',
          { status: StaffStatus.ACTIVE, reason: 'noop' },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('emits staff.status_changed with from/to/reason', async () => {
      staffProfiles.findByIdOrFail.mockResolvedValue({
        id: 'staff-1',
        userId: 'user-1',
        status: StaffStatus.ACTIVE,
      });
      await service.updateStatus(
        'staff-1',
        { status: StaffStatus.RESIGNED, reason: 'Personal reasons' },
        actor,
      );
      expect(events.emit).toHaveBeenCalledWith(
        STAFF_EVENTS.STATUS_CHANGED,
        expect.objectContaining({
          userId: 'user-1',
          from: StaffStatus.ACTIVE,
          to: StaffStatus.RESIGNED,
          reason: 'Personal reasons',
        }),
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes profile + user and revokes every session', async () => {
      staffProfiles.findByIdOrFail.mockResolvedValue({
        id: 'staff-1',
        userId: 'user-1',
        employeeId: 'HXS-S-200001',
        firstName: 'R',
        lastName: 'U',
        status: StaffStatus.ACTIVE,
      });
      await service.remove('staff-1', actor);

      expect(staffProfiles.update).toHaveBeenCalledWith(
        'staff-1',
        expect.objectContaining({ deletedAt: expect.any(Date) as Date }),
        expect.anything(),
      );
      expect(users.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ deletedAt: expect.any(Date) as Date }),
        expect.anything(),
      );
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
    });
  });
});
