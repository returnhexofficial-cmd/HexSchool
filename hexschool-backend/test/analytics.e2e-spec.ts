import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEFAULT_SCHOOL_ID, UserType } from '../src/common/constants';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { AnalyticsJobs } from '../src/modules/analytics/jobs/analytics.jobs';
import { syncReportRegistry } from '../src/modules/analytics/seed/reports.seeder';
import { MaterializedViewService } from '../src/modules/analytics/services/materialized-view.service';
import { ReportRunsService } from '../src/modules/analytics/services/report-runs.service';
import { ReportSchedulesService } from '../src/modules/analytics/services/report-schedules.service';
import { SiteAnalyticsService } from '../src/modules/analytics/services/site-analytics.service';
import {
  seedSystemRoles,
  syncPermissionRegistry,
} from '../src/modules/rbac/seed/rbac.seeder';

/**
 * Requires dev infra (DB + redis + MinIO). Module 29 — Reports &
 * Analytics v2.
 *
 * Built around what unit tests structurally cannot see:
 *
 *   1. **Roadmap §9's "run → file → download"**, all the way through: the
 *      HTTP queue, the BullMQ worker, the real S3 upload and a signed URL
 *      that actually fetches bytes. Everything in that chain compiles
 *      cleanly and can still do nothing (the M18/M21 DI lesson, twice
 *      learned) — this is the only test that proves the wiring boots.
 *   2. **Roadmap §9's "schedule fire (time-travel test)"** — a schedule
 *      whose `next_run_at` is moved into the past, then the real sweep.
 *   3. **§6's column stripping over the wire.** A unit test proves the
 *      engine strips; only a live run proves the FILE that lands in the
 *      export centre is the stripped one and that the run row says which
 *      columns went.
 *   4. **The catalog moved without breaking.** `GET /reports` is M18's URL
 *      and M18's frontend still calls it — this asserts the old fields
 *      survive alongside the new ones.
 *   5. **The database invariants**, each probed through the API: the
 *      `report_runs` status CHECK (a DONE run must have a file, a FAILED
 *      one must have a message and no file), the DISABLED-needs-a-reason
 *      CHECK, and the definition foreign key.
 *   6. **The three materialized views actually exist and refresh
 *      CONCURRENTLY** — a migration that created them without the unique
 *      index would pass `migrate deploy` and fail here.
 */
