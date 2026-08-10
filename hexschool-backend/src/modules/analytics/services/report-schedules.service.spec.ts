import { BadRequestException } from '@nestjs/common';
import { ReportSchedulesService } from './report-schedules.service';

/**
 * The scheduler's three spec rules: §7's cron whitelist on write, §6's
 * retry-then-disable-with-a-reason, and §8's deleted owner.
 */

function build(overrides: { maxFailures?: number } = {}) {
  const repo = {
    findAllFor: jest.fn().mockResolvedValue([]),
    findByIdOrFail: jest.fn(),
    findDue: jest.fn().mockResolvedValue([]),
    findLive: jest.fn().mockResolvedValue([]),
    create: jest.fn((data: Record<string, unknown>) =>
      Promise.resolve({ id: 'sched-1', ...data }),
    ),
    update: jest.fn((id: string, data: Record<string, unknown>) =>
      Promise.resolve({ id, reportCode: 'fee.dues', ...data }),
    ),
    softDelete: jest.fn(),
    markStarted: jest.fn(),
    recordOutcome: jest.fn(),
    disableAll: jest.fn().mockResolvedValue(0),
  };
  const engine = {
    definitionOrThrow: jest.fn().mockReturnValue({
      code: 'fee.dues',
      name: 'Dues & aging',
      runnable: true,
      formats: ['XLSX', 'CSV'],
      params: [],
    }),
    enqueue: jest.fn().mockResolvedValue({ id: 'run-1' }),
    principalIsLive: jest.fn().mockResolvedValue(true),
  };
  const config = {
    load: jest
      .fn()
      .mockResolvedValue({ scheduleMaxFailures: overrides.maxFailures ?? 3 }),
  };
  const notifications = { send: jest.fn().mockResolvedValue({}) };
  const audit = { set: jest.fn() };

  const service = new ReportSchedulesService(
    repo as never,
    engine as never,
    config as never,
    notifications as never,
    audit as never,
  );
  return { service, repo, engine, notifications };
}

const recipients = { emails: ['head@school.test'] };

