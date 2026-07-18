import {
  AdmissionApplicationStatus,
  AdmissionCycleStatus,
} from '../../../common/constants';
import { compareForMerit, MeritListService } from './merit-list.service';

const d = (iso: string) => new Date(iso);

describe('compareForMerit (roadmap M10 §4 ordering)', () => {
  it('ranks by test marks descending first', () => {
    const ranked = [
      { testMarks: 60, previousGpa: 5, dob: d('2015-01-01') },
      { testMarks: 90, previousGpa: 3, dob: d('2016-01-01') },
      { testMarks: 75, previousGpa: 4, dob: d('2014-01-01') },
    ].sort(compareForMerit);
    expect(ranked.map((r) => r.testMarks)).toEqual([90, 75, 60]);
  });

  it('breaks mark ties by previous GPA descending', () => {
    const ranked = [
      { testMarks: 80, previousGpa: 3.5, dob: d('2015-01-01') },
      { testMarks: 80, previousGpa: 5.0, dob: d('2016-01-01') },
    ].sort(compareForMerit);
    expect(ranked.map((r) => r.previousGpa)).toEqual([5.0, 3.5]);
  });

  it('breaks GPA ties by dob ascending (older applicant wins)', () => {
    const ranked = [
      { testMarks: 80, previousGpa: 4, dob: d('2016-05-01') },
      { testMarks: 80, previousGpa: 4, dob: d('2015-02-01') },
    ].sort(compareForMerit);
    expect(ranked.map((r) => r.dob.toISOString().slice(0, 10))).toEqual([
      '2015-02-01',
      '2016-05-01',
    ]);
  });

  it('sorts null marks/GPA last', () => {
    const ranked = [
      { testMarks: null, previousGpa: null, dob: d('2015-01-01') },
      { testMarks: 10, previousGpa: null, dob: d('2015-01-01') },
      { testMarks: null, previousGpa: 2, dob: d('2015-01-01') },
    ].sort(compareForMerit);
    expect(ranked[0].testMarks).toBe(10);
    expect(ranked[1].previousGpa).toBe(2);
    expect(ranked[2].testMarks).toBeNull();
  });

  it('accepts Decimal-like values (Prisma)', () => {
    const decimal = (v: string) => ({ toString: () => v });
    const ranked = [
      { testMarks: decimal('55.50'), previousGpa: null, dob: d('2015-01-01') },
      { testMarks: decimal('71.25'), previousGpa: null, dob: d('2015-01-01') },
    ].sort(compareForMerit);
    expect(String(ranked[0].testMarks)).toBe('71.25');
  });
});

describe('MeritListService.generate', () => {
  const cycles = {
    findDetail: jest.fn(),
    findById: jest.fn(),
    withTransaction: jest.fn(),
  };
  const applications = {
    findForMerit: jest.fn(),
    countAdmitted: jest.fn(),
    withTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({}),
    ),
    update: jest.fn(),
    findNextWaitlisted: jest.fn(),
    findMeritList: jest.fn(),
  };
  const settings = { getValue: jest.fn().mockResolvedValue(7) };
  const auditContext = { set: jest.fn() };
  const events = { emit: jest.fn() };
  const actor = { sub: 'admin-1', schoolId: 'school-1' } as never;

  const service = new MeritListService(
    cycles as never,
    applications as never,
    settings as never,
    auditContext as never,
    events as never,
  );

  const app = (
    id: string,
    marks: number | null,
    status: AdmissionApplicationStatus = AdmissionApplicationStatus.PASSED,
  ) => ({
    id,
    applicationNo: `ADM-${id}`,
    schoolId: 'school-1',
    phone: '01712345678',
    status,
    testMarks: marks,
    previousGpa: null,
    dob: d('2015-01-01'),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    settings.getValue.mockResolvedValue(7);
    cycles.findDetail.mockResolvedValue({
      id: 'cycle-1',
      schoolId: 'school-1',
      status: AdmissionCycleStatus.CLOSED,
      testRequired: true,
      classes: [{ classId: 'class-1', seats: 2, applicationFee: 0 }],
    });
    applications.countAdmitted.mockResolvedValue(0);
  });

  it('selects up to seats, waitlists the rest, positions 1..n', async () => {
    applications.findForMerit
      .mockResolvedValueOnce([app('a', 50), app('b', 90), app('c', 70)])
      .mockResolvedValueOnce([]); // no previous list

    const result = await service.generate('cycle-1', 'class-1', actor);

    expect(result).toMatchObject({ selected: 2, waitlisted: 1 });
    const updates = applications.update.mock.calls.map(
      ([id, data]: [string, Record<string, unknown>]) => ({ id, ...data }),
    );
    expect(updates).toEqual([
      expect.objectContaining({
        id: 'b',
        meritPosition: 1,
        status: AdmissionApplicationStatus.SELECTED,
      }),
      expect.objectContaining({
        id: 'c',
        meritPosition: 2,
        status: AdmissionApplicationStatus.SELECTED,
      }),
      expect.objectContaining({
        id: 'a',
        meritPosition: 3,
        status: AdmissionApplicationStatus.WAITLISTED,
        admissionDeadline: null,
      }),
    ]);
    // SELECTED rows carry a deadline ≈ 7 days out.
    const selectedUpdate = updates[0] as unknown as {
      admissionDeadline: Date;
    };
    const days =
      (selectedUpdate.admissionDeadline.getTime() - Date.now()) /
      (24 * 3600 * 1000);
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it('refuses to rank while the cycle is still OPEN', async () => {
    cycles.findDetail.mockResolvedValue({
      id: 'cycle-1',
      status: AdmissionCycleStatus.OPEN,
      testRequired: true,
      classes: [{ classId: 'class-1', seats: 2 }],
    });
    await expect(service.generate('cycle-1', 'class-1', actor)).rejects.toThrow(
      /close the cycle/i,
    );
  });

  it('regeneration folds the previous SELECTED/WAITLISTED back into the pool', async () => {
    applications.findForMerit
      .mockResolvedValueOnce([app('new', 95)])
      .mockResolvedValueOnce([
        app('old1', 80, AdmissionApplicationStatus.SELECTED),
        app('old2', 60, AdmissionApplicationStatus.WAITLISTED),
      ]);

    const result = await service.generate('cycle-1', 'class-1', actor);
    expect(result.regenerated).toBe(true);
    const order = applications.update.mock.calls.map(
      ([id]: [string, unknown]) => id,
    );
    expect(order).toEqual(['new', 'old1', 'old2']);
  });

  it('ADMITTED applications keep consuming seats', async () => {
    applications.countAdmitted.mockResolvedValue(2); // all seats taken
    applications.findForMerit
      .mockResolvedValueOnce([app('a', 90)])
      .mockResolvedValueOnce([]);

    const result = await service.generate('cycle-1', 'class-1', actor);
    expect(result.selected).toBe(0);
    expect(result.waitlisted).toBe(1);
  });

  it('promoteNext promotes in merit order with a fresh deadline', async () => {
    cycles.findById.mockResolvedValue({ id: 'cycle-1' });
    applications.findNextWaitlisted.mockResolvedValue([
      app('w1', 40, AdmissionApplicationStatus.WAITLISTED),
    ]);

    const promoted = await service.promoteNext('cycle-1', 'class-1', 1, actor);
    expect(promoted).toHaveLength(1);
    expect(applications.update).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({
        status: AdmissionApplicationStatus.SELECTED,
        admissionDeadline: expect.any(Date) as Date,
      }),
      expect.anything(),
    );
    expect(events.emit).toHaveBeenCalledTimes(1);
  });
});
