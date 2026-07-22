import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  Gender,
  GuardianRelation,
  StudentStatus,
  UserType,
} from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CreateStudentDto } from '../dto';
import { STUDENT_EVENTS } from '../events/student.events';
import { StudentsService } from './students.service';

const actor: AccessTokenPayload = {
  sub: 'actor-1',
  schoolId: 'school-1',
  userType: UserType.ADMIN,
};

const validDto = (): CreateStudentDto => ({
  firstName: 'Rahim',
  lastName: 'Uddin',
  gender: Gender.MALE,
  dob: '2014-03-12',
  admissionDate: '2026-01-10',
  admissionClassId: 'class-6',
  guardians: [
    {
      name: 'Karim Uddin',
      phone: '01712345678',
      relation: GuardianRelation.FATHER,
      isPrimary: true,
    },
  ],
});

describe('StudentsService', () => {
  let students: Record<string, jest.Mock>;
  let guardians: Record<string, jest.Mock>;
  let links: Record<string, jest.Mock>;
  let medical: Record<string, jest.Mock>;
  let statusHistory: Record<string, jest.Mock>;
  let classes: Record<string, jest.Mock>;
  let users: Record<string, jest.Mock>;
  let refreshTokens: Record<string, jest.Mock>;
  let sequences: Record<string, jest.Mock>;
  let events: { emit: jest.Mock };
  let service: StudentsService;

  beforeEach(() => {
    students = {
      paginateList: jest.fn(),
      findDetail: jest
        .fn()
        .mockResolvedValue({ id: 'student-1', photoUrl: null }),
      findFull: jest.fn(),
      findByIdOrFail: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      findByBirthCertificate: jest.fn().mockResolvedValue(null),
      findPossibleDuplicates: jest.fn().mockResolvedValue([]),
      findManyDetailed: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((data: object) =>
          Promise.resolve({ id: 'student-1', ...data }),
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
    guardians = {
      findById: jest.fn().mockResolvedValue({ id: 'guardian-1' }),
      findByPhone: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation((data: object) =>
          Promise.resolve({ id: 'guardian-new', ...data }),
        ),
    };
    links = {
      link: jest.fn(),
      listForStudent: jest.fn().mockResolvedValue([]),
      countForStudent: jest.fn().mockResolvedValue(0),
    };
    medical = {
      findForStudent: jest.fn().mockResolvedValue(null),
      upsertForStudent: jest
        .fn()
        .mockImplementation((studentId: string) =>
          Promise.resolve({ id: 'med-1', studentId }),
        ),
    };
    statusHistory = { append: jest.fn(), listForStudent: jest.fn() };
    classes = {
      findByIdOrFail: jest
        .fn()
        .mockResolvedValue({ id: 'class-6', name: 'Class 6', numericLevel: 6 }),
    };
    users = { update: jest.fn() };
    refreshTokens = { revokeAllForUser: jest.fn() };
    sequences = {
      nextDocumentNumber: jest.fn().mockResolvedValue('HXS-202600001'),
    };
    events = { emit: jest.fn() };

    service = new StudentsService(
      students as never,
      guardians as never,
      links as never,
      medical as never,
      statusHistory as never,
      classes as never,
      // M11/M12 history tabs (re-provisioned repos).
      { findAll: jest.fn().mockResolvedValue([]) } as never, // enrollments
      { findForEnrollments: jest.fn().mockResolvedValue([]) } as never, // attendances
      { findForStudent: jest.fn().mockResolvedValue([]) } as never, // results (M15)
      users as never,
      refreshTokens as never,
      {
        findByIdOrFail: jest
          .fn()
          .mockResolvedValue({ id: 'school-1', code: 'HXS' }),
      } as never, // schools
      {
        getValue: jest.fn().mockResolvedValue('{SCHOOL_CODE}-{YYYY}{SEQ5}'),
      } as never, // settings
      sequences as never,
      {
        getSignedUrl: jest.fn().mockResolvedValue('https://signed'),
        upload: jest.fn(),
      } as never, // storage
      { set: jest.fn() } as never, // audit context
      events as never,
    );
  });

  describe('create', () => {
    it('claims a gap-free UID inside the transaction and links the guardian', async () => {
      const result = await service.create(validDto(), actor);

      expect(sequences.nextDocumentNumber).toHaveBeenCalledWith(
        expect.objectContaining({
          counterKey: 'student:2026',
          schoolCode: 'HXS',
          tx: { tx: true },
        }),
      );
      expect(students.create).toHaveBeenCalledWith(
        expect.objectContaining({
          studentUid: 'HXS-202600001',
          qrToken: expect.stringMatching(/^[0-9a-f]{48}$/) as string,
        }),
        { tx: true },
      );
      expect(links.link).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId: 'student-1',
          guardianId: 'guardian-new',
          isPrimary: true,
        }),
        { tx: true },
      );
      expect(events.emit).toHaveBeenCalledWith(
        STUDENT_EVENTS.CREATED,
        expect.objectContaining({ studentUid: 'HXS-202600001' }),
      );
      expect(result.duplicateWarnings).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('a single unmarked guardian becomes primary implicitly', async () => {
      const dto = validDto();
      dto.guardians[0].isPrimary = undefined;

      await service.create(dto, actor);
      expect(links.link).toHaveBeenCalledWith(
        expect.objectContaining({ isPrimary: true }),
        { tx: true },
      );
    });

    it('rejects two primary guardians', async () => {
      const dto = validDto();
      dto.guardians.push({
        name: 'Mother',
        phone: '01812345678',
        relation: GuardianRelation.MOTHER,
        isPrimary: true,
      });
      dto.guardians[0].isPrimary = true;

      await expect(service.create(dto, actor)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects multiple guardians with no primary marked', async () => {
      const dto = validDto();
      dto.guardians[0].isPrimary = undefined;
      dto.guardians.push({
        name: 'Mother',
        phone: '01812345678',
        relation: GuardianRelation.MOTHER,
      });

      await expect(service.create(dto, actor)).rejects.toThrow(
        'Mark exactly one guardian as primary',
      );
    });

    it('rejects a guardian entry with neither id nor name+phone', async () => {
      const dto = validDto();
      dto.guardians = [{ relation: GuardianRelation.FATHER }];

      await expect(service.create(dto, actor)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('dedupes inline guardians by phone (siblings share rows)', async () => {
      guardians.findByPhone.mockResolvedValue({ id: 'guardian-existing' });

      await service.create(validDto(), actor);

      expect(guardians.create).not.toHaveBeenCalled();
      expect(links.link).toHaveBeenCalledWith(
        expect.objectContaining({ guardianId: 'guardian-existing' }),
        { tx: true },
      );
    });

    it('409s when the birth certificate number is already registered', async () => {
      students.findByBirthCertificate.mockResolvedValue({
        id: 'other',
        studentUid: 'HXS-202512345',
      });
      const dto = { ...validDto(), birthCertificateNo: '1'.repeat(17) };

      await expect(service.create(dto, actor)).rejects.toThrow(
        ConflictException,
      );
    });

    it('reports duplicates as warnings without blocking', async () => {
      students.findPossibleDuplicates.mockResolvedValue([
        {
          id: 'dup-1',
          studentUid: 'HXS-202500007',
          firstName: 'Rahim',
          lastName: 'Uddin',
          dob: new Date('2014-03-12'),
        },
      ]);

      const result = await service.create(validDto(), actor);
      expect(result.duplicateWarnings).toEqual([
        expect.objectContaining({
          studentUid: 'HXS-202500007',
          reason: 'NAME_DOB',
        }),
      ]);
      expect(students.create).toHaveBeenCalled();
    });

    it('warns when age is implausible for the class level', async () => {
      classes.findByIdOrFail.mockResolvedValue({
        id: 'class-1',
        name: 'Class 1',
        numericLevel: 1,
      });

      const result = await service.create(validDto(), actor); // ~11.8 yrs
      expect(result.warnings).toEqual([
        expect.stringContaining('unusual for class level 1'),
      ]);
    });

    it('rejects admission date on/before dob', async () => {
      const dto = { ...validDto(), admissionDate: '2014-03-12' };
      await expect(service.create(dto, actor)).rejects.toThrow(
        'Admission date must be after birth date',
      );
    });
  });

  describe('updateStatus', () => {
    beforeEach(() => {
      students.findByIdOrFail.mockResolvedValue({
        id: 'student-1',
        userId: 'user-9',
        status: StudentStatus.ACTIVE,
      });
    });

    it('rejects a no-op transition', async () => {
      await expect(
        service.updateStatus(
          'student-1',
          { status: StudentStatus.ACTIVE, reason: 'noop' },
          actor,
        ),
      ).rejects.toThrow('Student is already ACTIVE');
    });

    it('appends a history row and emits the cascade event', async () => {
      const result = await service.updateStatus(
        'student-1',
        { status: StudentStatus.TRANSFERRED, reason: 'Family moved' },
        actor,
      );

      expect(statusHistory.append).toHaveBeenCalledWith(
        expect.objectContaining({
          fromStatus: StudentStatus.ACTIVE,
          toStatus: StudentStatus.TRANSFERRED,
          reason: 'Family moved',
        }),
        { tx: true },
      );
      expect(events.emit).toHaveBeenCalledWith(
        STUDENT_EVENTS.STATUS_CHANGED,
        expect.objectContaining({ userId: 'user-9', to: 'TRANSFERRED' }),
      );
      // Dues check is soft until M16 (roadmap M09 §6).
      expect(result.warnings[0]).toContain('Dues clearance');
    });

    it('non-exit transitions carry no dues warning', async () => {
      const result = await service.updateStatus(
        'student-1',
        { status: StudentStatus.SUSPENDED, reason: 'Disciplinary' },
        actor,
      );
      expect(result.warnings).toEqual([]);
    });
  });

  describe('remove', () => {
    it('soft-deletes the portal user too and revokes sessions', async () => {
      students.findByIdOrFail.mockResolvedValue({
        id: 'student-1',
        userId: 'user-9',
        studentUid: 'HXS-202600001',
        status: StudentStatus.ACTIVE,
      });

      await service.remove('student-1', actor);

      expect(users.update).toHaveBeenCalledWith(
        'user-9',
        expect.objectContaining({ status: 'INACTIVE' }),
        { tx: true },
      );
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('user-9');
    });

    it('skips the user cascade when no portal account exists', async () => {
      students.findByIdOrFail.mockResolvedValue({
        id: 'student-1',
        userId: null,
        studentUid: 'HXS-202600001',
        status: StudentStatus.ACTIVE,
      });

      await service.remove('student-1', actor);
      expect(users.update).not.toHaveBeenCalled();
      expect(refreshTokens.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('rotateQrToken', () => {
    it('replaces the token with a fresh random value', async () => {
      students.findByIdOrFail.mockResolvedValue({ id: 'student-1' });

      await service.rotateQrToken('student-1', actor);
      expect(students.update).toHaveBeenCalledWith('student-1', {
        qrToken: expect.stringMatching(/^[0-9a-f]{48}$/) as string,
        updatedBy: 'actor-1',
      });
    });
  });

  describe('medical', () => {
    it('returns an empty shell when no record exists', async () => {
      students.findByIdOrFail.mockResolvedValue({ id: 'student-1' });
      const result = await service.getMedical('student-1', 'school-1');
      expect(result).toEqual({ studentId: 'student-1' });
    });

    it('upserts the record with null-normalized fields', async () => {
      students.findByIdOrFail.mockResolvedValue({ id: 'student-1' });

      await service.updateMedical(
        'student-1',
        { heightCm: 140.5, allergies: 'Dust' },
        actor,
      );
      expect(medical.upsertForStudent).toHaveBeenCalledWith(
        'student-1',
        'school-1',
        expect.objectContaining({
          heightCm: 140.5,
          allergies: 'Dust',
          weightKg: null,
        }),
      );
    });
  });
});
