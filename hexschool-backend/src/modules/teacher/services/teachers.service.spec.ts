import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  Gender,
  StaffStatus,
  TeacherDesignation,
  UserType,
} from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CreateTeacherDto } from '../dto';
import { TEACHER_EVENTS } from '../events/teacher.events';
import { TeachersService } from './teachers.service';

const actor: AccessTokenPayload = {
  sub: 'actor-1',
  schoolId: 'school-1',
  userType: UserType.ADMIN,
};

const validDto = (): CreateTeacherDto => ({
  phone: '01812345678',
  firstName: 'Karima',
  lastName: 'Khatun',
  designation: TeacherDesignation.ASSISTANT_TEACHER,
  gender: Gender.FEMALE,
  dob: '1988-06-20',
  joiningDate: '2019-01-10',
  specialization: 'Mathematics',
});

describe('TeachersService', () => {
  let teachers: Record<string, jest.Mock>;
  let qualifications: Record<string, jest.Mock>;
  let teacherSubjects: Record<string, jest.Mock>;
  let assignments: Record<string, jest.Mock>;
  let users: Record<string, jest.Mock>;
  let refreshTokens: Record<string, jest.Mock>;
  let roles: Record<string, jest.Mock>;
  let userRoles: Record<string, jest.Mock>;
  let sessions: Record<string, jest.Mock>;
  let sequences: Record<string, jest.Mock>;
  let events: { emit: jest.Mock };
  let service: TeachersService;

  beforeEach(() => {
    teachers = {
      paginateList: jest.fn(),
      findDetail: jest.fn().mockResolvedValue({ id: 'teacher-1' }),
      findByIdOrFail: jest.fn(),
      findOne: jest.fn(),
      findAll: jest.fn(),
      countClassTeacherSections: jest.fn().mockResolvedValue(0),
      create: jest
        .fn()
        .mockImplementation((data: object) =>
          Promise.resolve({ id: 'teacher-1', ...data }),
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
    qualifications = {
      listForTeacher: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findOne: jest.fn(),
      hardDelete: jest.fn(),
    };
    teacherSubjects = {
      findSubjectsForTeacher: jest.fn().mockResolvedValue([]),
      replaceForTeacher: jest.fn(),
      hasExpertise: jest.fn(),
    };
    assignments = { countForTeacher: jest.fn().mockResolvedValue(0) };
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
    roles = { findBySlug: jest.fn().mockResolvedValue({ id: 'role-t' }) };
    userRoles = { assignRole: jest.fn() };
    sessions = { getCurrent: jest.fn().mockResolvedValue({ id: 'sess-1' }) };
    sequences = {
      nextDocumentNumber: jest.fn().mockResolvedValue('HXS-T-190001'),
    };
    events = { emit: jest.fn() };

    service = new TeachersService(
      teachers as never,
      qualifications as never,
      teacherSubjects as never,
      assignments as never,
      users as never,
      refreshTokens as never,
      roles as never,
      userRoles as never,
      { findByIdOrFail: jest.fn() } as never, // departments
      { findAll: jest.fn().mockResolvedValue([]) } as never, // subjects
      {
        findByIdOrFail: jest
          .fn()
          .mockResolvedValue({ id: 'school-1', code: 'HXS' }),
      } as never, // schools
      sessions as never,
      { hash: jest.fn().mockResolvedValue('hashed') } as never, // passwords
      {
        getValue: jest.fn().mockResolvedValue('{SCHOOL_CODE}-T-{YY}{SEQ4}'),
      } as never, // settings
      sequences as never,
      { getSignedUrl: jest.fn(), upload: jest.fn() } as never, // storage
      { set: jest.fn() } as never, // audit
      events as never,
    );
  });

  describe('create', () => {
    it('creates user (TEACHER type) + profile + teacher role in ONE tx', async () => {
      await service.create(validDto(), actor);

      const tx = { tx: true };
      expect(sequences.nextDocumentNumber).toHaveBeenCalledWith(
        expect.objectContaining({ counterKey: 'teacher:19', tx }),
      );
      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userType: UserType.TEACHER,
          mustChangePassword: true,
        }),
        tx,
      );
      expect(roles.findBySlug).toHaveBeenCalledWith('school-1', 'teacher');
      expect(userRoles.assignRole).toHaveBeenCalledWith('user-1', 'role-t', tx);
      expect(teachers.create).toHaveBeenCalledWith(
        expect.objectContaining({ employeeId: 'HXS-T-190001' }),
        tx,
      );
      expect(events.emit).toHaveBeenCalledWith(
        TEACHER_EVENTS.CREATED,
        expect.objectContaining({ phone: '01812345678' }),
      );
    });

    it('requires an email or phone; enforces age ≥ 18', async () => {
      await expect(
        service.create({ ...validDto(), phone: undefined }, actor),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create({ ...validDto(), dob: '2020-01-01' }, actor),
      ).rejects.toThrow('at least 18');
    });
  });

  describe('resign guard (roadmap M08 §8)', () => {
    beforeEach(() => {
      teachers.findByIdOrFail.mockResolvedValue({
        id: 'teacher-1',
        userId: 'user-1',
        status: StaffStatus.ACTIVE,
      });
    });

    it('RESIGNED blocked while current-session assignments exist', async () => {
      assignments.countForTeacher.mockResolvedValue(4);
      await expect(
        service.updateStatus(
          'teacher-1',
          { status: StaffStatus.RESIGNED, reason: 'moving' },
          actor,
        ),
      ).rejects.toThrow(ConflictException);
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('RESIGNED blocked while class-teacher duties exist', async () => {
      teachers.countClassTeacherSections.mockResolvedValue(1);
      await expect(
        service.updateStatus(
          'teacher-1',
          { status: StaffStatus.RESIGNED, reason: 'moving' },
          actor,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('RESIGNED proceeds once duties are cleared (event emitted)', async () => {
      await service.updateStatus(
        'teacher-1',
        { status: StaffStatus.RESIGNED, reason: 'moving' },
        actor,
      );
      expect(events.emit).toHaveBeenCalledWith(
        TEACHER_EVENTS.STATUS_CHANGED,
        expect.objectContaining({
          from: StaffStatus.ACTIVE,
          to: StaffStatus.RESIGNED,
        }),
      );
    });

    it('ON_LEAVE needs no duty check', async () => {
      assignments.countForTeacher.mockResolvedValue(4);
      await service.updateStatus(
        'teacher-1',
        { status: StaffStatus.ON_LEAVE, reason: 'medical' },
        actor,
      );
      expect(events.emit).toHaveBeenCalled();
    });
  });

  describe('subject expertise', () => {
    it('rejects unknown subject ids', async () => {
      teachers.findByIdOrFail.mockResolvedValue({ id: 'teacher-1' });
      await expect(
        service.setSubjects('teacher-1', ['dead-beef'], actor),
      ).rejects.toThrow('Unknown subject id');
    });
  });
});
