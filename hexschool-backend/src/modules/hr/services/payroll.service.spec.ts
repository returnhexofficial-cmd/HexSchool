import { AttendanceStatus, StaffStatus } from '@prisma/client';
import {
  employmentWindow,
  endOfMonth,
  monthStart,
  summarizeAttendance,
} from './payroll.service';

/**
 * The pure helpers payroll generation leans on. They are exported from
 * the service rather than the engine because they translate *stored
 * shapes* (an employee row, an attendance row) into engine inputs — but
 * they are decisions, not plumbing, and the two below are exactly where a
 * quiet mistake would over- or under-pay somebody every single month.
 */
describe('payroll month helpers', () => {
  it('pins a month to its first and last day', () => {
    const march = monthStart('2027-03');
    expect(march.toISOString().slice(0, 10)).toBe('2027-03-01');
    expect(endOfMonth(march).toISOString().slice(0, 10)).toBe('2027-03-31');
  });

  it('handles February in a leap year', () => {
    expect(endOfMonth(monthStart('2028-02')).toISOString().slice(0, 10)).toBe(
      '2028-02-29',
    );
  });
});

describe('employmentWindow', () => {
  const march = monthStart('2027-03');
  const marchEnd = endOfMonth(march);
  const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

  const employee = (over: {
    joiningDate: string;
    exitDate?: string | null;
    status?: StaffStatus;
  }) => ({
    joiningDate: date(over.joiningDate),
    exitDate: over.exitDate ? date(over.exitDate) : null,
    status: over.status ?? StaffStatus.ACTIVE,
  });

  it('gives a full month to somebody employed throughout', () => {
    expect(
      employmentWindow(
        employee({ joiningDate: '2020-01-01' }),
        march,
        marchEnd,
      ),
    ).toEqual({ employed: true, from: '2027-03-01', to: '2027-03-31' });
  });

  it('starts a mid-month joiner on their joining date', () => {
    expect(
      employmentWindow(
        employee({ joiningDate: '2027-03-16' }),
        march,
        marchEnd,
      ),
    ).toEqual({ employed: true, from: '2027-03-16', to: '2027-03-31' });
  });

  it('ends a leaver on their exit date', () => {
    expect(
      employmentWindow(
        employee({
          joiningDate: '2020-01-01',
          exitDate: '2027-03-12',
          status: StaffStatus.RESIGNED,
        }),
        march,
        marchEnd,
      ),
    ).toEqual({ employed: true, from: '2027-03-01', to: '2027-03-12' });
  });

  it('excludes somebody who joins after the month ends', () => {
    expect(
      employmentWindow(employee({ joiningDate: '2027-04-01' }), march, marchEnd)
        .employed,
    ).toBe(false);
  });

  it('excludes somebody who left before the month started', () => {
    expect(
      employmentWindow(
        employee({
          joiningDate: '2020-01-01',
          exitDate: '2027-02-28',
          status: StaffStatus.RESIGNED,
        }),
        march,
        marchEnd,
      ).employed,
    ).toBe(false);
  });

  it('excludes a leaver with no exit date rather than paying a full month', () => {
    // A status change recorded before M21 added `exit_date` carries no
    // date at all. Paying them a whole month would be a silent overpay
    // every month forever; leaving them out is visible on the register.
    expect(
      employmentWindow(
        employee({ joiningDate: '2020-01-01', status: StaffStatus.TERMINATED }),
        march,
        marchEnd,
      ).employed,
    ).toBe(false);
  });

  it('keeps an ON_LEAVE employee on the payroll', () => {
    // Being on leave is not leaving: their pay is decided by the leave
    // type's paid/unpaid flag, not by their presence in the run.
    expect(
      employmentWindow(
        employee({ joiningDate: '2020-01-01', status: StaffStatus.ON_LEAVE }),
        march,
        marchEnd,
      ).employed,
    ).toBe(true);
  });

  it('handles somebody who joined AND left inside the month', () => {
    expect(
      employmentWindow(
        employee({
          joiningDate: '2027-03-05',
          exitDate: '2027-03-20',
          status: StaffStatus.RESIGNED,
        }),
        march,
        marchEnd,
      ),
    ).toEqual({ employed: true, from: '2027-03-05', to: '2027-03-20' });
  });
});

describe('summarizeAttendance', () => {
  const eligible = [
    '2027-03-01',
    '2027-03-02',
    '2027-03-03',
    '2027-03-04',
    '2027-03-07',
  ];
  const row = (date: string, status: AttendanceStatus) => ({
    date: new Date(`${date}T00:00:00.000Z`),
    status,
  });

  it('counts present and late alike', () => {
    const tally = summarizeAttendance(
      [
        row('2027-03-01', AttendanceStatus.PRESENT),
        row('2027-03-02', AttendanceStatus.LATE),
      ],
      eligible,
      new Set(),
    );
    // Three unmarked days count as present — see the next test.
    expect(tally.present).toBe(5);
    expect(tally.absent).toBe(0);
  });

  it('splits a half day between present and absent', () => {
    const tally = summarizeAttendance(
      [row('2027-03-01', AttendanceStatus.HALF_DAY)],
      ['2027-03-01'],
      new Set(),
    );
    expect(tally).toEqual({ present: 0.5, absent: 0.5, marked: 1 });
  });

  it('counts absence only where it was actually recorded', () => {
    const tally = summarizeAttendance(
      [row('2027-03-01', AttendanceStatus.ABSENT)],
      eligible,
      new Set(),
    );
    expect(tally.absent).toBe(1);
    // The four unmarked days are NOT absences: recording one is the
    // register's job, and inferring it here would dock pay for the
    // office's backlog (the M15 "a missing mark is never a zero" rule).
    expect(tally.present).toBe(4);
  });

  it('never counts a leave day as absence, however it was marked', () => {
    // The leave split has already accounted for the day; counting it here
    // too would deduct for the same date twice.
    const tally = summarizeAttendance(
      [row('2027-03-01', AttendanceStatus.ABSENT)],
      eligible,
      new Set(['2027-03-01']),
    );
    expect(tally.absent).toBe(0);
    expect(tally.present).toBe(4);
  });

  it('ignores rows outside the employment window', () => {
    const tally = summarizeAttendance(
      [row('2027-03-09', AttendanceStatus.ABSENT)],
      eligible,
      new Set(),
    );
    expect(tally.absent).toBe(0);
    expect(tally.marked).toBe(0);
  });

  it('ignores HOLIDAY rows', () => {
    const tally = summarizeAttendance(
      [row('2027-03-01', AttendanceStatus.HOLIDAY)],
      ['2027-03-01'],
      new Set(),
    );
    expect(tally).toEqual({ present: 1, absent: 0, marked: 0 });
  });
});
