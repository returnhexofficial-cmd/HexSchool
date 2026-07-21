import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AttendanceStatus, UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { QrCheckinService } from './qr-checkin.service';

describe('QrCheckinService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };

  let students: Record<string, jest.Mock>;
  let enrollments: Record<string, jest.Mock>;
  let attendances: Record<string, jest.Mock>;
  let sections: Record<string, jest.Mock>;
  let shifts: Record<string, jest.Mock>;
  let sessions: Record<string, jest.Mock>;
  let calendar: Record<string, jest.Mock>;
  let config: Record<string, jest.Mock>;
  let service: QrCheckinService;

  /** Arrival time in Dhaka (UTC+6) for the scan under test. */
  const scanAt = (localTime: string) =>
    jest.useFakeTimers().setSystemTime(new Date(`2026-07-21T${localTime}:00Z`));

  beforeEach(() => {
    students = {
      findByQrToken: jest.fn().mockResolvedValue({
        id: 'stu-1',
        schoolId: 'school-1',
        deletedAt: null,
        studentUid: 'HXS-1',
        firstName: 'Ayesha',
        lastName: 'Rahman',
        photoUrl: null,
      }),
    };
    enrollments = {
      getStudentCurrentEnrollment: jest.fn().mockResolvedValue({
        id: 'enr-1',
        sectionId: 'sec-1',
        shiftId: null,
        rollNo: 7,
        class: { name: 'Class 6' },
        section: { name: 'A' },
      }),
    };
    attendances = {
      findForSectionDate: jest.fn().mockResolvedValue([]),
      upsertEntry: jest.fn().mockResolvedValue({ id: 'att-1' }),
    };
    sections = { findDetail: jest.fn() };
    shifts = { findById: jest.fn() };
    sessions = {
      getCurrent: jest.fn().mockResolvedValue({ id: 'ses-1', name: '2026' }),
    };
    calendar = { isHoliday: jest.fn().mockResolvedValue({ holiday: false }) };
    config = {
      load: jest.fn().mockResolvedValue({
        defaultStartMinutes: 480, // 08:00
        lateAfterMinutes: 15,
        halfDayAfterMinutes: 120,
        qrDuplicateWindowMinutes: 5,
      }),
    };

    service = new QrCheckinService(
      students as never,
      enrollments as never,
      attendances as never,
      sections as never,
      shifts as never,
      sessions as never,
      calendar as never,
      config as never,
      { getSignedUrl: jest.fn() } as never,
      { set: jest.fn() } as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('marks PRESENT inside the grace period', async () => {
    scanAt('02:10'); // 08:10 Dhaka — 10 minutes late, grace is 15.
    const result = await service.checkin({ qrToken: 'tok' }, actor);
    expect(result.status).toBe(AttendanceStatus.PRESENT);
    expect(result.marked).toBe(true);
    expect(result.student.rollNo).toBe(7);
  });

  it('marks LATE past the grace period', async () => {
    scanAt('02:45'); // 08:45 Dhaka — 45 minutes late.
    const result = await service.checkin({ qrToken: 'tok' }, actor);
    expect(result.status).toBe(AttendanceStatus.LATE);
    expect(result.minutesLate).toBe(45);
  });

  it('marks HALF_DAY past the half-day cutoff', async () => {
    scanAt('05:00'); // 11:00 Dhaka — 180 minutes late, cutoff is 120.
    const result = await service.checkin({ qrToken: 'tok' }, actor);
    expect(result.status).toBe(AttendanceStatus.HALF_DAY);
  });

  it("uses the section's shift start time when it has one", async () => {
    scanAt('02:10'); // 08:10 Dhaka.
    enrollments.getStudentCurrentEnrollment.mockResolvedValue({
      id: 'enr-1',
      sectionId: 'sec-1',
      shiftId: 'shift-morning',
      rollNo: 7,
      class: { name: 'Class 6' },
      section: { name: 'A' },
    });
    // Morning shift starts 07:00 → the same scan is now 70 minutes late.
    shifts.findById.mockResolvedValue({
      startTime: new Date('1970-01-01T07:00:00Z'),
    });
    const result = await service.checkin({ qrToken: 'tok' }, actor);
    expect(result.minutesLate).toBe(70);
    expect(result.status).toBe(AttendanceStatus.LATE);
  });

  it('is idempotent for a re-scan inside the dedupe window', async () => {
    scanAt('02:10');
    attendances.findForSectionDate.mockResolvedValue([
      {
        enrollmentId: 'enr-1',
        status: AttendanceStatus.PRESENT,
        updatedAt: new Date('2026-07-21T02:08:00Z'), // 2 minutes ago
      },
    ]);
    const result = await service.checkin({ qrToken: 'tok' }, actor);
    expect(result.marked).toBe(false);
    expect(result.alreadyMarked).toBe(true);
    expect(attendances.upsertEntry).not.toHaveBeenCalled();
  });

  it('re-marks once the dedupe window has passed', async () => {
    scanAt('02:10');
    attendances.findForSectionDate.mockResolvedValue([
      {
        enrollmentId: 'enr-1',
        status: AttendanceStatus.PRESENT,
        updatedAt: new Date('2026-07-21T01:00:00Z'), // 70 minutes ago
      },
    ]);
    const result = await service.checkin({ qrToken: 'tok' }, actor);
    expect(result.marked).toBe(true);
    expect(attendances.upsertEntry).toHaveBeenCalled();
  });

  it('rejects an unknown or foreign-school QR token', async () => {
    scanAt('02:10');
    students.findByQrToken.mockResolvedValue(null);
    await expect(
      service.checkin({ qrToken: 'nope' }, actor),
    ).rejects.toBeInstanceOf(NotFoundException);

    students.findByQrToken.mockResolvedValue({
      id: 'stu-x',
      schoolId: 'other-school',
      deletedAt: null,
    });
    await expect(
      service.checkin({ qrToken: 'tok' }, actor),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a student with no active enrollment', async () => {
    scanAt('02:10');
    enrollments.getStudentCurrentEnrollment.mockResolvedValue(null);
    await expect(service.checkin({ qrToken: 'tok' }, actor)).rejects.toThrow(
      /no active enrollment/,
    );
  });

  it('refuses to scan on a holiday', async () => {
    scanAt('02:10');
    calendar.isHoliday.mockResolvedValue({ holiday: true, title: 'Eid' });
    await expect(
      service.checkin({ qrToken: 'tok' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
