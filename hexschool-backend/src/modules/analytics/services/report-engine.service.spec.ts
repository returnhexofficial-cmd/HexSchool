import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ReportEngineService } from './report-engine.service';
import type { ReportTable } from '../calc/types';

/**
 * The engine's authorisation and column-policy behaviour, mocked at the
 * boundaries — the project's service-spec style.
 *
 * The cases worth having are the ones `tsc` cannot see: that a scheduled
 * run is authorised at all (its principal never presents a token), that a
 * failing executor produces a FAILED row rather than a thrown job, and
 * that the column policy is applied on the way to the file and not only on
 * the way to the screen.
 */

const table = (): ReportTable => ({
  title: 'Payroll register',
  columns: [
    { key: 'name', label: 'Employee' },
    { key: 'net', label: 'Net pay', type: 'money', permission: 'payroll.view' },
  ],
  rows: [{ name: 'Rahim', net: 32000 }],
});

function build(overrides: {
  held?: string[];
  userType?: string;
  executor?: jest.Mock;
  maxRows?: number;
}) {
  const executor = overrides.executor ?? jest.fn().mockResolvedValue(table());

  const runs = {
    create: jest.fn().mockResolvedValue({ id: 'run-1' }),
    findById: jest.fn(),
    markRunning: jest.fn().mockResolvedValue(undefined),
    markDone: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  };
  const executors = {
    get: jest.fn().mockReturnValue(executor),
    has: jest.fn().mockReturnValue(true),
  };
  const renderer = {
    render: jest.fn().mockResolvedValue({
      buffer: Buffer.from('x'),
      filename: 'f.xlsx',
      contentType: 'application/vnd',
      rowCount: 1,
    }),
  };
  const permissions = {
    getUserPermissionCodes: jest
      .fn()
      .mockResolvedValue(overrides.held ?? ['payroll.report']),
  };
  const directory = {
    principal: jest.fn().mockResolvedValue({
      userType: overrides.userType ?? 'STAFF',
      schoolId: 'school-1',
      status: 'ACTIVE',
    }),
  };
  const storage = {
    upload: jest
      .fn()
      .mockResolvedValue({ key: 'k', bucket: 'b', url: 'https://u' }),
  };
  const schools = { findById: jest.fn().mockResolvedValue({ name: 'School' }) };
  const config = {
    load: jest.fn().mockResolvedValue({
      retentionDays: 30,
      maxRows: overrides.maxRows ?? 50_000,
    }),
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };

  const service = new ReportEngineService(
    runs as never,
    executors as never,
    renderer as never,
    permissions as never,
    directory as never,
    storage as never,
    schools as never,
    config as never,
    queue as never,
  );
  return { service, runs, executor, renderer, queue, permissions, directory };
}

