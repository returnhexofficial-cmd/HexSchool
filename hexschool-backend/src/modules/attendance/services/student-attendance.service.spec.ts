import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  AttendanceStatus,
  SessionStatus,
  UserType,
} from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { StudentAttendanceService } from './student-attendance.service';

/**
 * The guards the roadmap (M12 §6/§8) makes non-negotiable: no future
 * dates, no closed sessions, no marking a holiday without the override
 * permission, no silent re-mark, and approved leave beating a submitted
 * ABSENT.
 */
describe('StudentAttendanceService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };

  const TODAY = '2026-07-21';

  let attendances: Record<string, jest.Mock>;
  let leaves: Record<string, jest.Mock>;
  let sections: Record<string, jest.Mock>;
  let sessions: Record<string, jest.Mock>;
  let enrollments: Record<string, jest.Mock>;
  let calendar: Record<string, jest.Mock>;
  let config: Record<string, jest.Mock>;
  let permissions: Record<string, jest.Mock>;
  let service: StudentAttendanceService;

  const roster = [
    {
      id: 'enr-1',
      studentId: 'stu-1',
      rollNo: 1,
      enrollmentDate: new Date('2026-01-01'),
      student: {
        id: 'stu-1',
        studentUid: 'HXS-1',
        firstName: 'A',
        lastName: 'B',
      },
    },
    {
      id: 'enr-2',
      studentId: 'stu-2',
      rollNo: 2,
      // Joined mid-year, after the date under test.
      enrollmentDate: new Date('2026-09-01'),
      student: {
        id: 'stu-2',
        studentUid: 'HXS-2',
        firstName: 'C',
        lastName: 'D',
      },
    },
  ];

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T04:00:00Z`));

    attendances = {
      findForSectionDate: jest.fn().mockResolvedValue([]),
      upsertEntry: jest
        .fn()
        .mockImplementation((key: object) =>
          Promise.resolve({ id: 'att', ...key }),
        ),
      convertDateToHoliday: jest.fn().mockResolvedValue(12),
      withTransaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => unknown) => fn({})),
    };
    leaves = { findApprovedCovering: jest.fn().mockResolvedValue([]) };
    sections = {
      findDetail: jest.fn().mockResolvedValue({
        id: 'sec-1',
        name: 'A',
        sessionId: 'ses-1',
        class: { id: 'cls-6', name: 'Class 6' },
      }),
    };
    sessions = {
      findByIdOrFail: jest.fn().mockResolvedValue({
        id: 'ses-1',
        name: '2026',
        status: SessionStatus.ACTIVE,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      }),
    };
    enrollments = { getSectionStudents: jest.fn().mockResolvedValue(roster) };
    calendar = { isHoliday: jest.fn().mockResolvedValue({ holiday: false }) };
    config = { load: jest.fn().mockResolvedValue({ editWindowDays: 7 }) };
    permissions = { getUserPermissionCodes: jest.fn().mockResolvedValue([]) };

    service = new StudentAttendanceService(
      attendances as never,
      leaves as never,
      sections as never,
      sessions as never,
      enrollments as never,
      calendar as never,
      config as never,
      permissions as never,
      { set: jest.fn() } as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  const markDto = (overrides: object = {}) => ({
    sectionId: 'sec-1',
    date: TODAY,
    entries: [{ enrollmentId: 'enr-1', status: AttendanceStatus.PRESENT }],
    ...overrides,
  });

  it('marks a normal day', async () => {
    const result = await service.mark(markDto(), actor);
    expect(result.saved).toBe(1);
    expect(attendances.upsertEntry).toHaveBeenCalledTimes(1);
  });

  it('refuses a future date', async () => {
    await expect(
      service.mark(markDto({ date: '2026-08-01' }) as never, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a date outside the session', async () => {
    sessions.findByIdOrFail.mockResolvedValue({
      id: 'ses-1',
      name: '2027',
      status: SessionStatus.ACTIVE,
      startDate: new Date('2027-01-01'),
      endDate: new Date('2027-12-31'),
    });
    await expect(service.mark(markDto() as never, actor)).rejects.toThrow(
      /outside session/,
    );
  });

  it('refuses entry into a COMPLETED session (M05 read-only rule)', async () => {
    sessions.findByIdOrFail.mockResolvedValue({
      id: 'ses-1',
      name: '2025',
      status: SessionStatus.COMPLETED,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    });
    await expect(service.mark(markDto() as never, actor)).rejects.toThrow(
      /read-only/,
    );
  });

  it('blocks marking a holiday, and allows it with the override permission', async () => {
    calendar.isHoliday.mockResolvedValue({
      holiday: true,
      reason: 'RANGE',
      title: 'Eid',
    });

    await expect(service.mark(markDto() as never, actor)).rejects.toThrow(
      /holiday/,
    );

    await expect(
      service.mark(markDto({ overrideHoliday: true }) as never, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);

    permissions.getUserPermissionCodes.mockResolvedValue([
      'attendance.holiday.override',
    ]);
    const result = await service.mark(
      markDto({ overrideHoliday: true }),
      actor,
    );
    expect(result.saved).toBe(1);
  });

  it('requires attendance.edit to re-mark an already-marked day', async () => {
    attendances.findForSectionDate.mockResolvedValue([
      { id: 'att-1', enrollmentId: 'enr-1', status: AttendanceStatus.PRESENT },
    ]);

    await expect(
      service.mark(markDto() as never, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);

    permissions.getUserPermissionCodes.mockResolvedValue(['attendance.edit']);
    await expect(
      service.mark(markDto() as never, actor),
    ).resolves.toMatchObject({ saved: 1 });
  });

  it('requires attendance.edit.past beyond the edit window', async () => {
    // 10 days ago, window is 7.
    await expect(
      service.mark(markDto({ date: '2026-07-11' }) as never, actor),
    ).rejects.toThrow(/attendance.edit.past/);
  });

  it('skips entries that are not on the roster or predate enrolment', async () => {
    const result = await service.mark(
      markDto({
        entries: [
          { enrollmentId: 'enr-1', status: AttendanceStatus.PRESENT },
          { enrollmentId: 'enr-2', status: AttendanceStatus.ABSENT },
          { enrollmentId: 'stranger', status: AttendanceStatus.PRESENT },
        ],
      }),
      actor,
    );
    expect(result.saved).toBe(1);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.map((s) => s.reason)).toEqual([
      'Date is before the student joined the section',
      'Not an active enrollment of this section',
    ]);
  });

  it('turns a submitted ABSENT into LEAVE when leave is approved', async () => {
    leaves.findApprovedCovering.mockResolvedValue([{ studentId: 'stu-1' }]);
    const result = await service.mark(
      markDto({
        entries: [{ enrollmentId: 'enr-1', status: AttendanceStatus.ABSENT }],
      }),
      actor,
    );
    expect(result.leaveOverrides).toBe(1);
    expect(attendances.upsertEntry).toHaveBeenCalledWith(
      expect.objectContaining({ enrollmentId: 'enr-1' }),
      expect.objectContaining({ status: AttendanceStatus.LEAVE }),
      expect.anything(),
    );
  });

  it('refuses to mark an empty section', async () => {
    enrollments.getSectionStudents.mockResolvedValue([]);
    await expect(service.mark(markDto() as never, actor)).rejects.toThrow(
      /no enrolled students/,
    );
  });

  it('builds a sheet flagging pre-enrolment rows and approved leave', async () => {
    leaves.findApprovedCovering.mockResolvedValue([{ studentId: 'stu-1' }]);
    const sheet = await service.getSheet(
      { sectionId: 'sec-1', date: TODAY },
      actor,
    );
    expect(sheet.marked).toBe(false);
    expect(sheet.editable).toBe(true);
    expect(sheet.rows[0].onApprovedLeave).toBe(true);
    expect(sheet.rows[1].beforeEnrollment).toBe(true);
  });

  it('converts a marked date to HOLIDAY', async () => {
    const result = await service.convertToHoliday(
      { date: TODAY, reason: 'Government holiday declared late' },
      actor,
    );
    expect(result.converted).toBe(12);
    expect(attendances.convertDateToHoliday).toHaveBeenCalledWith(
      'school-1',
      expect.any(Date),
      undefined,
      'actor-1',
    );
  });
});