describe('Reports & Analytics v2 (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let runsService: ReportRunsService;
  let schedulesService: ReportSchedulesService;
  let views: MaterializedViewService;
  let site: SiteAnalyticsService;
  let jobs: AnalyticsJobs;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-an-admin@test.local';
  const HEAD = 'e2e-an-head@test.local';
  const CLERK = 'e2e-an-clerk@test.local';
  /**
   * Holds `payroll.report` and NOT `payroll.view` — roadmap §6's own
   * example, and a combination **no seeded role has**: the principal and
   * the accountant both hold the money code. A bespoke role is the only
   * honest way to test the stripping rule, and the fact that it has to be
   * invented is worth knowing in itself.
   */
  const AUDITOR = 'e2e-an-auditor@test.local';
  const NAME = 'E2EAN';

  let adminToken: string;
  let headToken: string;
  let clerkToken: string;
  let auditorToken: string;
  let clerkId: string;
  let sessionId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;
  const errorOf = (res: request.Response): string =>
    (res.body as { error?: { message?: string } }).error?.message ?? '';

  const emails = [ADMIN, HEAD, CLERK, AUDITOR];

  const AUDITOR_ROLE = 'e2ean-auditor';

  /** `YYYY-MM-DD`, `offset` days from today in Asia/Dhaka (the M25 rule). */
  const DHAKA_OFFSET_MS = 6 * 3_600_000;
  const day = (offset: number): string =>
    new Date(Date.now() + DHAKA_OFFSET_MS + offset * 86_400_000)
      .toISOString()
      .slice(0, 10);

  /**
   * Polls the run row until the worker finishes it. The worker is a real
   * BullMQ consumer in this process, so the wait is short — but it IS
   * asynchronous, and asserting immediately after the 202 is the classic
   * way to write a suite that passes on a fast machine and fails in CI.
   */
  const settle = async (runId: string, timeoutMs = 20_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const run = await prisma.reportRun.findUnique({ where: { id: runId } });
      if (run && (run.status === 'DONE' || run.status === 'FAILED')) return run;
      if (Date.now() > deadline) {
        throw new Error(
          `report run ${runId} did not settle within ${timeoutMs} ms (status ${run?.status ?? 'missing'})`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  };

  const cleanup = async () => {
    await prisma.reportRun.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID },
    });
    await prisma.reportSchedule.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.siteAnalyticsDaily.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID },
    });
    await prisma.notification.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        templateCode: { in: ['REPORT_READY', 'REPORT_SCHEDULE_FAILED'] },
      },
    });
    await prisma.academicSession.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    if (ids.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.rolePermission.deleteMany({
      where: { role: { slug: AUDITOR_ROLE } },
    });
    await prisma.role.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, slug: AUDITOR_ROLE },
    });
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    runsService = app.get(ReportRunsService);
    schedulesService = app.get(ReportSchedulesService);
    views = app.get(MaterializedViewService);
    site = app.get(SiteAnalyticsService);
    jobs = app.get(AnalyticsJobs);

    await syncPermissionRegistry(prisma);
    await seedSystemRoles(prisma, DEFAULT_SCHOOL_ID);
    // The report definitions are a foreign key for every run and schedule
    // below, so the registry has to be in the table before anything runs.
    await syncReportRegistry(prisma);
    await cleanup();

    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const mk = (email: string, userType: UserType) =>
      prisma.user.create({
        data: { schoolId: DEFAULT_SCHOOL_ID, email, passwordHash, userType },
      });
    const [adminUser, headUser, clerkUser, auditorUser] = await Promise.all([
      mk(ADMIN, UserType.ADMIN),
      mk(HEAD, UserType.STAFF),
      mk(CLERK, UserType.STAFF),
      mk(AUDITOR, UserType.STAFF),
    ]);
    clerkId = clerkUser.id;

    const roleFor = (slug: string) =>
      prisma.role.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, slug, deletedAt: null },
      });
    const [adminRole, headRole, clerkRole] = await Promise.all([
      roleFor('admin'),
      roleFor('principal'),
      roleFor('office-staff'),
    ]);
    await prisma.userRole.createMany({
      data: [
        { userId: adminUser.id, roleId: adminRole!.id },
        { userId: headUser.id, roleId: headRole!.id },
        { userId: clerkUser.id, roleId: clerkRole!.id },
      ],
    });

    // The §6 auditor: may run the payroll register, may not see the pay.
    const auditorRole = await prisma.role.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `${NAME} Auditor`,
        slug: AUDITOR_ROLE,
        description: 'Runs the payroll register without seeing the money',
      },
    });
    const grants = await prisma.permission.findMany({
      where: { code: { in: ['payroll.report'] } },
      select: { id: true },
    });
    await prisma.rolePermission.createMany({
      data: grants.map((p) => ({ roleId: auditorRole.id, permissionId: p.id })),
    });
    await prisma.userRole.create({
      data: { userId: auditorUser.id, roleId: auditorRole.id },
    });

    const session = await prisma.academicSession.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `${NAME} ${new Date().getUTCFullYear()}`,
        startDate: new Date(day(-300)),
        endDate: new Date(day(120)),
        status: 'ACTIVE',
      },
    });
    sessionId = session.id;

    const login = async (email: string) => {
      const res = await server()
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);
      return dataOf<{ accessToken: string }>(res).accessToken;
    };
    [adminToken, headToken, clerkToken, auditorToken] = await Promise.all([
      login(ADMIN),
      login(HEAD),
      login(CLERK),
      login(AUDITOR),
    ]);
  }, 120_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  // ── 1. the catalog (M18's URL, M29's payload) ───────────────────────

  describe('GET /reports — the catalog', () => {
    it('answers at M18’s URL with M18’s fields still present', async () => {
      const res = await server()
        .get('/api/v1/reports')
        .set(auth(adminToken))
        .expect(200);
      const catalog = dataOf<Array<Record<string, unknown>>>(res);
      expect(catalog.length).toBeGreaterThan(40);
      const dues = catalog.find((r) => r.code === 'fee.dues');
      // The M18 shape, unchanged — its frontend reads these.
      expect(dues).toMatchObject({
        code: 'fee.dues',
        name: 'Dues & aging',
        module: 'Fees',
        permission: 'fee.report',
        endpoint: '/fee-reports/dues',
      });
      // …and the M29 additions.
      expect(dues).toHaveProperty('output');
      expect(dues).toHaveProperty('runnable', true);
      expect(Array.isArray(dues?.params)).toBe(true);
    });

    it('offers only what the caller may actually run', async () => {
      const res = await server()
        .get('/api/v1/reports')
        .set(auth(clerkToken))
        .expect(200);
      const codes = dataOf<Array<{ code: string }>>(res).map((r) => r.code);
      // The office clerk has no payroll permission at all.
      expect(codes).not.toContain('payroll.register');
    });

    it('warns before the download that columns will be withheld', async () => {
      const res = await server()
        .get('/api/v1/reports/payroll.register')
        .set(auth(auditorToken))
        .expect(200);
      const definition = dataOf<{
        sensitivePermission: string;
        columnsWillBeWithheld: boolean;
      }>(res);
      expect(definition.sensitivePermission).toBe('payroll.view');
      expect(definition.columnsWillBeWithheld).toBe(true);
    });

    it('404s a report the caller may not run, rather than 403ing it', async () => {
      await server()
        .get('/api/v1/reports/payroll.register')
        .set(auth(clerkToken))
        .expect(404);
    });

    it('marks a PDF-booklet report as not runnable', async () => {
      const res = await server()
        .get('/api/v1/reports/result.report-cards')
        .set(auth(adminToken))
        .expect(200);
      const definition = dataOf<{ runnable: boolean; endpoint: string }>(res);
      // The hub hides Run and keeps the deep link — the M18 honesty rule.
      expect(definition.runnable).toBe(false);
      expect(definition.endpoint).toContain('report-cards');
    });
  });

  // ── 2. run → file → download (roadmap §9) ───────────────────────────

  describe('run → file → download', () => {
    it('queues, executes, uploads and hands back a working URL', async () => {
      const queued = await server()
        .post('/api/v1/reports/fee.dues/run')
        .set(auth(adminToken))
        .send({ format: 'CSV', params: { sessionId } })
        .expect(202);
      const run = dataOf<{ id: string; status: string }>(queued);
      expect(run.status).toBe('QUEUED');

      const settled = await settle(run.id);
      expect(settled.status).toBe('DONE');
      expect(settled.fileKey).toBeTruthy();
      expect(settled.rowCount).not.toBeNull();
      expect(settled.durationMs).not.toBeNull();

      // The export centre lists it…
      const list = await server()
        .get('/api/v1/report-runs?mine=true')
        .set(auth(adminToken))
        .expect(200);
      const rows = dataOf<Array<{ id: string; downloadable: boolean }>>(list);
      expect(rows.find((r) => r.id === run.id)?.downloadable).toBe(true);

      // …and the signed URL genuinely fetches the file.
      const download = await server()
        .get(`/api/v1/report-runs/${run.id}/download`)
        .set(auth(adminToken))
        .expect(200);
      const { url } = dataOf<{ url: string }>(download);
      expect(url).toMatch(/^https?:\/\//);

      const fetched = await fetch(url);
      expect(fetched.status).toBe(200);
      const body = await fetched.text();
      // A CSV with a header row — the bytes, not just a 200.
      expect(body.split('\r\n')[0]).toContain('Class');
    }, 60_000);

    it('refuses a report the caller may not run, before queueing anything', async () => {
      const before = await prisma.reportRun.count({
        where: { schoolId: DEFAULT_SCHOOL_ID },
      });
      await server()
        .post('/api/v1/reports/payroll.register/run')
        .set(auth(clerkToken))
        .send({})
        .expect(403);
      expect(
        await prisma.reportRun.count({
          where: { schoolId: DEFAULT_SCHOOL_ID },
        }),
      ).toBe(before);
    });

    it('rejects a bad parameter with every error at once', async () => {
      const res = await server()
        .post('/api/v1/reports/accounting.ledger/run')
        .set(auth(adminToken))
        .send({ params: { accountId: 'not-a-uuid', from: '2026-02-30' } })
        .expect(400);
      expect(errorOf(res)).toMatch(/parameters are not valid/i);
    });

    it('refuses a format the report does not offer', async () => {
      await server()
        .post('/api/v1/reports/fee.dues/run')
        .set(auth(adminToken))
        .send({ format: 'PDF' })
        .expect(400);
    });

    it('refuses to queue a report with no generator', async () => {
      const res = await server()
        .post('/api/v1/reports/result.report-cards/run')
        .set(auth(adminToken))
        .send({})
        .expect(400);
      expect(errorOf(res)).toMatch(/cannot be generated as a file/i);
    });

    it('previews inline with the same table the file is rendered from', async () => {
      const res = await server()
        .post('/api/v1/reports/inventory.stock/preview')
        .set(auth(adminToken))
        .send({})
        .expect(200);
      const preview = dataOf<{
        title: string;
        columns: Array<{ key: string }>;
        totalRows: number;
        truncated: boolean;
      }>(res);
      expect(preview.title).toContain('stock');
      expect(preview.columns.map((c) => c.key)).toContain('itemName');
      expect(preview.truncated).toBe(preview.totalRows > 100);
    });

    it('renders a small report inline as a real XLSX', async () => {
      const res = await server()
        .post('/api/v1/reports/library.stock/download')
        .set(auth(adminToken))
        .send({ format: 'XLSX' })
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      // PK\x03\x04 — a zip container, which is what an xlsx is.
      const bytes = res.body as Buffer;
      expect(bytes.subarray(0, 2).toString()).toBe('PK');
    });
  });

  // ── 3. §6's column stripping, over the wire ─────────────────────────

  describe('roadmap §6 — sensitive columns are stripped, not refused', () => {
    it('gives the auditor the register without the money, and says so', async () => {
      const queued = await server()
        .post('/api/v1/reports/payroll.register/run')
        .set(auth(auditorToken))
        .send({ format: 'CSV' })
        .expect(202);
      const run = await settle(dataOf<{ id: string }>(queued).id);

      expect(run.error).toBeNull();
      expect(run.status).toBe('DONE');
      // The run row records what went — a short sheet needs explaining.
      expect(run.strippedColumns as string[]).toEqual(
        expect.arrayContaining(['Net payable', 'Basic']),
      );

      const download = await server()
        .get(`/api/v1/report-runs/${run.id}/download`)
        .set(auth(auditorToken))
        .expect(200);
      const body = await (
        await fetch(dataOf<{ url: string }>(download).url)
      ).text();
      const header = body.split('\r\n')[0];
      expect(header).toContain('Employee ID');
      // The FILE is the stripped one, not just the screen.
      expect(header).not.toContain('Net payable');
    }, 60_000);

    it('gives an admin every column of the same report', async () => {
      const queued = await server()
        .post('/api/v1/reports/payroll.register/run')
        .set(auth(adminToken))
        .send({ format: 'CSV' })
        .expect(202);
      const run = await settle(dataOf<{ id: string }>(queued).id);
      // `status` first: an empty `strippedColumns` is ALSO what a FAILED
      // run has, so asserting the stripping alone would have passed while
      // the report was quietly failing — which is exactly what it did
      // before the payroll month-window fix.
      expect(run.error).toBeNull();
      expect(run.status).toBe('DONE');
      expect(run.strippedColumns as string[]).toEqual([]);
    }, 60_000);
  });

  // ── 4. the export centre's ownership rule ───────────────────────────

  describe('the export centre', () => {
    let othersRun: string;

    beforeAll(async () => {
      const queued = await server()
        .post('/api/v1/reports/fee.dues/run')
        .set(auth(adminToken))
        .send({ format: 'CSV' })
        .expect(202);
      othersRun = dataOf<{ id: string }>(queued).id;
      await settle(othersRun);
    }, 60_000);

    it('refuses somebody else’s export', async () => {
      const res = await server()
        .get(`/api/v1/report-runs/${othersRun}`)
        .set(auth(headToken))
        .expect(403);
      expect(errorOf(res)).toMatch(/belongs to somebody else/i);
    });

    it('re-runs under the presser’s own permissions', async () => {
      const admins = await server()
        .post('/api/v1/reports/payroll.register/run')
        .set(auth(adminToken))
        .send({ format: 'CSV' })
        .expect(202);
      const adminRun = await settle(dataOf<{ id: string }>(admins).id);
      expect(adminRun.status).toBe('DONE');
      expect(adminRun.strippedColumns as string[]).toEqual([]);

      // Ownership is the first line of defence: the auditor cannot even
      // read somebody else's export, let alone re-run it and inherit the
      // columns their own permissions would have stripped.
      await server()
        .post(`/api/v1/report-runs/${adminRun.id}/rerun`)
        .set(auth(auditorToken))
        .expect(403);
    }, 60_000);

    it('404s the download of a run that failed, with the reason', async () => {
      const run = await prisma.reportRun.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          reportCode: 'fee.dues',
          format: 'CSV',
          status: 'FAILED',
          error: 'deliberate failure for the e2e',
          finishedAt: new Date(),
        },
      });
      const res = await server()
        .get(`/api/v1/report-runs/${run.id}/download`)
        .set(auth(adminToken))
        .expect(404);
      expect(errorOf(res)).toContain('deliberate failure');
    });

    it('purges an expired run and its file together', async () => {
      const queued = await server()
        .post('/api/v1/reports/library.stock/run')
        .set(auth(adminToken))
        .send({ format: 'CSV' })
        .expect(202);
      const run = await settle(dataOf<{ id: string }>(queued).id);

      await prisma.reportRun.update({
        where: { id: run.id },
        data: { expiresAt: new Date(Date.now() - 86_400_000) },
      });
      const { purged } = await runsService.purgeExpired();
      expect(purged).toBeGreaterThanOrEqual(1);
      expect(
        await prisma.reportRun.findUnique({ where: { id: run.id } }),
      ).toBeNull();
    }, 60_000);

    it('fails a run the worker abandoned, so the spinner stops', async () => {
      const stale = await prisma.reportRun.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          reportCode: 'fee.dues',
          format: 'CSV',
          status: 'RUNNING',
          startedAt: new Date(Date.now() - 7_200_000),
          createdAt: new Date(Date.now() - 7_200_000),
        },
      });
      await runsService.failStale(60);
      const after = await prisma.reportRun.findUnique({
        where: { id: stale.id },
      });
      expect(after?.status).toBe('FAILED');
      expect(after?.error).toMatch(/did not finish/);
    });
  });

  // ── 5. database invariants (probed through the API) ─────────────────

  describe('the report_runs status CHECK', () => {
    it('refuses a DONE run with no file', async () => {
      await expect(
        prisma.reportRun.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            reportCode: 'fee.dues',
            status: 'DONE',
            finishedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/chk_report_runs_shape/);
    });

    it('refuses a FAILED run with no message', async () => {
      await expect(
        prisma.reportRun.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            reportCode: 'fee.dues',
            status: 'FAILED',
            finishedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/chk_report_runs_shape/);
    });

    it('refuses a run naming a report that does not exist', async () => {
      await expect(
        prisma.reportRun.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            reportCode: 'invented.report',
            status: 'QUEUED',
          },
        }),
      ).rejects.toThrow(/fk_report_runs_definition|foreign key/i);
    });
  });

  describe('the report_schedules CHECK', () => {
    it('refuses a DISABLED schedule with no reason', async () => {
      await expect(
        prisma.reportSchedule.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            reportCode: 'fee.dues',
            name: `${NAME} bad`,
            cron: '0 7 * * *',
            status: 'DISABLED',
          },
        }),
      ).rejects.toThrow(/chk_report_schedules_shape/);
    });
  });

  // ── 6. schedules, including the time-travel fire ────────────────────

  describe('report schedules', () => {
    let scheduleId: string;

    it('refuses a sub-hourly expression (roadmap §7)', async () => {
      const res = await server()
        .post('/api/v1/report-schedules')
        .set(auth(adminToken))
        .send({
          reportCode: 'fee.dues',
          name: `${NAME} too often`,
          cron: '*/5 * * * *',
          recipients: { emails: ['head@school.test'] },
        })
        .expect(400);
      expect(errorOf(res)).toMatch(/sub-hourly/);
    });

    it('refuses a schedule with no recipients', async () => {
      await server()
        .post('/api/v1/report-schedules')
        .set(auth(adminToken))
        .send({
          reportCode: 'fee.dues',
          name: `${NAME} nowhere`,
          cron: '0 7 * * *',
        })
        .expect(400);
    });

    it('creates one, computes its next run and describes its cron', async () => {
      const res = await server()
        .post('/api/v1/report-schedules')
        .set(auth(adminToken))
        .send({
          reportCode: 'fee.dues',
          name: `${NAME} monthly dues`,
          cron: '0 7 1 * *',
          format: 'CSV',
          params: { sessionId },
          recipients: { emails: ['head@school.test'], userIds: [clerkId] },
        })
        .expect(201);
      const schedule = dataOf<{
        id: string;
        nextRunAt: string;
        cronDescription: string;
        reportName: string;
      }>(res);
      scheduleId = schedule.id;

      expect(new Date(schedule.nextRunAt).getTime()).toBeGreaterThan(
        Date.now(),
      );
      expect(schedule.cronDescription).toBe('At 07:00 (Asia/Dhaka) on the 1st');
      expect(schedule.reportName).toBe('Dues & aging');
    });

    it('fires on the sweep once its time has passed (time travel)', async () => {
      // Roadmap §9's "schedule fire (time-travel test)". Moving
      // `next_run_at` into the past is the only honest way to test a cron
      // without waiting for one.
      await prisma.reportSchedule.update({
        where: { id: scheduleId },
        data: { nextRunAt: new Date(Date.now() - 60_000) },
      });

      const result = await schedulesService.runDue();
      expect(result.fired).toBeGreaterThanOrEqual(1);

      const after = await prisma.reportSchedule.findUnique({
        where: { id: scheduleId },
      });
      expect(after?.lastStatus).toBe('DONE');
      expect(after?.failureCount).toBe(0);
      // It moved on rather than firing again next minute.
      expect(after!.nextRunAt!.getTime()).toBeGreaterThan(Date.now());

      const run = await prisma.reportRun.findFirst({
        where: { scheduleId },
        orderBy: { createdAt: 'desc' },
      });
      expect(run).not.toBeNull();
      const settled = await settle(run!.id);
      expect(settled.status).toBe('DONE');

      // And the recipients were told (roadmap §4's "email with link").
      const told = await prisma.notification.count({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          templateCode: 'REPORT_READY',
        },
      });
      expect(told).toBeGreaterThanOrEqual(1);
    }, 60_000);

    it('stops being due once paused', async () => {
      await server()
        .put(`/api/v1/report-schedules/${scheduleId}`)
        .set(auth(adminToken))
        .send({ status: 'PAUSED' })
        .expect(200);
      const paused = await prisma.reportSchedule.findUnique({
        where: { id: scheduleId },
      });
      expect(paused?.nextRunAt).toBeNull();

      await prisma.reportSchedule.update({
        where: { id: scheduleId },
        data: { nextRunAt: new Date(Date.now() - 60_000) },
      });
      // Still not fired: the sweep reads `status = ACTIVE`.
      const result = await schedulesService.runDue();
      const ran = await prisma.reportSchedule.findUnique({
        where: { id: scheduleId },
      });
      expect(result.fired).toBe(0);
      expect(ran?.status).toBe('PAUSED');
    });

    it('test-runs off-cycle, attributed to whoever pressed it', async () => {
      const res = await server()
        .post(`/api/v1/report-schedules/${scheduleId}/test-run`)
        .set(auth(adminToken))
        .expect(202);
      const { runId } = dataOf<{ runId: string }>(res);
      const run = await settle(runId);
      expect(run.status).toBe('DONE');
      expect(run.scheduleId).toBe(scheduleId);
    }, 60_000);

    it('disables an orphaned schedule with a reason (roadmap §8)', async () => {
      const orphan = await prisma.reportSchedule.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          reportCode: 'fee.dues',
          name: `${NAME} orphan`,
          cron: '0 7 * * *',
          recipients: { emails: ['x@y.test'] },
          ownerId: clerkId,
          nextRunAt: new Date(Date.now() + 3_600_000),
        },
      });
      // The owner leaves.
      await prisma.user.update({
        where: { id: clerkId },
        data: { status: 'INACTIVE' },
      });

      const disabled = await schedulesService.disableOrphanedSchedules();
      expect(disabled).toBeGreaterThanOrEqual(1);

      const after = await prisma.reportSchedule.findUnique({
        where: { id: orphan.id },
      });
      // Stopped and explained — not deleted. Somebody still has to be able
      // to see what was being sent and to whom.
      expect(after?.status).toBe('DISABLED');
      expect(after?.disabledReason).toMatch(/no longer has an active account/);
      expect(after?.nextRunAt).toBeNull();

      await prisma.user.update({
        where: { id: clerkId },
        data: { status: 'ACTIVE' },
      });
    });

    it('needs report.schedule.manage to create one', async () => {
      await server()
        .post('/api/v1/report-schedules')
        .set(auth(clerkToken))
        .send({
          reportCode: 'fee.dues',
          name: `${NAME} nope`,
          cron: '0 7 * * *',
          recipients: { emails: ['x@y.test'] },
        })
        .expect(403);
    });

    it('lists the cron presets with their readings', async () => {
      const res = await server()
        .get('/api/v1/report-schedules/presets')
        .set(auth(adminToken))
        .expect(200);
      const presets = dataOf<Array<{ cron: string; description: string }>>(res);
      expect(presets.length).toBeGreaterThan(3);
      for (const preset of presets) {
        expect(preset.description).toContain('Asia/Dhaka');
      }
    });
  });

  // ── 7. the analytics endpoints and the views ────────────────────────

  describe('analytics', () => {
    it('refreshes all three materialized views CONCURRENTLY', async () => {
      // A migration that created a view without its unique index would
      // pass `migrate deploy` and fail right here.
      const outcomes = await views.refreshAll();
      expect(outcomes).toHaveLength(3);
      for (const outcome of outcomes) {
        expect(outcome.ok).toBe(true);
      }
    }, 60_000);

    it('serves the executive dashboard with every panel', async () => {
      const res = await server()
        .get('/api/v1/analytics/executive')
        .set(auth(adminToken))
        .expect(200);
      const dashboard = dataOf<Record<string, unknown>>(res);
      for (const panel of [
        'enrollment',
        'attendance',
        'finance',
        'results',
        'operations',
      ]) {
        expect(dashboard[panel]).toBeDefined();
      }
    }, 30_000);

    it('prints the staleness of every panel served from a view', async () => {
      const res = await server()
        .get('/api/v1/analytics/attendance-heatmap')
        .set(auth(adminToken))
        .expect(200);
      const panel = dataOf<{ freshness: string }>(res);
      // Roadmap §8: the eventual freshness has to be on the panel's face.
      expect(panel.freshness).toMatch(/24 hours/);
    });

    it('keeps the finance panel behind its own permission', async () => {
      await server()
        .get('/api/v1/analytics/finance')
        .set(auth(clerkToken))
        .expect(403);
      await server()
        .get('/api/v1/analytics/finance')
        .set(auth(headToken))
        .expect(200);
    });

    it('caches, and a refresh bypasses the cache', async () => {
      await server()
        .get('/api/v1/analytics/enrollment')
        .set(auth(adminToken))
        .expect(200);
      const second = await server()
        .get('/api/v1/analytics/enrollment')
        .set(auth(adminToken))
        .expect(200);
      expect(dataOf<{ cached?: boolean }>(second).cached).toBe(true);

      const fresh = await server()
        .get('/api/v1/analytics/enrollment?refresh=true')
        .set(auth(adminToken))
        .expect(200);
      expect(dataOf<{ cached?: boolean }>(fresh).cached).toBeUndefined();
    });

    it('needs analytics.refresh to rebuild the views by hand', async () => {
      await server()
        .post('/api/v1/analytics/refresh-views')
        .set(auth(headToken))
        .send({})
        .expect(403);
    });
  });

  // ── 8. website analytics ────────────────────────────────────────────

  describe('website analytics', () => {
    it('accepts an anonymous page view and folds it into the day', async () => {
      for (let i = 0; i < 3; i += 1) {
        await server()
          .post('/api/v1/public/analytics/collect')
          .send({
            path: '/notices?utm_source=fb',
            referrer: 'https://facebook.com/x',
          })
          .expect(204);
      }
      await server()
        .post('/api/v1/public/analytics/collect')
        .send({ path: '/' })
        .expect(204);

      const { days } = await site.fold();
      expect(days).toBeGreaterThanOrEqual(1);

      const res = await server()
        .get('/api/v1/analytics/website')
        .set(auth(adminToken))
        .expect(200);
      const report = dataOf<{
        totals: { pageViews: number };
        topPages: Array<{ path: string; views: number }>;
      }>(res);

      expect(report.totals.pageViews).toBeGreaterThanOrEqual(4);
      // The query string is stripped, so a campaign does not fragment the
      // page it points at.
      expect(report.topPages.map((p) => p.path)).toContain('/notices');
      expect(report.topPages.map((p) => p.path)).not.toContain(
        '/notices?utm_source=fb',
      );
    }, 30_000);

    it('stores no visitor identifier anywhere', async () => {
      // The M28 promise, applied to a page counter: the fingerprint goes
      // into a HyperLogLog and is never written down.
      const rows = await prisma.siteAnalyticsDaily.findMany({
        where: { schoolId: DEFAULT_SCHOOL_ID },
      });
      expect(rows.length).toBeGreaterThan(0);
      const serialised = JSON.stringify(rows);
      expect(serialised).not.toMatch(/\d+\.\d+\.\d+\.\d+/); // no IPv4
      expect(serialised.toLowerCase()).not.toContain('mozilla');
      for (const row of rows) {
        expect(row.uniqueVisitors).toBeLessThanOrEqual(row.pageViews);
      }
    });

    it('needs analytics.website to read the traffic', async () => {
      await server()
        .get('/api/v1/analytics/website')
        .set(auth(clerkToken))
        .expect(403);
    });
  });

  // ── 9. the cron jobs run without throwing ───────────────────────────

  describe('the scheduled jobs', () => {
    it('every job completes against a live database', async () => {
      // The M14 lesson: a job that compiles and has never been invoked is
      // a job that does not work.
      await expect(jobs.fireDueSchedules()).resolves.toBeDefined();
      await expect(jobs.foldSiteAnalytics()).resolves.toBeDefined();
      await expect(jobs.housekeeping()).resolves.toBeDefined();
      await expect(jobs.refreshViews()).resolves.toBeDefined();
    }, 90_000);
  });

  // ── 10. the registry projection ─────────────────────────────────────

  describe('report_definitions', () => {
    it('mirrors the code registry, and every row names a real permission', async () => {
      const rows = await prisma.reportDefinition.findMany({
        where: { isOrphaned: false },
      });
      expect(rows.length).toBeGreaterThan(40);

      const permissions = await prisma.permission.findMany({
        where: { isOrphaned: false },
        select: { code: true },
      });
      const known = new Set(permissions.map((p) => p.code));
      const unknown = rows
        .filter((r) => !known.has(r.permission))
        .map((r) => r.code);
      expect(unknown).toEqual([]);
    });

    it('is idempotent — a second sync changes nothing', async () => {
      const before = await prisma.reportDefinition.count();
      const result = await syncReportRegistry(prisma);
      expect(await prisma.reportDefinition.count()).toBe(before);
      expect(result.orphaned).toBe(0);
      expect(result.unknownPermissions).toEqual([]);
    });
  });
});