describe('the §7 cron whitelist, on write', () => {
  it('refuses a sub-hourly schedule at creation', async () => {
    const { service } = build();
    await expect(
      service.create(
        { reportCode: 'fee.dues', name: 'x', cron: '*/5 * * * *', recipients },
        's1',
        'u1',
      ),
    ).rejects.toThrow(/sub-hourly/);
  });

  it('refuses a schedule that can never fire', async () => {
    const { service } = build();
    await expect(
      service.create(
        { reportCode: 'fee.dues', name: 'x', cron: '0 9 30 2 *', recipients },
        's1',
        'u1',
      ),
    ).rejects.toThrow(/can never fire/);
  });

  it('stores a valid expression normalised, with its next run', async () => {
    const { service, repo } = build();
    await service.create(
      {
        reportCode: 'fee.dues',
        name: 'Monthly dues',
        cron: '0   7  1 * *',
        recipients,
      },
      's1',
      'u1',
    );
    const stored = repo.create.mock.calls[0][0];
    expect(stored.cron).toBe('0 7 1 * *');
    expect(stored.nextRunAt).toBeInstanceOf(Date);
    expect(stored.ownerId).toBe('u1');
  });

  it('refuses a schedule with nowhere to send the report', async () => {
    const { service } = build();
    await expect(
      service.create(
        { reportCode: 'fee.dues', name: 'x', cron: '0 7 * * *' },
        's1',
        'u1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to schedule a report that cannot be generated as a file', async () => {
    const { service, engine } = build();
    engine.definitionOrThrow.mockReturnValue({
      code: 'result.report-cards',
      name: 'Report cards',
      runnable: false,
      formats: ['PDF'],
      params: [],
    });
    await expect(
      service.create(
        {
          reportCode: 'result.report-cards',
          name: 'x',
          cron: '0 7 * * *',
          recipients,
        },
        's1',
        'u1',
      ),
    ).rejects.toThrow(/cannot be generated as a file/);
  });
});

describe('the sweep', () => {
  const due = {
    id: 'sched-1',
    schoolId: 's1',
    reportCode: 'fee.dues',
    name: 'Monthly dues',
    cron: '0 7 * * *',
    format: 'XLSX',
    params: {},
    ownerId: 'u1',
    failureCount: 0,
  };

  it('advances next_run_at BEFORE queuing, so a failure still moves on', async () => {
    const { service, repo, engine } = build();
    repo.findDue.mockResolvedValue([due]);
    engine.enqueue.mockRejectedValue(new Error('boom'));

    await service.runDue();

    expect(repo.markStarted).toHaveBeenCalledWith('sched-1', expect.any(Date));
    const markedAt = repo.markStarted.mock.invocationCallOrder[0];
    const queuedAt = engine.enqueue.mock.invocationCallOrder[0];
    expect(markedAt).toBeLessThan(queuedAt);
  });

  it('records success and resets the failure count', async () => {
    const { service, repo } = build();
    repo.findDue.mockResolvedValue([due]);
    const result = await service.runDue();
    expect(result).toEqual({ fired: 1, failed: 0 });
    expect(repo.recordOutcome).toHaveBeenCalledWith('sched-1', { ok: true });
  });

  it('does not disable on the first failure', async () => {
    const { service, repo, engine, notifications } = build();
    repo.findDue.mockResolvedValue([due]);
    engine.enqueue.mockRejectedValue(new Error('boom'));

    await service.runDue();

    expect(repo.recordOutcome).toHaveBeenCalledWith(
      'sched-1',
      expect.objectContaining({ ok: false, disable: false }),
    );
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('disables with a reason on the third, and tells the owner', async () => {
    const { service, repo, engine, notifications } = build();
    repo.findDue.mockResolvedValue([{ ...due, failureCount: 2 }]);
    engine.enqueue.mockRejectedValue(new Error('boom'));

    await service.runDue();

    const outcome = (repo.recordOutcome.mock.calls as unknown[][])[0][1] as {
      disable: boolean;
      reason: string;
    };
    expect(outcome.disable).toBe(true);
    // A schedule that silently stopped is worse than one that never was.
    expect(outcome.reason).toMatch(/3 consecutive failures/);
    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'REPORT_SCHEDULE_FAILED' }),
    );
  });

  it('keeps sweeping when notifying the owner fails', async () => {
    const { service, repo, engine, notifications } = build();
    repo.findDue.mockResolvedValue([{ ...due, failureCount: 2 }]);
    engine.enqueue.mockRejectedValue(new Error('boom'));
    notifications.send.mockRejectedValue(new Error('smtp down'));

    await expect(service.runDue()).resolves.toEqual({ fired: 0, failed: 1 });
  });
});

describe('roadmap §8 — a schedule whose owner has gone', () => {
  it('disables it with a reason rather than deleting it', async () => {
    const { service, repo, engine } = build();
    repo.findLive.mockResolvedValue([
      { id: 'a', ownerId: 'gone-user' },
      { id: 'b', ownerId: 'live-user' },
    ]);
    engine.principalIsLive.mockImplementation((id: string) =>
      Promise.resolve(id === 'live-user'),
    );
    repo.disableAll.mockResolvedValue(1);

    const count = await service.disableOrphanedSchedules();

    expect(count).toBe(1);
    expect(repo.disableAll).toHaveBeenCalledWith(
      ['a'],
      expect.stringContaining('no longer has an active account'),
    );
  });

  it('does nothing when every owner is live', async () => {
    const { service, repo } = build();
    repo.findLive.mockResolvedValue([{ id: 'a', ownerId: 'live-user' }]);
    expect(await service.disableOrphanedSchedules()).toBe(0);
    expect(repo.disableAll).not.toHaveBeenCalled();
  });

  it('does nothing when no schedule has an owner', async () => {
    const { service, repo } = build();
    repo.findLive.mockResolvedValue([{ id: 'a', ownerId: null }]);
    expect(await service.disableOrphanedSchedules()).toBe(0);
  });
});

describe('pausing and resuming', () => {
  const existing = {
    id: 'sched-1',
    schoolId: 's1',
    reportCode: 'fee.dues',
    cron: '0 7 * * *',
    params: {},
    status: 'ACTIVE',
  };

  it('clears next_run_at when paused, so it stops being overdue', async () => {
    const { service, repo } = build();
    repo.findByIdOrFail.mockResolvedValue(existing);
    await service.update('sched-1', { status: 'PAUSED' }, 's1', 'u1');
    const patch = repo.update.mock.calls[0][1];
    expect(patch.nextRunAt).toBeNull();
  });

  it('resets the failure count when re-enabled', async () => {
    const { service, repo } = build();
    repo.findByIdOrFail.mockResolvedValue({
      ...existing,
      status: 'DISABLED',
      failureCount: 3,
    });
    await service.update('sched-1', { status: 'ACTIVE' }, 's1', 'u1');
    const patch = repo.update.mock.calls[0][1];
    expect(patch.failureCount).toBe(0);
    expect(patch.disabledReason).toBeNull();
    expect(patch.nextRunAt).toBeInstanceOf(Date);
  });

  it('leaves the failure count alone on an ordinary edit', async () => {
    const { service, repo } = build();
    repo.findByIdOrFail.mockResolvedValue({ ...existing, failureCount: 2 });
    await service.update('sched-1', { name: 'Renamed' }, 's1', 'u1');
    const patch = repo.update.mock.calls[0][1];
    expect(patch).not.toHaveProperty('failureCount');
  });
});

describe('test-run', () => {
  it('is attributed to whoever pressed it, not to the schedule owner', async () => {
    const { service, repo, engine } = build();
    repo.findByIdOrFail.mockResolvedValue({
      id: 'sched-1',
      reportCode: 'fee.dues',
      format: 'XLSX',
      params: {},
      ownerId: 'the-principal',
    });

    await service.testRun('sched-1', 's1', 'the-clerk');

    // Otherwise pressing test on somebody else's payroll schedule would
    // be a way around `payroll.report`.
    expect(engine.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'the-clerk' }),
    );
  });
});
