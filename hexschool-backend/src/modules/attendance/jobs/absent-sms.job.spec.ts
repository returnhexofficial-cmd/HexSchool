import { AbsentSmsJob } from './absent-sms.job';

describe('AbsentSmsJob', () => {
  let attendances: Record<string, jest.Mock>;
  let studentGuardians: Record<string, jest.Mock>;
  let schools: Record<string, jest.Mock>;
  let config: Record<string, jest.Mock>;
  let notifications: Record<string, jest.Mock>;
  let job: AbsentSmsJob;

  const absentRows = [
    {
      id: 'att-1',
      enrollment: {
        studentId: 'stu-1',
        rollNo: 4,
        student: { studentUid: 'HXS-1', firstName: 'Ayesha', lastName: 'R' },
      },
    },
    {
      id: 'att-2',
      enrollment: {
        studentId: 'stu-2',
        rollNo: 9,
        student: { studentUid: 'HXS-2', firstName: 'Rakib', lastName: 'H' },
      },
    },
  ];

  beforeEach(() => {
    // 13:00 Dhaka — past the 12:00 dispatch time.
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T07:00:00Z'));

    attendances = {
      findPendingAbsentNotifications: jest.fn().mockResolvedValue(absentRows),
      markNotified: jest.fn(),
    };
    studentGuardians = {
      findPrimaryForStudents: jest.fn().mockResolvedValue([
        { studentId: 'stu-1', guardian: { phone: '01712345678' } },
        { studentId: 'stu-2', guardian: { phone: '01898765432' } },
      ]),
    };
    schools = {
      findAll: jest
        .fn()
        .mockResolvedValue([{ id: 'school-1', name: 'HexSchool' }]),
    };
    config = {
      load: jest.fn().mockResolvedValue({
        absentSmsEnabled: true,
        absentSmsMinutes: 720, // 12:00
        absentSmsDailyCap: 500,
      }),
    };
    notifications = { send: jest.fn().mockResolvedValue({ id: 'n-1' }) };

    job = new AbsentSmsJob(
      attendances as never,
      studentGuardians as never,
      schools as never,
      config as never,
      notifications as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('sends one ABSENT_ALERT per absent student and flags them notified', async () => {
    expect(await job.run()).toBe(2);
    expect(notifications.send).toHaveBeenCalledTimes(2);
    const [input] = notifications.send.mock.calls[0] as [
      {
        code: string;
        channel: string;
        recipient: { destination: string };
        vars: { student_name: string };
      },
    ];
    expect(input.code).toBe('ABSENT_ALERT');
    expect(input.channel).toBe('SMS');
    expect(input.recipient.destination).toBe('01712345678');
    expect(input.vars.student_name).toContain('Ayesha');
    expect(attendances.markNotified).toHaveBeenCalledWith(['att-1', 'att-2']);
  });

  it('merges two absent siblings on one number into a single SMS', async () => {
    studentGuardians.findPrimaryForStudents.mockResolvedValue([
      { studentId: 'stu-1', guardian: { phone: '01712345678' } },
      { studentId: 'stu-2', guardian: { phone: '01712345678' } },
    ]);
    expect(await job.run()).toBe(2); // 2 students flagged
    expect(notifications.send).toHaveBeenCalledTimes(1); // one message
    const [input] = notifications.send.mock.calls[0] as [
      { vars: { student_name: string } },
    ];
    expect(input.vars.student_name).toBe('Ayesha R, Rakib H');
    expect(attendances.markNotified).toHaveBeenCalledWith(['att-1', 'att-2']);
  });

  it('does nothing when absent SMS is disabled', async () => {
    config.load.mockResolvedValue({
      absentSmsEnabled: false,
      absentSmsMinutes: 720,
      absentSmsDailyCap: 500,
    });
    expect(await job.run()).toBe(0);
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('does nothing before the dispatch time', async () => {
    jest.setSystemTime(new Date('2026-07-21T03:00:00Z')); // 09:00 Dhaka
    expect(await job.run()).toBe(0);
  });

  it('passes the daily cap through as the query limit', async () => {
    config.load.mockResolvedValue({
      absentSmsEnabled: true,
      absentSmsMinutes: 720,
      absentSmsDailyCap: 50,
    });
    await job.run();
    expect(attendances.findPendingAbsentNotifications).toHaveBeenCalledWith(
      'school-1',
      expect.any(Date),
      50,
    );
  });

  it('flags students without a primary guardian instead of retrying all day', async () => {
    studentGuardians.findPrimaryForStudents.mockResolvedValue([
      { studentId: 'stu-1', guardian: { phone: '01712345678' } },
    ]);
    expect(await job.run()).toBe(2);
    expect(notifications.send).toHaveBeenCalledTimes(1);
    expect(attendances.markNotified).toHaveBeenCalledWith(['att-1', 'att-2']);
  });

  it('dedupes across runs — already-notified rows never come back', async () => {
    await job.run();
    attendances.findPendingAbsentNotifications.mockResolvedValue([]);
    notifications.send.mockClear();
    expect(await job.run()).toBe(0);
    expect(notifications.send).not.toHaveBeenCalled();
  });
});
