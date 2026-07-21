import { AttendanceStatus } from '../../../common/constants';
import { AutoAbsentJob } from './auto-absent.job';

describe('AutoAbsentJob', () => {
  let attendances: Record<string, jest.Mock>;
  let enrollments: Record<string, jest.Mock>;
  let schools: Record<string, jest.Mock>;
  let calendar: Record<string, jest.Mock>;
  let config: Record<string, jest.Mock>;
  let job: AutoAbsentJob;

  const roster = [
    { id: 'enr-1', enrollmentDate: new Date('2026-01-01') },
    { id: 'enr-2', enrollmentDate: new Date('2026-01-01') },
    // Joins next month — must never be auto-absented today.
    { id: 'enr-3', enrollmentDate: new Date('2026-08-01') },
  ];

  beforeEach(() => {
    // 12:00 Dhaka — past the 11:00 cutoff.
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T06:00:00Z'));

    attendances = {
      findMarkedSectionIds: jest.fn().mockResolvedValue(['sec-1']),
      findForSectionDate: jest
        .fn()
        .mockResolvedValue([{ enrollmentId: 'enr-1' }]),
      upsertEntry: jest.fn().mockResolvedValue({ id: 'att' }),
    };
    enrollments = { findSectionRoster: jest.fn().mockResolvedValue(roster) };
    schools = { findAll: jest.fn().mockResolvedValue([{ id: 'school-1' }]) };
    calendar = { isHoliday: jest.fn().mockResolvedValue({ holiday: false }) };
    config = {
      load: jest.fn().mockResolvedValue({
        autoAbsentEnabled: true,
        autoAbsentMinutes: 660, // 11:00
      }),
    };

    job = new AutoAbsentJob(
      attendances as never,
      enrollments as never,
      schools as never,
      calendar as never,
      config as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('absents only unmarked, already-enrolled students', async () => {
    const marked = await job.run();
    expect(marked).toBe(1);
    expect(attendances.upsertEntry).toHaveBeenCalledTimes(1);
    expect(attendances.upsertEntry).toHaveBeenCalledWith(
      expect.objectContaining({ enrollmentId: 'enr-2' }),
      expect.objectContaining({ status: AttendanceStatus.ABSENT }),
    );
  });

  it('does nothing when the setting is off', async () => {
    config.load.mockResolvedValue({
      autoAbsentEnabled: false,
      autoAbsentMinutes: 660,
    });
    expect(await job.run()).toBe(0);
    expect(attendances.upsertEntry).not.toHaveBeenCalled();
  });

  it('does nothing before the cutoff time', async () => {
    jest.setSystemTime(new Date('2026-07-21T03:00:00Z')); // 09:00 Dhaka
    expect(await job.run()).toBe(0);
  });

  it('does nothing on a holiday', async () => {
    calendar.isHoliday.mockResolvedValue({ holiday: true, title: 'Eid' });
    expect(await job.run()).toBe(0);
  });

  it('leaves sections nobody started marking alone', async () => {
    attendances.findMarkedSectionIds.mockResolvedValue([]);
    expect(await job.run()).toBe(0);
    expect(enrollments.findSectionRoster).not.toHaveBeenCalled();
  });

  it('is idempotent — a second run finds nothing left to mark', async () => {
    await job.run();
    attendances.findForSectionDate.mockResolvedValue([
      { enrollmentId: 'enr-1' },
      { enrollmentId: 'enr-2' },
    ]);
    attendances.upsertEntry.mockClear();
    expect(await job.run()).toBe(0);
    expect(attendances.upsertEntry).not.toHaveBeenCalled();
  });
});