describe('ReportEngineService.enqueue', () => {
  it('refuses a report whose permission the caller does not hold', async () => {
    const { service, queue } = build({ held: [] });
    await expect(
      service.enqueue({
        code: 'payroll.register',
        schoolId: 's1',
        actorId: 'u1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('queues a run and never renders in the request', async () => {
    const { service, queue, renderer } = build({});
    const run = await service.enqueue({
      code: 'payroll.register',
      schoolId: 's1',
      actorId: 'u1',
    });
    expect(run.id).toBe('run-1');
    expect(queue.add).toHaveBeenCalledWith(
      'run-report',
      { runId: 'run-1', schoolId: 's1' },
      expect.any(Object),
    );
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('refuses a format the report does not offer', async () => {
    const { service } = build({});
    await expect(
      service.enqueue({
        code: 'payroll.register',
        schoolId: 's1',
        actorId: 'u1',
        format: 'JSON',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a report that has no generator', async () => {
    const { service } = build({ held: ['result.export'] });
    await expect(
      service.enqueue({
        code: 'result.report-cards',
        schoolId: 's1',
        actorId: 'u1',
      }),
    ).rejects.toThrow(/cannot be generated as a file/);
  });

  it('reports every bad parameter at once', async () => {
    const { service } = build({ held: ['accounting.report'] });
    await expect(
      service.enqueue({
        code: 'accounting.ledger',
        schoolId: 's1',
        actorId: 'u1',
        params: { accountId: 'not-a-uuid' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an unknown report code', async () => {
    const { service } = build({});
    await expect(
      service.enqueue({ code: 'nope.nothing', schoolId: 's1', actorId: 'u1' }),
    ).rejects.toThrow(/not found/);
  });
});

describe('ReportEngineService.produce — the column policy', () => {
  it('strips a column the requester may not see', async () => {
    const { service, renderer } = build({ held: ['payroll.report'] });
    const result = await service.produce({
      code: 'payroll.register',
      schoolId: 's1',
      actorId: 'u1',
    });
    expect(result.stripped).toEqual(['Net pay']);
    expect(result.table.columns.map((c) => c.key)).toEqual(['name']);
    // The FILE is rendered from the stripped table, not the raw one.
    const rendered = (
      renderer.render.mock.calls as unknown[][]
    )[0][0] as ReportTable;
    expect(rendered.columns.map((c) => c.key)).toEqual(['name']);
  });

  it('keeps the column when the data permission is held', async () => {
    const { service } = build({ held: ['payroll.report', 'payroll.view'] });
    const result = await service.produce({
      code: 'payroll.register',
      schoolId: 's1',
      actorId: 'u1',
    });
    expect(result.stripped).toEqual([]);
    expect(result.table.columns).toHaveLength(2);
  });

  it('gives a super admin every column without listing the codes', async () => {
    const { service } = build({ held: [], userType: 'SUPER_ADMIN' });
    const result = await service.produce({
      code: 'payroll.register',
      schoolId: 's1',
      actorId: 'u1',
    });
    expect(result.stripped).toEqual([]);
  });

  it('refuses a report that blew the row cap rather than truncating it', async () => {
    const big = jest.fn().mockResolvedValue({
      ...table(),
      rows: Array.from({ length: 20 }, () => ({ name: 'x', net: 1 })),
    });
    const { service } = build({ executor: big, maxRows: 10 });
    await expect(
      service.produce({
        code: 'payroll.register',
        schoolId: 's1',
        actorId: 'u1',
      }),
    ).rejects.toThrow(/over the 10-row limit/);
  });
});

describe('ReportEngineService.execute — the worker path', () => {
  const queued = {
    id: 'run-1',
    schoolId: 's1',
    reportCode: 'payroll.register',
    format: 'XLSX' as const,
    params: {},
    requestedBy: 'u1',
    status: 'QUEUED' as const,
  };

  it('records the file, the row count and the stripped columns', async () => {
    const { service, runs } = build({ held: ['payroll.report'] });
    runs.findById.mockResolvedValue(queued);

    await service.execute('run-1');

    expect(runs.markRunning).toHaveBeenCalledWith('run-1');
    expect(runs.markDone).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        fileKey: 'k',
        rowCount: 1,
        strippedColumns: ['Net pay'],
      }),
    );
  });

  it('authorises a scheduled run against its stored principal', async () => {
    // The whole point: no token, no guard, no route — the engine is the
    // only authorisation a scheduled run ever gets.
    const { service, runs } = build({ held: [] });
    runs.findById.mockResolvedValue(queued);

    await service.execute('run-1');

    expect(runs.markDone).not.toHaveBeenCalled();
    expect(runs.markFailed).toHaveBeenCalledWith(
      'run-1',
      expect.stringContaining('payroll.report'),
    );
  });

  it('writes a failure to the row instead of throwing at the queue', async () => {
    const boom = jest.fn().mockRejectedValue(new Error('the report exploded'));
    const { service, runs } = build({ executor: boom });
    runs.findById.mockResolvedValue(queued);

    await expect(service.execute('run-1')).resolves.toBeUndefined();
    expect(runs.markFailed).toHaveBeenCalledWith(
      'run-1',
      'the report exploded',
    );
  });

  it('skips a run that is no longer QUEUED — a retried job', async () => {
    const { service, runs } = build({});
    runs.findById.mockResolvedValue({ ...queued, status: 'DONE' });

    await service.execute('run-1');

    expect(runs.markRunning).not.toHaveBeenCalled();
    expect(runs.markDone).not.toHaveBeenCalled();
  });

  it('tolerates a run row that has vanished', async () => {
    const { service, runs } = build({});
    runs.findById.mockResolvedValue(null);
    await expect(service.execute('gone')).resolves.toBeUndefined();
  });
});

describe('ReportEngineService.principalIsLive', () => {
  it('is false for a deactivated owner (roadmap §8)', async () => {
    const { service, directory } = build({});
    directory.principal.mockResolvedValue({
      userType: 'STAFF',
      schoolId: 's1',
      status: 'INACTIVE',
    });
    expect(await service.principalIsLive('u1')).toBe(false);
  });

  it('is false for an owner who no longer exists', async () => {
    const { service, directory } = build({});
    directory.principal.mockResolvedValue(null);
    expect(await service.principalIsLive('u1')).toBe(false);
  });

  it('is true for a live account', async () => {
    const { service } = build({});
    expect(await service.principalIsLive('u1')).toBe(true);
  });
});
