import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEFAULT_SCHOOL_ID, UserType } from '../src/common/constants';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { seedChartOfAccounts } from '../src/modules/accounting/seed/accounting.seeder';
import { seedLeaveTypes } from '../src/modules/hr/seed/hr.seeder';
import {
  seedSystemRoles,
  syncPermissionRegistry,
} from '../src/modules/rbac/seed/rbac.seeder';

/**
 * Requires dev infra (DB + redis). The M21 loop in the order a school
 * lives it: name the leave types, file and approve leave (and watch the
 * balance and the attendance register move), build a pay scale, put
 * somebody on it, then run a month end to end — generate, adjust,
 * approve, disburse — and check that the roadmap §9 requirement holds:
 * **"full run lifecycle; accounting vouchers created on disburse."**
 *
 * The assertions that matter most here are the ones a unit test
 * structurally cannot make: that the salary voucher M20 receives actually
 * balances, that the provident-fund passbook does not double on a
 * re-disbursement, and that each hand-written CHECK really does reject
 * the row it claims to.
 *
 * Everything is created under `E2EHR` prefixes and removed in afterAll.
 */
describe('HR & Payroll (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-hr-admin@test.local';
  const ACCOUNTANT = 'e2e-hr-accountant@test.local';
  const TEACHER = 'e2e-hr-teacher@test.local';
  /** Timestamped per run, so cleanup has to match on the prefix (F7). */
  const STAFF_EMAIL_PREFIX = 'e2e-hr-staff-';
  const NAME = 'E2EHR';

  let adminToken: string;
  let accountantToken: string;
  let teacherToken: string;

  let sessionId: string;
  let teacherId: string;
  let staffId: string;
  let structureId: string;
  let casualTypeId: string;
  let unpaidTypeId: string;
  let runId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;
  const errorOf = (res: request.Response): string =>
    (res.body as { error: { message: string } }).error.message;

  /** The payroll month under test — always the PREVIOUS calendar month,
   *  so the run is never refused for being in the future. */
  const target = (() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  })();
  const targetMonth = target.toISOString().slice(0, 7);
  const dayIn = (n: number) =>
    new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), n))
      .toISOString()
      .slice(0, 10);

  const cleanup = async () => {
    const runs = await prisma.payrollRun.findMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, note: { contains: NAME } },
      select: { id: true },
    });
    const runIds = runs.map((r) => r.id);
    if (runIds.length > 0) {
      const slips = await prisma.payslip.findMany({
        where: { payrollRunId: { in: runIds } },
        select: { id: true },
      });
      await prisma.pfLedgerEntry.deleteMany({
        where: { payslipId: { in: slips.map((s) => s.id) } },
      });
    }
    await prisma.pfLedgerEntry.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, note: { contains: NAME } },
    });
    await prisma.payslip.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, personName: { contains: NAME } },
    });
    await prisma.payrollRun.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, note: { contains: NAME } },
    });
    await prisma.voucher.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, source: 'PAYROLL' },
    });
    await prisma.bonusRun.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.leaveApplication.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, reason: { contains: NAME } },
    });
    await prisma.leaveBalance.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        session: { name: { startsWith: NAME } },
      },
    });
    await prisma.staffAttendance.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, remarks: { contains: NAME } },
    });
    await prisma.employeeSalary.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, note: { contains: NAME } },
    });
    await prisma.salaryComponent.deleteMany({
      where: { structure: { name: { startsWith: NAME } } },
    });
    await prisma.salaryStructure.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.leaveType.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, code: { startsWith: 'E2EHR' } },
    });
    await prisma.teacher.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: NAME },
    });
    await prisma.staffProfile.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: NAME },
    });
    await prisma.academicSession.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: { in: [ADMIN, ACCOUNTANT, TEACHER] } },
          // The staff fixture's email is timestamped (`e2e-hr-staff-<epoch>`),
          // so it never matched the fixed list above and every run leaked one
          // user — 13 had accumulated by the time browser QA found them
          // (QA finding F7). Delete by the stable prefix instead.
          { email: { startsWith: STAFF_EMAIL_PREFIX } },
        ],
      },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    if (ids.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
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
    await syncPermissionRegistry(prisma);
    await seedSystemRoles(prisma, DEFAULT_SCHOOL_ID);
    await seedChartOfAccounts(prisma, DEFAULT_SCHOOL_ID);
    await seedLeaveTypes(prisma, DEFAULT_SCHOOL_ID);
    await cleanup();

    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const [adminUser, accountantUser, teacherUser] = await Promise.all(
      (
        [
          [ADMIN, UserType.ADMIN],
          [ACCOUNTANT, UserType.STAFF],
          [TEACHER, UserType.TEACHER],
        ] as const
      ).map(([email, userType]) =>
        prisma.user.create({
          data: { schoolId: DEFAULT_SCHOOL_ID, email, passwordHash, userType },
        }),
      ),
    );

    const [adminRole, accountantRole] = await Promise.all([
      prisma.role.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, slug: 'admin', deletedAt: null },
      }),
      prisma.role.findFirst({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          slug: 'accountant',
          deletedAt: null,
        },
      }),
    ]);
    await prisma.userRole.createMany({
      data: [
        { userId: adminUser.id, roleId: adminRole!.id },
        { userId: accountantUser.id, roleId: accountantRole!.id },
      ],
    });

    for (const [email, target_] of [
      [ADMIN, 'admin'],
      [ACCOUNTANT, 'accountant'],
      [TEACHER, 'teacher'],
    ] as const) {
      const res = await server()
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);
      const token = dataOf<{ accessToken: string }>(res).accessToken;
      if (target_ === 'admin') adminToken = token;
      else if (target_ === 'accountant') accountantToken = token;
      else teacherToken = token;
    }

    // A session that certainly covers the payroll month under test.
    const session = await prisma.academicSession.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `${NAME} ${target.getUTCFullYear()}`,
        startDate: new Date(
          Date.UTC(target.getUTCFullYear(), target.getUTCMonth() - 6, 1),
        ),
        endDate: new Date(
          Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 6, 28),
        ),
        status: 'ACTIVE',
      },
    });
    sessionId = session.id;

    const joined = new Date(
      Date.UTC(target.getUTCFullYear() - 3, target.getUTCMonth(), 1),
    );

    const teacher = await prisma.teacher.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        userId: teacherUser.id,
        employeeId: `${NAME}-T-${Date.now()}`,
        firstName: NAME,
        lastName: 'Teacher',
        designation: 'ASSISTANT_TEACHER',
        gender: 'MALE',
        dob: new Date('1990-01-01'),
        joiningDate: joined,
      },
    });
    teacherId = teacher.id;

    // A non-teaching staff member too: the whole point of M21 is that HR
    // stops being teacher-only.
    const staffUser = await prisma.user.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        email: `${STAFF_EMAIL_PREFIX}${Date.now()}@test.local`,
        passwordHash,
        userType: UserType.STAFF,
      },
    });
    const staff = await prisma.staffProfile.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        userId: staffUser.id,
        employeeId: `${NAME}-S-${Date.now()}`,
        firstName: NAME,
        lastName: 'Clerk',
        designation: 'OFFICE_STAFF',
        gender: 'FEMALE',
        dob: new Date('1992-05-05'),
        joiningDate: joined,
      },
    });
    staffId = staff.id;
  });

  afterAll(async () => {
    await cleanup();
    await app?.close();
  });

  // ── the unified employee view ───────────────────────────────────────

  describe('employees', () => {
    it('lists teachers and staff as one workforce (roadmap §1)', async () => {
      const res = await server()
        .get('/api/v1/employees')
        .set(auth(adminToken))
        .query({ search: NAME })
        .expect(200);

      const rows = dataOf<Array<{ personType: string; name: string }>>(res);
      const ours = rows.filter((row) => row.name.startsWith(NAME));
      expect(ours.map((row) => row.personType).sort()).toEqual([
        'STAFF',
        'TEACHER',
      ]);
    });

    it('refuses a caller without hr.view', async () => {
      await server()
        .get('/api/v1/employees')
        .set(auth(teacherToken))
        .expect(403);
    });
  });

  // ── leave ───────────────────────────────────────────────────────────

  describe('leave types', () => {
    it('serves the seeded taxonomy, including the unpaid one payroll keys on', async () => {
      const res = await server()
        .get('/api/v1/leave-types')
        .set(auth(adminToken))
        .expect(200);

      const types =
        dataOf<Array<{ id: string; code: string; isPaid: boolean }>>(res);
      const casual = types.find((t) => t.code === 'CASUAL');
      const unpaid = types.find((t) => t.code === 'UNPAID');
      expect(casual).toBeDefined();
      expect(unpaid?.isPaid).toBe(false);
      casualTypeId = casual!.id;
      unpaidTypeId = unpaid!.id;
    });

    it('refuses a carry cap when carry-forward is off', async () => {
      const res = await server()
        .post('/api/v1/leave-types')
        .set(auth(adminToken))
        .send({
          name: 'E2EHR Bad',
          code: 'E2EHR_BAD',
          annualQuota: 5,
          carryForward: false,
          maxCarry: 10,
        })
        .expect(409);
      expect(errorOf(res)).toMatch(/carry-forward is on/);
    });

    it('refuses a duplicate code', async () => {
      await server()
        .post('/api/v1/leave-types')
        .set(auth(adminToken))
        .send({ name: 'E2EHR Dup', code: 'CASUAL' })
        .expect(409);
    });
  });

  describe('leave applications', () => {
    let leaveId: string;

    it('allocates the session quotas to every employee, idempotently', async () => {
      const first = await server()
        .post('/api/v1/leave-balances/allocate')
        .set(auth(adminToken))
        .send({ sessionId, prorate: true })
        .expect(201);
      expect(
        dataOf<{ rowsCreated: number }>(first).rowsCreated,
      ).toBeGreaterThan(0);

      // A second run must not double anybody's quota — the whole reason
      // `uq_leave_balances_identity` exists.
      const second = await server()
        .post('/api/v1/leave-balances/allocate')
        .set(auth(adminToken))
        .send({ sessionId, prorate: true })
        .expect(201);
      expect(dataOf<{ rowsCreated: number }>(second).rowsCreated).toBe(0);

      const balance = await prisma.leaveBalance.findFirst({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          sessionId,
          personType: 'TEACHER',
          personId: teacherId,
          leaveTypeId: casualTypeId,
        },
      });
      expect(Number(balance?.allocated)).toBe(10);
    });

    it('counts WORKING days, not calendar days', async () => {
      // Days 3–9 of the month span at least one weekly holiday, so the
      // stored `days` has to be short of the calendar span.
      const res = await server()
        .post('/api/v1/leave-applications')
        .set(auth(adminToken))
        .send({
          personType: 'TEACHER',
          personId: teacherId,
          leaveTypeId: casualTypeId,
          fromDate: dayIn(3),
          toDate: dayIn(9),
          reason: `${NAME} family matter`,
        })
        .expect(201);

      const application = dataOf<{ id: string; days: string }>(res);
      leaveId = application.id;
      expect(Number(application.days)).toBeGreaterThan(0);
      expect(Number(application.days)).toBeLessThan(7);
    });

    it('refuses an overlapping application for the same person', async () => {
      const res = await server()
        .post('/api/v1/leave-applications')
        .set(auth(adminToken))
        .send({
          personType: 'TEACHER',
          personId: teacherId,
          leaveTypeId: casualTypeId,
          fromDate: dayIn(8),
          toDate: dayIn(12),
          reason: `${NAME} overlap`,
        })
        .expect(409);
      expect(errorOf(res)).toMatch(/overlaps/);
    });

    it('refuses a half day spanning more than one date', async () => {
      await server()
        .post('/api/v1/leave-applications')
        .set(auth(adminToken))
        .send({
          personType: 'TEACHER',
          personId: teacherId,
          leaveTypeId: casualTypeId,
          fromDate: dayIn(20),
          toDate: dayIn(21),
          halfDay: true,
          reason: `${NAME} half`,
        })
        .expect(400);
    });

    it('approving consumes the balance AND marks the days LEAVE (the M12 hook)', async () => {
      const before = await prisma.leaveBalance.findFirst({
        where: {
          sessionId,
          personType: 'TEACHER',
          personId: teacherId,
          leaveTypeId: casualTypeId,
        },
      });

      await server()
        .post(`/api/v1/leave-applications/${leaveId}/approve`)
        .set(auth(adminToken))
        .send({ note: `${NAME} approved` })
        .expect(201);

      const application = await prisma.leaveApplication.findUnique({
        where: { id: leaveId },
      });
      expect(application?.status).toBe('APPROVED');
      // The evidence rule: a decision records when it was taken.
      expect(application?.approvedAt).not.toBeNull();

      const after = await prisma.leaveBalance.findFirst({
        where: {
          sessionId,
          personType: 'TEACHER',
          personId: teacherId,
          leaveTypeId: casualTypeId,
        },
      });
      expect(Number(after?.used) - Number(before?.used)).toBe(
        Number(application?.days),
      );

      // The listener is fire-and-forget, so poll for the attendance rows
      // rather than reading once (the M15 audit-race lesson).
      let marked = 0;
      for (let attempt = 0; attempt < 20 && marked === 0; attempt += 1) {
        marked = await prisma.staffAttendance.count({
          where: {
            schoolId: DEFAULT_SCHOOL_ID,
            personType: 'TEACHER',
            personId: teacherId,
            status: 'LEAVE',
            deletedAt: null,
          },
        });
        if (marked === 0) await new Promise((r) => setTimeout(r, 150));
      }
      expect(marked).toBeGreaterThan(0);
    });

    it('withdrawing an approved leave hands the days back', async () => {
      const before = await prisma.leaveBalance.findFirst({
        where: {
          sessionId,
          personType: 'TEACHER',
          personId: teacherId,
          leaveTypeId: casualTypeId,
        },
      });

      await server()
        .post(`/api/v1/leave-applications/${leaveId}/cancel`)
        .set(auth(adminToken))
        .send({ note: `${NAME} withdrawn` })
        .expect(201);

      const after = await prisma.leaveBalance.findFirst({
        where: {
          sessionId,
          personType: 'TEACHER',
          personId: teacherId,
          leaveTypeId: casualTypeId,
        },
      });
      expect(Number(after?.used)).toBeLessThan(Number(before?.used));
    });

    it('refuses an approval that overdraws the quota, unless overridden', async () => {
      // Casual is 10 days; ask for the whole month.
      const res = await server()
        .post('/api/v1/leave-applications')
        .set(auth(adminToken))
        .send({
          personType: 'STAFF',
          personId: staffId,
          leaveTypeId: casualTypeId,
          fromDate: dayIn(2),
          toDate: dayIn(26),
          reason: `${NAME} long leave`,
        })
        .expect(201);
      const id = dataOf<{ id: string }>(res).id;

      const refused = await server()
        .post(`/api/v1/leave-applications/${id}/approve`)
        .set(auth(adminToken))
        .send({})
        .expect(409);
      expect(errorOf(refused)).toMatch(/only .* left/);

      await server()
        .post(`/api/v1/leave-applications/${id}/approve`)
        .set(auth(adminToken))
        .send({ override: true })
        .expect(201);

      await server()
        .post(`/api/v1/leave-applications/${id}/cancel`)
        .set(auth(adminToken))
        .send({ note: `${NAME} cleanup` })
        .expect(201);
    });

    it('an UNPAID type is never "over quota" — the days come out of pay', async () => {
      const res = await server()
        .post('/api/v1/leave-applications')
        .set(auth(adminToken))
        .send({
          personType: 'TEACHER',
          personId: teacherId,
          leaveTypeId: unpaidTypeId,
          fromDate: dayIn(15),
          toDate: dayIn(17),
          reason: `${NAME} unpaid absence`,
        })
        .expect(201);

      await server()
        .post(
          `/api/v1/leave-applications/${dataOf<{ id: string }>(res).id}/approve`,
        )
        .set(auth(adminToken))
        .send({})
        .expect(201);
    });
  });

  // ── salary structures ───────────────────────────────────────────────

  describe('salary structures', () => {
    it('previews through the same engine the payslip uses', async () => {
      const res = await server()
        .post('/api/v1/salary-structures/preview')
        .set(auth(adminToken))
        .send({
          basic: 20000,
          components: [
            {
              name: 'House Rent',
              type: 'ALLOWANCE',
              calc: 'PERCENT_OF_BASIC',
              value: 40,
            },
            { name: 'Medical', type: 'ALLOWANCE', calc: 'FLAT', value: 1500 },
          ],
        })
        .expect(201);

      const preview = dataOf<{
        computed: { gross: number; allowanceTotal: number };
        problems: unknown[];
      }>(res);
      expect(preview.computed.allowanceTotal).toBe(9500);
      expect(preview.computed.gross).toBe(29500);
      expect(preview.problems).toEqual([]);
    });

    it('refuses a percentage above 100, reporting every problem at once', async () => {
      // 409 rather than 400: the engine returns the whole problem list so
      // the builder can paint each bad row (the M15 all-at-once rule).
      const res = await server()
        .post('/api/v1/salary-structures')
        .set(auth(adminToken))
        .send({
          name: `${NAME} Bad Scale`,
          basic: 20000,
          components: [
            {
              name: 'HR',
              type: 'ALLOWANCE',
              calc: 'PERCENT_OF_BASIC',
              value: 140,
            },
          ],
        })
        .expect(409);
      expect(errorOf(res)).toMatch(/cannot exceed 100/);
    });

    it('creates a scale with its components', async () => {
      const res = await server()
        .post('/api/v1/salary-structures')
        .set(auth(adminToken))
        .send({
          name: `${NAME} Assistant Teacher`,
          grade: 'G-11',
          basic: 20000,
          components: [
            {
              name: 'House Rent',
              type: 'ALLOWANCE',
              calc: 'PERCENT_OF_BASIC',
              value: 40,
              isPfBase: true,
            },
            { name: 'Medical', type: 'ALLOWANCE', calc: 'FLAT', value: 1500 },
          ],
        })
        .expect(201);

      const structure = dataOf<{
        id: string;
        computed: { gross: number };
        components: unknown[];
      }>(res);
      structureId = structure.id;
      expect(structure.components).toHaveLength(2);
      expect(structure.computed.gross).toBe(29500);
    });

    it('replaces the component set wholesale on edit', async () => {
      await server()
        .patch(`/api/v1/salary-structures/${structureId}`)
        .set(auth(adminToken))
        .send({
          components: [
            {
              name: 'House Rent',
              type: 'ALLOWANCE',
              calc: 'PERCENT_OF_BASIC',
              value: 40,
              isPfBase: true,
            },
            { name: 'Medical', type: 'ALLOWANCE', calc: 'FLAT', value: 1500 },
            { name: 'Conveyance', type: 'ALLOWANCE', calc: 'FLAT', value: 800 },
          ],
        })
        .expect(200);

      const rows = await prisma.salaryComponent.count({
        where: { structureId },
      });
      expect(rows).toBe(3);
    });
  });

  describe('salary assignment', () => {
    it('requires bank details when the mode is BANK (roadmap §7)', async () => {
      const res = await server()
        .put(`/api/v1/employees/${teacherId}/salary`)
        .set(auth(adminToken))
        .send({
          personType: 'TEACHER',
          structureId,
          effectiveFrom: dayIn(1),
          paymentMode: 'BANK',
        })
        .expect(400);
      expect(errorOf(res)).toMatch(/account number/i);
    });

    it('records a salary from a date', async () => {
      for (const [type, id] of [
        ['TEACHER', teacherId],
        ['STAFF', staffId],
      ] as const) {
        await server()
          .put(`/api/v1/employees/${id}/salary`)
          .set(auth(adminToken))
          .send({
            personType: type,
            structureId,
            effectiveFrom: new Date(Date.UTC(target.getUTCFullYear() - 1, 0, 1))
              .toISOString()
              .slice(0, 10),
            paymentMode: 'BANK',
            bankAccount: { bankName: 'Sonali Bank', accountNo: '01234567' },
            note: `${NAME} initial`,
          })
          .expect(200);
      }

      const rows = await prisma.employeeSalary.count({
        where: { schoolId: DEFAULT_SCHOOL_ID, note: { contains: NAME } },
      });
      expect(rows).toBe(2);
    });

    it('a later effective date adds a HISTORY row, it does not edit the old one', async () => {
      await server()
        .put(`/api/v1/employees/${teacherId}/salary`)
        .set(auth(adminToken))
        .send({
          personType: 'TEACHER',
          structureId,
          basicOverride: 24000,
          effectiveFrom: new Date(Date.UTC(target.getUTCFullYear() + 5, 0, 1))
            .toISOString()
            .slice(0, 10),
          paymentMode: 'CASH',
          note: `${NAME} future increment`,
        })
        .expect(200);

      const history = await prisma.employeeSalary.findMany({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          personType: 'TEACHER',
          personId: teacherId,
          deletedAt: null,
        },
      });
      expect(history).toHaveLength(2);
    });
  });

  // ── the payroll run ─────────────────────────────────────────────────

  describe('payroll run lifecycle', () => {
    it('opens a month', async () => {
      const res = await server()
        .post('/api/v1/payroll-runs')
        .set(auth(accountantToken))
        .send({ month: targetMonth, note: `${NAME} run` })
        .expect(201);

      const run = dataOf<{ id: string; status: string }>(res);
      runId = run.id;
      expect(run.status).toBe('DRAFT');
    });

    it('refuses a second live run for the same month', async () => {
      const res = await server()
        .post('/api/v1/payroll-runs')
        .set(auth(accountantToken))
        .send({ month: targetMonth, note: `${NAME} duplicate` })
        .expect(409);
      expect(errorOf(res)).toMatch(/already exists/);
    });

    it('refuses a month that has not started', async () => {
      const ahead = new Date();
      ahead.setUTCMonth(ahead.getUTCMonth() + 2);
      await server()
        .post('/api/v1/payroll-runs')
        .set(auth(accountantToken))
        .send({ month: ahead.toISOString().slice(0, 7), note: `${NAME} ahead` })
        .expect(400);
    });

    it('warns rather than guesses when attendance is unmarked (roadmap §8)', async () => {
      const res = await server()
        .post(`/api/v1/payroll-runs/${runId}/generate`)
        .set(auth(accountantToken))
        .send({})
        .expect(409);
      expect(errorOf(res)).toMatch(/unmarked/);
    });

    it('generates with force, computing every payslip', async () => {
      // Mark one absent day for the teacher so the deduction has something
      // to bite on.
      await prisma.staffAttendance.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          personType: 'TEACHER',
          personId: teacherId,
          date: new Date(dayIn(20)),
          status: 'ABSENT',
          remarks: `${NAME} absent`,
        },
      });

      const res = await server()
        .post(`/api/v1/payroll-runs/${runId}/generate`)
        .set(auth(adminToken))
        .send({ force: true })
        .expect(201);

      const result = dataOf<{
        generated: number;
        run: { status: string; workingDays: number };
        warnings: Array<{ code: string }>;
      }>(res);
      expect(result.generated).toBeGreaterThanOrEqual(2);
      expect(result.run.status).toBe('GENERATED');
      expect(result.run.workingDays).toBeGreaterThan(0);
      expect(result.warnings.map((w) => w.code)).toContain(
        'UNMARKED_ATTENDANCE',
      );
    });

    it('deducted the absent day, and the unpaid leave, from the teacher', async () => {
      const slip = await prisma.payslip.findFirst({
        where: {
          payrollRunId: runId,
          personType: 'TEACHER',
          personId: teacherId,
        },
      });
      expect(slip).not.toBeNull();
      expect(Number(slip!.gross)).toBe(30300); // 20000 + 8000 + 1500 + 800
      expect(Number(slip!.attendanceDeduction)).toBeGreaterThan(0);
      expect(Number(slip!.daysUnpaidLeave)).toBeGreaterThan(0);
      expect(Number(slip!.netPayable)).toBeLessThan(Number(slip!.gross));
    });

    it('regenerating replaces the payslips instead of duplicating them', async () => {
      const before = await prisma.payslip.count({
        where: { payrollRunId: runId },
      });
      await server()
        .post(`/api/v1/payroll-runs/${runId}/generate`)
        .set(auth(adminToken))
        .send({ force: true })
        .expect(201);
      const after = await prisma.payslip.count({
        where: { payrollRunId: runId },
      });
      expect(after).toBe(before);
    });

    it('adjusts a draft payslip by RECOMPUTING it, with a reason', async () => {
      const slip = await prisma.payslip.findFirst({
        where: { payrollRunId: runId, personType: 'STAFF', personId: staffId },
      });
      const before = Number(slip!.netPayable);

      const res = await server()
        .patch(`/api/v1/payslips/${slip!.id}`)
        .set(auth(accountantToken))
        .send({
          reason: `${NAME} exam committee duty`,
          adHoc: [{ label: 'Exam committee', type: 'ALLOWANCE', amount: 3000 }],
        })
        .expect(200);

      const updated = dataOf<{ netPayable: string; editReason: string }>(res);
      expect(Number(updated.netPayable)).toBe(before + 3000);
      expect(updated.editReason).toMatch(/exam committee/);
    });

    it('refuses an adjustment with no real reason', async () => {
      const slip = await prisma.payslip.findFirst({
        where: { payrollRunId: runId, personType: 'STAFF' },
      });
      await server()
        .patch(`/api/v1/payslips/${slip!.id}`)
        .set(auth(accountantToken))
        .send({ reason: 'fix' })
        .expect(400);
    });

    it('the accountant may NOT approve — they computed it (separation of duties)', async () => {
      await server()
        .post(`/api/v1/payroll-runs/${runId}/approve`)
        .set(auth(accountantToken))
        .expect(403);
    });

    it('approves, and the payslips freeze', async () => {
      const res = await server()
        .post(`/api/v1/payroll-runs/${runId}/approve`)
        .set(auth(adminToken))
        .expect(201);
      expect(dataOf<{ status: string }>(res).status).toBe('APPROVED');

      const slip = await prisma.payslip.findFirst({
        where: { payrollRunId: runId },
      });
      const refused = await server()
        .patch(`/api/v1/payslips/${slip!.id}`)
        .set(auth(accountantToken))
        .send({ reason: `${NAME} too late to change this` })
        .expect(409);
      expect(errorOf(refused)).toMatch(/frozen|cannot be edited/i);
    });

    it('holds one payslip out of the disbursement', async () => {
      const slip = await prisma.payslip.findFirst({
        where: { payrollRunId: runId, personType: 'STAFF', personId: staffId },
      });
      await server()
        .post(`/api/v1/payslips/${slip!.id}/hold`)
        .set(auth(adminToken))
        .send({ reason: `${NAME} disciplinary hold` })
        .expect(201);

      const held = await prisma.payslip.findUnique({ where: { id: slip!.id } });
      expect(held?.status).toBe('HELD');
      expect(held?.holdReason).not.toBeNull();
    });
  });

  // ── the roadmap §9 requirement ──────────────────────────────────────

  describe('disbursement → the ledger', () => {
    let voucherNo: string | null = null;

    it('pays the payable payslips and posts ONE balanced salary voucher', async () => {
      const res = await server()
        .post(`/api/v1/payroll-runs/${runId}/disburse`)
        .set(auth(adminToken))
        .send({})
        .expect(201);

      const result = dataOf<{
        paid: number;
        held: number;
        voucherNo: string | null;
        netTotal: number;
      }>(res);
      voucherNo = result.voucherNo;

      expect(result.held).toBe(1);
      expect(result.paid).toBeGreaterThanOrEqual(1);
      expect(result.voucherNo).not.toBeNull();

      const voucher = await prisma.voucher.findFirst({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          sourceRef: `payroll:${runId}`,
        },
        include: { entries: true },
      });
      expect(voucher).not.toBeNull();
      expect(voucher!.source).toBe('PAYROLL');
      expect(voucher!.postedAt).not.toBeNull();

      // The assertion this whole suite exists for: the voucher balances.
      const debit = voucher!.entries.reduce(
        (sum, entry) => sum + Number(entry.debit),
        0,
      );
      const credit = voucher!.entries.reduce(
        (sum, entry) => sum + Number(entry.credit),
        0,
      );
      expect(Math.abs(debit - credit)).toBeLessThan(0.005);

      // And it credits exactly what left the school.
      expect(Math.abs(credit - debit)).toBeLessThan(0.005);
      const fundsLine = voucher!.entries.find(
        (entry) => Number(entry.credit) > 0,
      );
      expect(fundsLine).toBeDefined();
    });

    it('the HELD payslip is unpaid and absent from the voucher', async () => {
      const held = await prisma.payslip.findFirst({
        where: { payrollRunId: runId, status: 'HELD' },
      });
      expect(held?.paidAt).toBeNull();

      const voucher = await prisma.voucher.findFirst({
        where: { sourceRef: `payroll:${runId}` },
        include: { entries: true },
      });
      const paid = await prisma.payslip.findMany({
        where: { payrollRunId: runId, status: 'PAID' },
      });
      const paidNet = paid.reduce(
        (sum, slip) => sum + Number(slip.netPayable),
        0,
      );
      const credited = voucher!.entries
        .filter((entry) => Number(entry.credit) > 0)
        .reduce((sum, entry) => sum + Number(entry.credit), 0);
      // Credits are net + PF + tax; with PF and tax off they are the net
      // of the PAID payslips alone — never the held one's.
      expect(credited).toBeGreaterThanOrEqual(paidNet - 0.01);
      expect(credited).toBeLessThan(paidNet + Number(held!.netPayable));
    });

    it('the salary voucher shows up in the accounting reports', async () => {
      const res = await server()
        .get('/api/v1/accounting/reports/trial-balance')
        .set(auth(adminToken))
        .query({ from: dayIn(1), to: new Date().toISOString().slice(0, 10) })
        .expect(200);

      const report = dataOf<{
        balanced: boolean;
        rows: Array<{ code: string; debit: number }>;
      }>(res);
      expect(report.balanced).toBe(true);
      const salaryLine = report.rows.find((row) => row.code === '5100');
      expect(salaryLine).toBeDefined();
      expect(salaryLine!.debit).toBeGreaterThan(0);
    });

    it('is idempotent — a replay lands the SAME voucher, not a second one', async () => {
      // A disbursed run refuses a second disbursement outright, which is
      // the first line of defence; the `source_ref` unique is the second.
      await server()
        .post(`/api/v1/payroll-runs/${runId}/disburse`)
        .set(auth(adminToken))
        .send({})
        .expect(409);

      const count = await prisma.voucher.count({
        where: { sourceRef: `payroll:${runId}`, deletedAt: null },
      });
      expect(count).toBe(1);
      expect(voucherNo).not.toBeNull();
    });

    it('a disbursed run cannot be cancelled — the money has gone', async () => {
      const res = await server()
        .post(`/api/v1/payroll-runs/${runId}/cancel`)
        .set(auth(adminToken))
        .send({ reason: `${NAME} too late` })
        .expect(409);
      expect(errorOf(res)).toMatch(/already paid|cannot be cancelled/i);
    });
  });

  // ── reports & exports ───────────────────────────────────────────────

  describe('reports', () => {
    it('the register lists every payslip in the window with matching totals', async () => {
      const res = await server()
        .get('/api/v1/payroll/reports/register')
        .set(auth(adminToken))
        .query({ runId })
        .expect(200);

      const report = dataOf<{
        rows: Array<{ netPayable: number }>;
        totals: { netPayable: number };
      }>(res);
      expect(report.rows.length).toBeGreaterThanOrEqual(2);
      const summed = report.rows.reduce((sum, row) => sum + row.netPayable, 0);
      expect(Math.abs(summed - report.totals.netPayable)).toBeLessThan(0.01);
    });

    it('the grade distribution counts who is actually on each scale', async () => {
      const res = await server()
        .get('/api/v1/payroll/reports/grades')
        .set(auth(adminToken))
        .expect(200);

      const report = dataOf<{
        rows: Array<{ structureName: string; headcount: number }>;
      }>(res);
      const ours = report.rows.find((row) =>
        row.structureName.startsWith(NAME),
      );
      expect(ours?.headcount).toBe(2);
    });

    it('exports the bank advice as XLSX, without the held payslip', async () => {
      const res = await server()
        .get(`/api/v1/payroll-runs/${runId}/bank-advice.xlsx`)
        .set(auth(adminToken))
        .expect(200);
      expect(res.headers['content-type']).toContain('spreadsheet');
      expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
    });

    it('exports a payslip PDF', async () => {
      const slip = await prisma.payslip.findFirst({
        where: { payrollRunId: runId, status: 'PAID' },
      });
      const res = await server()
        .get(`/api/v1/payslips/${slip!.id}/pdf`)
        .set(auth(adminToken))
        .expect(200);
      expect(res.headers['content-type']).toContain('pdf');
    });
  });

  // ── portal self-service ─────────────────────────────────────────────

  describe('employee self-service', () => {
    it('resolves the employee from the account, not a parameter', async () => {
      const res = await server()
        .get('/api/v1/portal/employee/me')
        .set(auth(teacherToken))
        .expect(200);
      expect(dataOf<{ personId: string }>(res).personId).toBe(teacherId);
    });

    it('shows only disbursed payslips', async () => {
      const res = await server()
        .get('/api/v1/portal/employee/payslips')
        .set(auth(teacherToken))
        .expect(200);
      const rows = dataOf<Array<{ month: string; status: string }>>(res);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.every((row) => row.status === 'PAID')).toBe(true);
    });

    it('404s an account with no employee profile', async () => {
      await server()
        .get('/api/v1/portal/employee/payslips')
        .set(auth(accountantToken))
        .expect(404);
    });

    it("refuses a colleague's payslip", async () => {
      const others = await prisma.payslip.findFirst({
        where: { payrollRunId: runId, personType: 'STAFF', personId: staffId },
      });
      await server()
        .get(`/api/v1/portal/employee/payslips/${others!.id}/pdf`)
        .set(auth(teacherToken))
        .expect(403);
    });
  });

  // ── the hand-written constraints ────────────────────────────────────

  describe('database invariants', () => {
    it('refuses a payroll month that is not the 1st', async () => {
      await expect(
        prisma.payrollRun.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            month: new Date(dayIn(15)),
            note: `${NAME} bad month`,
          },
        }),
      ).rejects.toThrow(/chk_payroll_runs_month_first/);
    });

    it('refuses a second live run for the month (uq_payroll_runs_month)', async () => {
      await expect(
        prisma.payrollRun.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            month: target,
            note: `${NAME} dup`,
          },
        }),
      ).rejects.toThrow(/uq_payroll_runs_month/);
    });

    it('refuses a HELD payslip with no reason', async () => {
      const slip = await prisma.payslip.findFirst({
        where: { payrollRunId: runId },
      });
      await expect(
        prisma.payslip.update({
          where: { id: slip!.id },
          data: { status: 'HELD', holdReason: null },
        }),
      ).rejects.toThrow(/chk_payslips_status_evidence/);
    });

    it('refuses a negative amount on a payslip', async () => {
      const slip = await prisma.payslip.findFirst({
        where: { payrollRunId: runId },
      });
      await expect(
        prisma.payslip.update({
          where: { id: slip!.id },
          data: { netPayable: -1 },
        }),
      ).rejects.toThrow(/chk_payslips_amounts/);
    });

    it('refuses a component percentage above 100', async () => {
      await expect(
        prisma.salaryComponent.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            structureId,
            name: 'Impossible',
            type: 'ALLOWANCE',
            calc: 'PERCENT_OF_BASIC',
            value: 140,
          },
        }),
      ).rejects.toThrow(/chk_salary_components_value/);
    });

    it('refuses a leave application whose end precedes its start', async () => {
      await expect(
        prisma.leaveApplication.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            personType: 'TEACHER',
            personId: teacherId,
            leaveTypeId: casualTypeId,
            fromDate: new Date(dayIn(10)),
            toDate: new Date(dayIn(5)),
            days: 3,
            reason: `${NAME} backwards`,
          },
        }),
      ).rejects.toThrow(/chk_leave_applications_range/);
    });

    it('refuses an exit date before the joining date', async () => {
      await expect(
        prisma.teacher.update({
          where: { id: teacherId },
          data: { exitDate: new Date('1980-01-01') },
        }),
      ).rejects.toThrow(/chk_teachers_exit_after_joining/);
    });

    it('refuses a provident-fund row that overdraws the fund', async () => {
      await expect(
        prisma.pfLedgerEntry.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            personType: 'TEACHER',
            personId: teacherId,
            month: target,
            type: 'WITHDRAWAL',
            employeeAmt: 500,
            balanceAfter: -500,
            note: `${NAME} overdraw`,
          },
        }),
      ).rejects.toThrow(/chk_pf_ledger_amounts/);
    });
  });

  // ── the M08 supersession ────────────────────────────────────────────

  describe('the retired teacher_leaves table', () => {
    it('is gone — leave lives in one table for the whole workforce', async () => {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM information_schema.tables
        WHERE table_name = 'teacher_leaves'
      `;
      expect(Number(rows[0].count)).toBe(0);
    });

    it('and so is its enum', async () => {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM pg_type
        WHERE typname = 'leave_type_enum'
      `;
      expect(Number(rows[0].count)).toBe(0);
    });
  });
});
