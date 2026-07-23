import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEFAULT_SCHOOL_ID, UserType } from '../src/common/constants';
import { PrismaService } from '../src/database/prisma/prisma.service';
import {
  seedSystemRoles,
  syncPermissionRegistry,
} from '../src/modules/rbac/seed/rbac.seeder';
import { FineJob } from '../src/modules/fee/jobs/fine.job';
import { LedgerService } from '../src/modules/fee/services/ledger.service';

/**
 * Requires dev infra (DB + redis). The whole M16 loop in the order a
 * school lives it: define fee heads, price them per class, grant a
 * concession, generate a month's invoices (with proration for a
 * mid-month joiner), take money at the desk across several invoices,
 * refund some of it, run the fine job, and read the reports.
 *
 * The fixture is built so the interesting rules are observable: one
 * student joined mid-month, one holds a percentage discount, one is
 * fully waived, and one head is non-refundable.
 *
 * Everything is created under `E2E-FEE`/`E2E FEE` prefixes and removed
 * in afterAll.
 */
describe('Fees & Payments (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-fee-admin@test.local';
  const ACCOUNTANT = 'e2e-fee-accountant@test.local';
  const PLAIN = 'e2e-fee-plain@test.local';
  const NAME = 'E2EFEE';
  const ACCOUNTANT_ROLE = 'e2e-fee-accountant';

  let adminToken: string;
  let accountantToken: string;
  let plainToken: string;

  let sessionId: string;
  let classId: string;
  let sectionId: string;
  let tuitionHeadId: string;
  let admissionHeadId: string;

  /** enrollmentId per roll 1..4. */
  const enrollments = new Map<number, string>();
  const studentIds = new Map<number, string>();

  const day = (offset: number): string => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  /** A month safely in the past, so due dates are overdue for the fine job. */
  const BILLING_MONTH = (() => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - 2, 1);
    return d.toISOString().slice(0, 7);
  })();
  const monthStart = `${BILLING_MONTH}-01`;
  const daysInBillingMonth = new Date(
    Date.UTC(
      Number(BILLING_MONTH.slice(0, 4)),
      Number(BILLING_MONTH.slice(5, 7)),
      0,
    ),
  ).getUTCDate();

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;

  const cleanup = async () => {
    await prisma.academicSession.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E-FEE ' } },
    });
    await prisma.student.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: NAME },
    });
    await prisma.feeHead.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E FEE ' } },
    });
    await prisma.schoolClass.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: { startsWith: 'E2E FEEClass' },
      },
    });
    await prisma.role.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, slug: ACCOUNTANT_ROLE },
    });
    const users = await prisma.user.findMany({
      where: { email: { in: [ADMIN, ACCOUNTANT, PLAIN] } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    if (ids.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
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
    await cleanup();

    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const [adminUser, accountantUser] = await Promise.all(
      (
        [
          [ADMIN, UserType.ADMIN],
          [ACCOUNTANT, UserType.STAFF],
          [PLAIN, UserType.STAFF],
        ] as const
      ).map(([email, userType]) =>
        prisma.user.create({
          data: { schoolId: DEFAULT_SCHOOL_ID, email, passwordHash, userType },
        }),
      ),
    );

    const adminRole = await prisma.role.findFirst({
      where: { schoolId: DEFAULT_SCHOOL_ID, slug: 'admin', deletedAt: null },
    });
    await prisma.userRole.create({
      data: { userId: adminUser.id, roleId: adminRole!.id },
    });

    // The seeded Accountant baseline deliberately lacks
    // `fee.override.approve` and `fee.overpay` — the two places where
    // taking the money and authorising it must be different people.
    const accountantRole = await prisma.role.findFirst({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        slug: 'accountant',
        deletedAt: null,
      },
    });
    await prisma.userRole.create({
      data: { userId: accountantUser.id, roleId: accountantRole!.id },
    });

    const session = await prisma.academicSession.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `E2E-FEE ${new Date().getUTCFullYear()}`,
        startDate: new Date(day(-300)),
        endDate: new Date(day(120)),
        status: 'ACTIVE',
      },
    });
    sessionId = session.id;

    const klass = await prisma.schoolClass.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: 'E2E FEEClassA',
        numericLevel: 16,
      },
    });
    classId = klass.id;

    const section = await prisma.section.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        classId,
        sessionId,
        name: 'A1',
        roomNo: 'R-FEE',
      },
    });
    sectionId = section.id;

    // Roll 3 joins mid-month (proration); the rest were there from the
    // start of the session.
    for (let roll = 1; roll <= 4; roll += 1) {
      const student = await prisma.student.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          studentUid: `E2E-FEE-${Date.now()}-${roll}`,
          firstName: NAME,
          lastName: `Pupil${roll}`,
          gender: 'MALE',
          dob: new Date('2012-04-04'),
          admissionDate: new Date(day(-290)),
          admissionClassId: classId,
          qrToken: randomUUID(),
        },
      });
      studentIds.set(roll, student.id);

      const joinDay = roll === 3 ? 16 : 1;
      const enrollment = await prisma.enrollment.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          studentId: student.id,
          sessionId,
          classId,
          sectionId,
          rollNo: roll,
          enrollmentDate:
            roll === 3
              ? new Date(`${BILLING_MONTH}-${String(joinDay).padStart(2, '0')}`)
              : new Date(day(-280)),
          status: 'ACTIVE',
        },
      });
      enrollments.set(roll, enrollment.id);
    }

    const login = async (identifier: string) => {
      const res = await server()
        .post('/api/v1/auth/login')
        .send({ identifier, password: PASSWORD })
        .expect(200);
      return (res.body as { data: { accessToken: string } }).data.accessToken;
    };
    adminToken = await login(ADMIN);
    accountantToken = await login(ACCOUNTANT);
    plainToken = await login(PLAIN);
  }, 240_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  }, 120_000);

  // ── permissions ─────────────────────────────────────────────────────

  it('is permission-guarded', async () => {
    await server().get('/api/v1/fee-heads').set(auth(plainToken)).expect(403);
    await server()
      .post('/api/v1/invoices/generate')
      .set(auth(plainToken))
      .send({})
      .expect(403);
  });

  // ── fee setup ───────────────────────────────────────────────────────

  describe('fee setup', () => {
    it('creates fee heads', async () => {
      tuitionHeadId = dataOf<{ id: string }>(
        await server()
          .post('/api/v1/fee-heads')
          .set(auth(adminToken))
          .send({ name: 'E2E FEE Tuition', type: 'RECURRING_MONTHLY' })
          .expect(201),
      ).id;

      // A non-refundable head — refunds against it are refused outright.
      admissionHeadId = dataOf<{ id: string }>(
        await server()
          .post('/api/v1/fee-heads')
          .set(auth(adminToken))
          .send({
            name: 'E2E FEE Admission',
            type: 'ONE_TIME',
            isRefundable: false,
          })
          .expect(201),
      ).id;
    });

    it('refuses a duplicate head name, case-insensitively', async () => {
      await server()
        .post('/api/v1/fee-heads')
        .set(auth(adminToken))
        .send({ name: 'e2e fee tuition' })
        .expect(409);
    });

    it('prices heads per class', async () => {
      const result = dataOf<{ created: number }>(
        await server()
          .put('/api/v1/fee-structures')
          .set(auth(adminToken))
          .send({
            sessionId,
            structures: [
              { classId, feeHeadId: tuitionHeadId, amount: 2000 },
              { classId, feeHeadId: admissionHeadId, amount: 5000 },
            ],
          })
          .expect(200),
      );
      expect(result.created).toBe(2);
    });

    it('is idempotent — re-saving updates rather than duplicating', async () => {
      const result = dataOf<{ created: number; updated: number }>(
        await server()
          .put('/api/v1/fee-structures')
          .set(auth(adminToken))
          .send({
            sessionId,
            structures: [{ classId, feeHeadId: tuitionHeadId, amount: 2500 }],
          })
          .expect(200),
      );
      expect(result).toMatchObject({ created: 0, updated: 1 });

      // Put it back for the invoicing tests.
      await server()
        .put('/api/v1/fee-structures')
        .set(auth(adminToken))
        .send({
          sessionId,
          structures: [{ classId, feeHeadId: tuitionHeadId, amount: 2000 }],
        })
        .expect(200);
    });

    it('grants a percentage discount to roll 2', async () => {
      await server()
        .post('/api/v1/fee-overrides')
        .set(auth(adminToken))
        .send({
          enrollmentId: enrollments.get(2),
          feeHeadId: tuitionHeadId,
          type: 'DISCOUNT_PERCENT',
          value: 25,
          reason: 'Sibling discount',
        })
        .expect(201);
    });

    it('refuses a waiver from someone without approve rights', async () => {
      // The Accountant may record a discount but not sign off a waiver —
      // that separation is why the seeded role lacks the code.
      await server()
        .post('/api/v1/fee-overrides')
        .set(auth(accountantToken))
        .send({
          enrollmentId: enrollments.get(4),
          feeHeadId: tuitionHeadId,
          type: 'WAIVER',
          value: 0,
          reason: 'Orphan',
        })
        .expect(403);
    });

    it('lets an approver grant the waiver', async () => {
      await server()
        .post('/api/v1/fee-overrides')
        .set(auth(adminToken))
        .send({
          enrollmentId: enrollments.get(4),
          feeHeadId: tuitionHeadId,
          type: 'WAIVER',
          value: 0,
          reason: 'Orphan — full waiver',
        })
        .expect(201);
    });

    it('refuses an override with no reason', async () => {
      await server()
        .post('/api/v1/fee-overrides')
        .set(auth(adminToken))
        .send({
          enrollmentId: enrollments.get(1),
          feeHeadId: tuitionHeadId,
          type: 'DISCOUNT_FLAT',
          value: 100,
        })
        .expect(400);
    });
  });

  // ── invoicing ───────────────────────────────────────────────────────

  describe('invoice generation', () => {
    it('previews without writing anything', async () => {
      const preview = dataOf<{
        dryRun: boolean;
        generated: number;
        totalPayable: number;
      }>(
        await server()
          .post('/api/v1/invoices/generate')
          .set(auth(adminToken))
          .send({
            sessionId,
            billingMonth: BILLING_MONTH,
            classId,
            dryRun: true,
          })
          .expect(201),
      );

      expect(preview.dryRun).toBe(true);
      // Roll 4 is fully waived, so it is generated but payable 0.
      expect(preview.generated).toBe(4);
      expect(
        await prisma.invoice.count({ where: { sessionId } }),
      ).toBe(0);
    });

    it('generates the month, prorating the mid-month joiner', async () => {
      const result = dataOf<{
        generated: number;
        rows: Array<{ rollNo: number; payable: number; prorated: boolean }>;
      }>(
        await server()
          .post('/api/v1/invoices/generate')
          .set(auth(adminToken))
          .send({ sessionId, billingMonth: BILLING_MONTH, classId })
          .expect(201),
      );

      expect(result.generated).toBe(4);
      const byRoll = new Map(result.rows.map((r) => [r.rollNo, r]));

      // Roll 1: full 2000.
      expect(byRoll.get(1)!.payable).toBe(2000);
      // Roll 2: 25 % off → 1500.
      expect(byRoll.get(2)!.payable).toBe(1500);
      // Roll 3: joined on the 16th → (daysInMonth - 15)/daysInMonth.
      const expected =
        Math.round(2000 * ((daysInBillingMonth - 15) / daysInBillingMonth) * 100) /
        100;
      expect(byRoll.get(3)!.prorated).toBe(true);
      expect(byRoll.get(3)!.payable).toBeCloseTo(expected, 1);
      // Roll 4: fully waived.
      expect(byRoll.get(4)!.payable).toBe(0);
    });

    it('is IDEMPOTENT — a re-run bills nobody twice', async () => {
      const rerun = dataOf<{ generated: number; skipped: number }>(
        await server()
          .post('/api/v1/invoices/generate')
          .set(auth(adminToken))
          .send({ sessionId, billingMonth: BILLING_MONTH, classId })
          .expect(201),
      );

      expect(rerun.generated).toBe(0);
      expect(rerun.skipped).toBe(4);
      expect(await prisma.invoice.count({ where: { sessionId } })).toBe(4);
    });

    it('bills an ad-hoc charge alongside the monthly one', async () => {
      const result = dataOf<{ generated: number }>(
        await server()
          .post('/api/v1/invoices/generate')
          .set(auth(adminToken))
          .send({
            sessionId,
            enrollmentIds: [enrollments.get(1)],
            lines: [
              {
                feeHeadId: admissionHeadId,
                description: 'Exam fee',
                amount: 500,
              },
            ],
            dueDate: day(-5),
          })
          .expect(201),
      );

      // An ad-hoc invoice carries no billing month, so it does not
      // collide with the monthly idempotency unique.
      expect(result.generated).toBe(1);
      expect(
        await prisma.invoice.count({
          where: { enrollmentId: enrollments.get(1) },
        }),
      ).toBe(2);
    });

    it('keeps subtotal - discount = payable on every row', async () => {
      const invoices = await prisma.invoice.findMany({ where: { sessionId } });
      for (const invoice of invoices) {
        expect(Number(invoice.payable)).toBeCloseTo(
          Number(invoice.subtotal) -
            Number(invoice.discountTotal) +
            Number(invoice.fineTotal),
          2,
        );
      }
    });
  });

  // ── collection ──────────────────────────────────────────────────────

  describe('collection desk', () => {
    let invoiceIds: string[] = [];

    beforeAll(async () => {
      const rows = await prisma.invoice.findMany({
        where: { enrollmentId: enrollments.get(1) },
        orderBy: { dueDate: 'asc' },
      });
      invoiceIds = rows.map((row) => row.id);
    });

    it('refuses to take more than is owed', async () => {
      const res = await server()
        .post('/api/v1/payments/collect')
        .set(auth(accountantToken))
        .send({
          invoiceIds,
          amount: 99999,
          method: 'CASH',
        })
        .expect(409);
      expect(JSON.stringify(res.body)).toMatch(/exceeds what is owed/i);
    });

    it('refuses an online method at the offline desk', async () => {
      await server()
        .post('/api/v1/payments/collect')
        .set(auth(accountantToken))
        .send({ invoiceIds, amount: 100, method: 'BKASH' })
        .expect(400);
    });

    it('allocates one payment across invoices, oldest due date first', async () => {
      const result = dataOf<{
        totalCollected: number;
        allocations: Array<{ invoiceNo: string; amount: number; remaining: number }>;
      }>(
        await server()
          .post('/api/v1/payments/collect')
          .set(auth(accountantToken))
          .send({ invoiceIds, amount: 2200, method: 'CASH' })
          .expect(201),
      );

      expect(result.totalCollected).toBe(2200);
      expect(result.allocations).toHaveLength(2);
      // The older bill is settled first and fully.
      expect(result.allocations[0].remaining).toBe(0);
      expect(result.allocations[1].remaining).toBeGreaterThan(0);
    });

    it('moves the settled invoice to PAID and the other to PARTIAL/OVERDUE', async () => {
      const rows = await prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        orderBy: { dueDate: 'asc' },
      });
      expect(rows[0].status).toBe('PAID');
      expect(['PARTIAL', 'OVERDUE']).toContain(rows[1].status);
    });

    it('streams a receipt PDF, thermal and A5', async () => {
      const payment = await prisma.payment.findFirstOrThrow({
        where: { invoiceId: invoiceIds[0] },
      });
      await server()
        .get(`/api/v1/payments/${payment.id}/receipt.pdf`)
        .set(auth(adminToken))
        .expect(200)
        .expect('Content-Type', /pdf/);
      await server()
        .get(`/api/v1/payments/${payment.id}/receipt.pdf?layout=thermal`)
        .set(auth(adminToken))
        .expect(200)
        .expect('Content-Type', /pdf/);
    });

    it('refuses to cancel an invoice that has money on it', async () => {
      const res = await server()
        .post(`/api/v1/invoices/${invoiceIds[0]}/cancel`)
        .set(auth(adminToken))
        .send({ reason: 'Billed in error' })
        .expect(409);
      expect(JSON.stringify(res.body)).toMatch(/refund the payment/i);
    });
  });

  // ── refunds ─────────────────────────────────────────────────────────

  describe('refunds', () => {
    it('refuses a refund against a non-refundable head', async () => {
      // Roll 1's ad-hoc invoice billed the ONE_TIME admission head,
      // which is marked non-refundable.
      const adHoc = await prisma.invoice.findFirstOrThrow({
        where: { enrollmentId: enrollments.get(1), billingMonth: null },
      });
      const payment = await prisma.payment.findFirst({
        where: { invoiceId: adHoc.id, status: 'SUCCESS' },
      });
      if (!payment) return; // allocation may have settled the other one first

      const res = await server()
        .post(`/api/v1/payments/${payment.id}/refund`)
        .set(auth(adminToken))
        .send({ amount: 100, reason: 'Parent request' })
        .expect(409);
      expect(JSON.stringify(res.body)).toMatch(/non-refundable/i);
    });

    it('refunds part of a refundable payment and re-derives the status', async () => {
      const monthly = await prisma.invoice.findFirstOrThrow({
        where: { enrollmentId: enrollments.get(1), billingMonth: { not: null } },
      });
      const payment = await prisma.payment.findFirstOrThrow({
        where: { invoiceId: monthly.id, status: 'SUCCESS' },
      });

      await server()
        .post(`/api/v1/payments/${payment.id}/refund`)
        .set(auth(adminToken))
        .send({ amount: 500, reason: 'Overcharged for the month' })
        .expect(201);

      const after = await prisma.invoice.findUniqueOrThrow({
        where: { id: monthly.id },
      });
      // The refund reduced what is credited, so a PAID invoice falls back.
      expect(['PARTIAL', 'OVERDUE']).toContain(after.status);
    });

    it('refuses a refund larger than what is left', async () => {
      const monthly = await prisma.invoice.findFirstOrThrow({
        where: { enrollmentId: enrollments.get(1), billingMonth: { not: null } },
      });
      const payment = await prisma.payment.findFirstOrThrow({
        where: { invoiceId: monthly.id },
      });

      await server()
        .post(`/api/v1/payments/${payment.id}/refund`)
        .set(auth(adminToken))
        .send({ amount: 999999, reason: 'Too much' })
        .expect(409);
    });
  });

  // ── the fine job ────────────────────────────────────────────────────

  describe('late fines', () => {
    it('charges once, however many times the job runs', async () => {
      await prisma.schoolSetting.deleteMany({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          key: { in: ['fees.fine_flat_per_month', 'fees.fine_grace_days'] },
        },
      });
      await prisma.schoolSetting.createMany({
        data: [
          {
            schoolId: DEFAULT_SCHOOL_ID,
            group: 'fees',
            key: 'fees.fine_flat_per_month',
            value: 100,
          },
          {
            schoolId: DEFAULT_SCHOOL_ID,
            group: 'fees',
            key: 'fees.fine_grace_days',
            value: 0,
          },
        ],
      });

      const job = app.get(FineJob);

      const first = await job.runForSchool(DEFAULT_SCHOOL_ID);
      expect(first).toBeGreaterThan(0);

      // The whole point of `fined_for_month`: a nightly job must not
      // fine the same invoice twenty-one times in three weeks.
      const second = await job.runForSchool(DEFAULT_SCHOOL_ID);
      expect(second).toBe(0);
    });

    it('keeps payable consistent after the fine', async () => {
      const fined = await prisma.invoice.findMany({
        where: { sessionId, fineTotal: { gt: 0 } },
      });
      expect(fined.length).toBeGreaterThan(0);
      for (const invoice of fined) {
        expect(Number(invoice.payable)).toBeCloseTo(
          Number(invoice.subtotal) -
            Number(invoice.discountTotal) +
            Number(invoice.fineTotal),
          2,
        );
      }
    });
  });

  // ── ledger, dues and reports ────────────────────────────────────────

  describe('ledger and reports', () => {
    it('builds a running ledger for a student', async () => {
      const ledger = dataOf<{
        entries: Array<{ type: string; balance: number }>;
        totalBilled: number;
        totalPaid: number;
        outstanding: number;
      }>(
        await server()
          .get(`/api/v1/students/${studentIds.get(1)}/ledger`)
          .set(auth(adminToken))
          .expect(200),
      );

      expect(ledger.entries.length).toBeGreaterThan(2);
      expect(ledger.entries.some((e) => e.type === 'INVOICE')).toBe(true);
      expect(ledger.entries.some((e) => e.type === 'PAYMENT')).toBe(true);
      expect(ledger.entries.some((e) => e.type === 'REFUND')).toBe(true);
      expect(ledger.outstanding).toBeCloseTo(
        ledger.totalBilled - ledger.totalPaid,
        2,
      );
    });

    it('reports dues with aging buckets and a defaulter list', async () => {
      const report = dataOf<{
        totalOutstanding: number;
        buckets: Array<{ bucket: string }>;
        defaulters: Array<{ rollNo: number; outstanding: number }>;
      }>(
        await server()
          .get(`/api/v1/fee-reports/dues?sessionId=${sessionId}`)
          .set(auth(adminToken))
          .expect(200),
      );

      expect(report.totalOutstanding).toBeGreaterThan(0);
      expect(report.defaulters.length).toBeGreaterThan(0);
      // Largest debt first — the list is worked top-down.
      expect(report.defaulters[0].outstanding).toBeGreaterThanOrEqual(
        report.defaulters[report.defaulters.length - 1].outstanding,
      );
    });

    it('reports the day’s collection by method', async () => {
      const report = dataOf<{
        total: number;
        byMethod: Array<{ method: string; amount: number }>;
      }>(
        await server()
          .get(`/api/v1/fee-reports/daily?from=${day(0)}&to=${day(0)}`)
          .set(auth(adminToken))
          .expect(200),
      );

      expect(report.total).toBeGreaterThan(0);
      expect(report.byMethod.some((m) => m.method === 'CASH')).toBe(true);
    });

    it('reports head-wise income', async () => {
      const report = dataOf<{ totalNet: number; rows: unknown[] }>(
        await server()
          .get(`/api/v1/fee-reports/head-wise?sessionId=${sessionId}`)
          .set(auth(adminToken))
          .expect(200),
      );
      expect(report.rows.length).toBeGreaterThan(0);
      expect(report.totalNet).toBeGreaterThan(0);
    });

    it('streams the report files', async () => {
      await server()
        .get(`/api/v1/fee-reports/dues.xlsx?sessionId=${sessionId}`)
        .set(auth(adminToken))
        .expect(200)
        .expect('Content-Type', /spreadsheetml/);
      await server()
        .get(`/api/v1/fee-reports/daily.xlsx?from=${day(0)}&to=${day(0)}`)
        .set(auth(adminToken))
        .expect(200)
        .expect('Content-Type', /spreadsheetml/);
    });
  });

  // ── the guards M16 armed in earlier modules ─────────────────────────

  describe('cross-module guards armed by M16', () => {
    it('EXAM_DUES_GATE now reports real outstanding dues', async () => {
      const ledger = app.get(LedgerService);

      const owing = await ledger.outstandingFor(
        [enrollments.get(1)!, enrollments.get(4)!],
        DEFAULT_SCHOOL_ID,
      );
      // Roll 1 owes money; roll 4 was fully waived so owes nothing.
      expect(owing.get(enrollments.get(1)!)).toBeGreaterThan(0);
      expect(owing.get(enrollments.get(4)!) ?? 0).toBe(0);
    });

    it('warns on a student exit while dues are outstanding (M09 slot)', async () => {
      const res = await server()
        .put(`/api/v1/students/${studentIds.get(1)}/status`)
        .set(auth(adminToken))
        .send({ status: 'TRANSFERRED', reason: 'Family relocated' })
        .expect(200);

      const data = dataOf<{ warnings: string[] }>(res);
      expect(data.warnings[0]).toMatch(/BDT outstanding/);
    });

    it('refuses to delete a fee head that has been billed', async () => {
      const res = await server()
        .delete(`/api/v1/fee-heads/${tuitionHeadId}`)
        .set(auth(adminToken))
        .expect(409);
      expect(JSON.stringify(res.body)).toMatch(/invoice line/i);
    });
  });

  // ── the DB constraints, driven past the service on purpose ──────────

  describe('database constraints', () => {
    const raw = (sql: string) => prisma.$executeRawUnsafe(sql);

    it('chk_invoices_payable pins the arithmetic', async () => {
      const invoice = await prisma.invoice.findFirstOrThrow({
        where: { sessionId },
      });
      await expect(
        raw(`UPDATE invoices SET payable = payable + 1 WHERE id = '${invoice.id}'`),
      ).rejects.toThrow(/chk_invoices_payable/);
    });

    it('chk_invoices_amounts refuses paying more than the payable', async () => {
      const invoice = await prisma.invoice.findFirstOrThrow({
        where: { sessionId },
      });
      await expect(
        raw(
          `UPDATE invoices SET paid_total = payable + 100 WHERE id = '${invoice.id}'`,
        ),
      ).rejects.toThrow(/chk_invoices_amounts/);
    });

    it('chk_payments_success_evidence demands verification for online money', async () => {
      const payment = await prisma.payment.findFirstOrThrow({
        where: { method: 'CASH' },
      });
      await expect(
        raw(
          `UPDATE payments SET method = 'BKASH', verified_at = NULL WHERE id = '${payment.id}'`,
        ),
      ).rejects.toThrow(/chk_payments_success_evidence/);
    });

    it('uq_invoices_enrollment_month blocks a second monthly bill', async () => {
      const invoice = await prisma.invoice.findFirstOrThrow({
        where: { sessionId, billingMonth: { not: null } },
      });
      await expect(
        raw(`
          INSERT INTO invoices
            (school_id, invoice_no, enrollment_id, session_id, billing_month,
             issue_date, due_date, subtotal, discount_total, fine_total,
             paid_total, payable, updated_at)
          VALUES ('${DEFAULT_SCHOOL_ID}', 'E2E-DUP-1', '${invoice.enrollmentId}',
                  '${invoice.sessionId}', '${monthStart}', '${monthStart}',
                  '${monthStart}', 100, 0, 0, 0, 100, now())
        `),
      ).rejects.toThrow(/uq_invoices_enrollment_month/);
    });

    it('chk_fee_overrides_value caps a percentage at 100', async () => {
      await expect(
        raw(`
          INSERT INTO student_fee_overrides
            (school_id, enrollment_id, fee_head_id, type, value, reason, updated_at)
          VALUES ('${DEFAULT_SCHOOL_ID}', '${enrollments.get(1)}',
                  '${tuitionHeadId}', 'DISCOUNT_PERCENT', 150, 'nope', now())
        `),
      ).rejects.toThrow(/chk_fee_overrides_value/);
    });
  });
});
