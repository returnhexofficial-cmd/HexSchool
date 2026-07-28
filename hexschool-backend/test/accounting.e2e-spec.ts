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
import { seedChartOfAccounts } from '../src/modules/accounting/seed/accounting.seeder';
import { AutoPostingService } from '../src/modules/accounting/services/auto-posting.service';

/**
 * Requires dev infra (DB + redis). The M20 loop in the order a school
 * lives it: name the accounts, raise a voucher, discover it will not post
 * until it balances, post it, read the trial balance, cancel one and
 * watch the reversal appear, then close the period and find it locked.
 *
 * The centrepiece is the roadmap §9 e2e requirement — **"payment event →
 * auto voucher → appears in cash book & income statement"** — driven
 * through the real M16 collection desk, because the only thing that
 * proves the two modules are wired is money actually moving.
 *
 * Everything is created under `E2E-ACC` / `E2EACC` prefixes and removed
 * in afterAll.
 */
describe('Accounting & Finance (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-acc-admin@test.local';
  const ACCOUNTANT = 'e2e-acc-accountant@test.local';
  const PLAIN = 'e2e-acc-plain@test.local';
  const NAME = 'E2EACC';

  let adminToken: string;
  let accountantToken: string;
  let plainToken: string;

  let sessionId: string;
  let classId: string;
  let sectionId: string;
  let enrollmentId: string;
  let tuitionHeadId: string;

  /** Seeded chart accounts, by code. */
  const account = new Map<string, string>();

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;
  /** The error envelope's message (the M19 e2e accessor convention). */
  const errorOf = (res: request.Response): string =>
    (res.body as { error: { message: string } }).error.message;

  const day = (offset: number): string => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const cleanup = async () => {
    // Vouchers first — accounts are FK-restricted behind their entries.
    await prisma.voucher.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        OR: [
          { narration: { contains: NAME } },
          { reference: { contains: NAME } },
          { source: { not: 'MANUAL' } },
        ],
      },
    });
    await prisma.budget.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, note: { contains: NAME } },
    });
    await prisma.fiscalPeriod.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E-ACC' } },
    });
    await prisma.account.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, code: { startsWith: 'E2EACC' } },
    });
    await prisma.academicSession.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E-ACC ' } },
    });
    await prisma.student.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: NAME },
    });
    await prisma.feeHead.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E ACC ' } },
    });
    await prisma.schoolClass.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: { startsWith: 'E2E ACCClass' },
      },
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

    for (const [email, target] of [
      [ADMIN, 'admin'],
      [ACCOUNTANT, 'accountant'],
      [PLAIN, 'plain'],
    ] as const) {
      const res = await server()
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);
      const token = dataOf<{ accessToken: string }>(res).accessToken;
      if (target === 'admin') adminToken = token;
      else if (target === 'accountant') accountantToken = token;
      else plainToken = token;
    }

    // The default chart is seeded per school; make sure it exists for
    // this run (the seeder is idempotent and skips a school that already
    // keeps accounts).
    await seedChartOfAccounts(prisma, DEFAULT_SCHOOL_ID);

    for (const row of await prisma.account.findMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, deletedAt: null },
      select: { id: true, code: true },
    })) {
      account.set(row.code, row.id);
    }

    // ── the M16 fixture the auto-posting test drives ──────────────────
    const session = await prisma.academicSession.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `E2E-ACC ${new Date().getUTCFullYear()}`,
        startDate: new Date(day(-200)),
        endDate: new Date(day(160)),
        status: 'ACTIVE',
      },
    });
    sessionId = session.id;

    const klass = await prisma.schoolClass.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: 'E2E ACCClassA',
        numericLevel: 17,
      },
    });
    classId = klass.id;

    const section = await prisma.section.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        sessionId,
        classId,
        name: 'A',
        capacity: 40,
      },
    });
    sectionId = section.id;

    const student = await prisma.student.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        studentUid: `${NAME}-${Date.now()}`,
        firstName: NAME,
        lastName: 'Student',
        gender: 'MALE',
        dob: new Date('2012-01-01'),
        admissionDate: new Date(day(-190)),
        admissionClassId: classId,
        qrToken: randomUUID(),
      },
    });

    const enrollment = await prisma.enrollment.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        studentId: student.id,
        sessionId,
        classId,
        sectionId,
        rollNo: 1,
        enrollmentDate: new Date(day(-190)),
      },
    });
    enrollmentId = enrollment.id;

    const head = await prisma.feeHead.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: 'E2E ACC Tuition',
        type: 'RECURRING_MONTHLY',
      },
    });
    tuitionHeadId = head.id;
  });

  afterAll(async () => {
    await cleanup();
    await app?.close();
  });

  // ── chart of accounts ───────────────────────────────────────────────

  describe('chart of accounts', () => {
    let branchId: string;

    it('serves the seeded BD tree, nested by group', async () => {
      const res = await server()
        .get('/api/v1/accounts/tree')
        .set(auth(accountantToken))
        .expect(200);

      const tree = dataOf<{
        groups: Array<{ group: string; roots: unknown[] }>;
      }>(res);
      expect(tree.groups.map((g) => g.group)).toEqual([
        'ASSET',
        'LIABILITY',
        'EQUITY',
        'INCOME',
        'EXPENSE',
      ]);
      expect(tree.groups[0].roots.length).toBeGreaterThan(0);
    });

    it('suggests the next free code under a parent', async () => {
      const res = await server()
        .get('/api/v1/accounts/suggest-code')
        .query({ group: 'INCOME', parentId: account.get('4000') })
        .set(auth(accountantToken))
        .expect(200);
      const code = dataOf<{ code: string }>(res).code;
      // It must sit inside the income band and collide with nothing —
      // a suggestion that collides is worse than an ugly one.
      expect(Number(code)).toBeGreaterThan(4000);
      expect(Number(code)).toBeLessThan(5000);
      expect(account.has(code)).toBe(false);
    });

    it('creates a leaf under a heading and inherits its group', async () => {
      const res = await server()
        .post('/api/v1/accounts')
        .set(auth(accountantToken))
        .send({
          // The group is deliberately WRONG in the request — the parent
          // wins, because an expense filed under Assets would silently
          // move money between two statements.
          group: 'ASSET',
          parentId: account.get('4000'),
          code: 'E2EACC-INC',
          name: 'E2E Extra Income',
          type: 'INCOME',
        })
        .expect(201);
      const created = dataOf<{ id: string; group: string }>(res);
      expect(created.group).toBe('INCOME');
      branchId = created.id;
      account.set('E2EACC-INC', created.id);
    });

    it('refuses a duplicate code among live accounts', async () => {
      await server()
        .post('/api/v1/accounts')
        .set(auth(accountantToken))
        .send({
          group: 'INCOME',
          code: 'E2EACC-INC',
          name: 'Another',
        })
        .expect(409);
    });

    it('refuses a heading carrying an opening balance', async () => {
      await server()
        .post('/api/v1/accounts')
        .set(auth(accountantToken))
        .send({
          group: 'ASSET',
          code: 'E2EACC-GRP',
          name: 'E2E Heading',
          isGroup: true,
          openingBalance: 500,
        })
        .expect(400);
    });

    it('refuses to delete a system account', async () => {
      await server()
        .delete(`/api/v1/accounts/${account.get('1110')}`)
        .set(auth(accountantToken))
        .expect(409);
    });

    it('refuses to deactivate a system account', async () => {
      await server()
        .patch(`/api/v1/accounts/${account.get('1110')}`)
        .set(auth(accountantToken))
        .send({ isActive: false })
        .expect(409);
    });

    it('deletes an unused account', async () => {
      await server()
        .delete(`/api/v1/accounts/${branchId}`)
        .set(auth(accountantToken))
        .expect(204);
      account.delete('E2EACC-INC');
    });

    it('403s a user with no accounting permission', async () => {
      await server().get('/api/v1/accounts').set(auth(plainToken)).expect(403);
    });
  });

  // ── vouchers ────────────────────────────────────────────────────────

  describe('vouchers', () => {
    let draftId: string;
    let postedId: string;

    it('refuses an unbalanced voucher with both totals named', async () => {
      const res = await server()
        .post('/api/v1/vouchers')
        .set(auth(accountantToken))
        .send({
          type: 'JOURNAL',
          date: day(-1),
          narration: `${NAME} unbalanced`,
          entries: [
            { accountId: account.get('1110'), debit: 1000, credit: 0 },
            { accountId: account.get('4100'), debit: 0, credit: 900 },
          ],
        })
        .expect(409);
      expect(errorOf(res)).toContain('differ by 100.00');
    });

    it('refuses posting to a heading (leaf-only rule)', async () => {
      const res = await server()
        .post('/api/v1/vouchers')
        .set(auth(accountantToken))
        .send({
          type: 'JOURNAL',
          date: day(-1),
          narration: `${NAME} heading`,
          entries: [
            { accountId: account.get('1000'), debit: 100, credit: 0 },
            { accountId: account.get('4100'), debit: 0, credit: 100 },
          ],
        })
        .expect(409);
      expect(errorOf(res)).toContain('is a heading');
    });

    it('refuses a future-dated voucher', async () => {
      await server()
        .post('/api/v1/vouchers')
        .set(auth(accountantToken))
        .send({
          type: 'JOURNAL',
          date: day(3),
          narration: `${NAME} future`,
          entries: [
            { accountId: account.get('1110'), debit: 100, credit: 0 },
            { accountId: account.get('4100'), debit: 0, credit: 100 },
          ],
        })
        .expect(400);
    });

    it('refuses a contra touching a non-funds account', async () => {
      const res = await server()
        .post('/api/v1/vouchers')
        .set(auth(accountantToken))
        .send({
          type: 'CONTRA',
          date: day(-1),
          narration: `${NAME} bad contra`,
          entries: [
            { accountId: account.get('1210'), debit: 500, credit: 0 },
            { accountId: account.get('4100'), debit: 0, credit: 500 },
          ],
        })
        .expect(409);
      expect(errorOf(res)).toContain('CASH or BANK');
    });

    it('saves a balanced draft and numbers it per type', async () => {
      const res = await server()
        .post('/api/v1/vouchers')
        .set(auth(accountantToken))
        .send({
          type: 'JOURNAL',
          date: day(-2),
          narration: `${NAME} salary accrual`,
          entries: [
            { accountId: account.get('5100'), debit: 80000, credit: 0 },
            { accountId: account.get('2110'), debit: 0, credit: 80000 },
          ],
        })
        .expect(201);
      const voucher = dataOf<{
        id: string;
        status: string;
        voucherNo: string;
      }>(res);
      expect(voucher.status).toBe('DRAFT');
      expect(voucher.voucherNo).toMatch(/^JV-\d{2}-\d{5}$/);
      draftId = voucher.id;
    });

    it('posts the draft', async () => {
      const res = await server()
        .post(`/api/v1/vouchers/${draftId}/post`)
        .set(auth(accountantToken))
        .expect(201);
      expect(dataOf<{ status: string }>(res).status).toBe('POSTED');
    });

    it('refuses to edit a posted voucher', async () => {
      const res = await server()
        .patch(`/api/v1/vouchers/${draftId}`)
        .set(auth(accountantToken))
        .send({ narration: `${NAME} edited` })
        .expect(409);
      expect(errorOf(res)).toContain('cancel it');
    });

    it('creates and posts a receipt in one call', async () => {
      const res = await server()
        .post('/api/v1/vouchers')
        .set(auth(accountantToken))
        .send({
          type: 'CREDIT',
          date: day(-2),
          narration: `${NAME} donation received`,
          entries: [
            { accountId: account.get('1110'), debit: 25000, credit: 0 },
            { accountId: account.get('4300'), debit: 0, credit: 25000 },
          ],
          post: true,
        })
        .expect(201);
      const voucher = dataOf<{ id: string; status: string }>(res);
      expect(voucher.status).toBe('POSTED');
      postedId = voucher.id;
    });

    it('403s the accountant on cancel — separation of duties', async () => {
      // The seeded Accountant baseline deliberately excludes
      // `voucher.cancel`: reversing a posted voucher is the head's call.
      await server()
        .post(`/api/v1/vouchers/${postedId}/cancel`)
        .set(auth(accountantToken))
        .send({ reason: 'Entered twice' })
        .expect(403);
    });

    it('cancelling a posted voucher writes a mirror-image reversal', async () => {
      const res = await server()
        .post(`/api/v1/vouchers/${postedId}/cancel`)
        .set(auth(adminToken))
        .send({ reason: `${NAME} entered twice` })
        .expect(201);

      const result = dataOf<{
        voucher: { status: string };
        reversal: { id: string; type: string; voucherNo: string };
      }>(res);
      expect(result.voucher.status).toBe('CANCELLED');
      // A receipt reverses as a payment.
      expect(result.reversal.type).toBe('DEBIT');

      const reversal = await prisma.voucher.findUnique({
        where: { id: result.reversal.id },
        include: { entries: true },
      });
      const cash = reversal!.entries.find(
        (entry) => entry.accountId === account.get('1110'),
      );
      // The original debited cash 25,000; the reversal credits it.
      expect(Number(cash!.credit)).toBe(25000);
      expect(Number(cash!.debit)).toBe(0);
      expect(reversal!.reversalOfVoucherId).toBe(postedId);
    });

    it('refuses to cancel the same voucher twice', async () => {
      await server()
        .post(`/api/v1/vouchers/${postedId}/cancel`)
        .set(auth(adminToken))
        .send({ reason: 'again' })
        .expect(409);
    });

    it('requires a reason to cancel', async () => {
      await server()
        .post(`/api/v1/vouchers/${draftId}/cancel`)
        .set(auth(adminToken))
        .send({})
        .expect(400);
    });
  });

  // ── the roadmap §9 e2e requirement ──────────────────────────────────

  describe('payment event → auto voucher → cash book & income statement', () => {
    let invoiceId: string;
    let autoVoucherNo: string;

    it('maps the tuition head to an income account', async () => {
      await server()
        .put('/api/v1/accounting/posting-map')
        .set(auth(accountantToken))
        .send({
          mappings: [
            {
              kind: 'FEE_HEAD',
              refKey: tuitionHeadId,
              accountId: account.get('4100'),
            },
            {
              kind: 'PAYMENT_METHOD',
              refKey: 'CASH',
              accountId: account.get('1110'),
            },
          ],
        })
        .expect(200);
    });

    it('refuses a posting-map target that is a heading', async () => {
      await server()
        .put('/api/v1/accounting/posting-map')
        .set(auth(accountantToken))
        .send({
          mappings: [
            {
              kind: 'FEE_HEAD',
              refKey: tuitionHeadId,
              accountId: account.get('4000'),
            },
          ],
        })
        .expect(409);
    });

    it('bills the student', async () => {
      const res = await server()
        .post('/api/v1/invoices/generate')
        .set(auth(accountantToken))
        .send({
          sessionId,
          enrollmentIds: [enrollmentId],
          // An ad-hoc invoice is issued today, so the due date cannot be
          // in the past — the fee module refuses that outright.
          dueDate: day(7),
          lines: [
            {
              feeHeadId: tuitionHeadId,
              description: 'Tuition',
              amount: 3000,
            },
          ],
        })
        .expect(201);
      expect(dataOf<{ generated: number }>(res).generated).toBe(1);

      const invoice = await prisma.invoice.findFirst({
        where: { enrollmentId, deletedAt: null },
        select: { id: true },
      });
      invoiceId = invoice!.id;
    });

    it('takes the money at the desk and posts a voucher for it', async () => {
      await server()
        .post('/api/v1/payments/collect')
        .set(auth(accountantToken))
        .send({
          invoiceIds: [invoiceId],
          amount: 3000,
          method: 'CASH',
          paidOn: day(-3),
        })
        .expect(201);

      // The listener is in-process but asynchronous; give it a beat.
      await waitFor(async () => {
        const voucher = await prisma.voucher.findFirst({
          where: { schoolId: DEFAULT_SCHOOL_ID, source: 'FEES' },
          include: { entries: true },
        });
        expect(voucher).not.toBeNull();
        expect(voucher!.status).toBe('POSTED');
        expect(voucher!.type).toBe('CREDIT');
        expect(voucher!.sourceRef).toMatch(/^payment:/);

        const debit = voucher!.entries.find((entry) => Number(entry.debit) > 0);
        const credit = voucher!.entries.find(
          (entry) => Number(entry.credit) > 0,
        );
        // Dr Cash in Hand 3,000 / Cr Tuition Fee Income 3,000.
        expect(debit!.accountId).toBe(account.get('1110'));
        expect(Number(debit!.debit)).toBe(3000);
        expect(credit!.accountId).toBe(account.get('4100'));
        expect(Number(credit!.credit)).toBe(3000);

        autoVoucherNo = voucher!.voucherNo;
      });
    });

    it('a replayed event does not double-post (source_ref idempotency)', async () => {
      const payment = await prisma.payment.findFirst({
        where: { invoiceId },
        select: { id: true },
      });

      const autoPosting = app.get(AutoPostingService);
      const again = await autoPosting.postPayment(
        DEFAULT_SCHOOL_ID,
        payment!.id,
      );
      expect(again?.voucherNo).toBe(autoVoucherNo);

      const count = await prisma.voucher.count({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          sourceRef: `payment:${payment!.id}`,
        },
      });
      expect(count).toBe(1);
    });

    it('shows up in the cash book as a receipt', async () => {
      const res = await server()
        .get('/api/v1/accounting/reports/cash-book')
        .query({ from: day(-10), to: day(0), accountId: account.get('1110') })
        .set(auth(accountantToken))
        .expect(200);

      const book = dataOf<{
        rows: Array<{ voucherNo: string; receipt: number }>;
        receiptTotal: number;
      }>(res);
      const row = book.rows.find((r) => r.voucherNo === autoVoucherNo);
      expect(row?.receipt).toBe(3000);
    });

    it('shows up in the income statement as tuition income', async () => {
      const res = await server()
        .get('/api/v1/accounting/reports/income-statement')
        .query({ from: day(-10), to: day(0) })
        .set(auth(accountantToken))
        .expect(200);

      const statement = dataOf<{
        income: Array<{ code: string; amount: number }>;
        incomeTotal: number;
      }>(res);
      const tuition = statement.income.find((line) => line.code === '4100');
      expect(tuition?.amount).toBe(3000);
    });

    it('a refund reverses it', async () => {
      const payment = await prisma.payment.findFirst({
        where: { invoiceId, status: 'SUCCESS' },
        select: { id: true },
      });

      await server()
        .post(`/api/v1/payments/${payment!.id}/refund`)
        .set(auth(adminToken))
        .send({ amount: 1000, reason: `${NAME} overcharged` })
        .expect(201);

      await waitFor(async () => {
        const reversal = await prisma.voucher.findFirst({
          where: {
            schoolId: DEFAULT_SCHOOL_ID,
            sourceRef: { startsWith: 'refund:' },
          },
          include: { entries: true },
        });
        expect(reversal).not.toBeNull();
        expect(reversal!.type).toBe('DEBIT');

        const cash = reversal!.entries.find(
          (entry) => entry.accountId === account.get('1110'),
        );
        // A third of the payment goes back, so cash is credited 1,000.
        expect(Number(cash!.credit)).toBe(1000);
      });
    });

    it('nets the refund off the income statement', async () => {
      const res = await server()
        .get('/api/v1/accounting/reports/income-statement')
        .query({ from: day(-10), to: day(0) })
        .set(auth(accountantToken))
        .expect(200);
      const statement = dataOf<{
        income: Array<{ code: string; amount: number }>;
      }>(res);
      const tuition = statement.income.find((line) => line.code === '4100');
      expect(tuition?.amount).toBe(2000);
    });
  });

  // ── the statements reconcile ────────────────────────────────────────

  describe('reports', () => {
    it('the trial balance balances', async () => {
      const res = await server()
        .get('/api/v1/accounting/reports/trial-balance')
        .query({ from: day(-30), to: day(0) })
        .set(auth(accountantToken))
        .expect(200);

      const tb = dataOf<{
        balanced: boolean;
        difference: number;
        debitTotal: number;
        creditTotal: number;
      }>(res);
      expect(tb.balanced).toBe(true);
      expect(tb.difference).toBe(0);
      expect(tb.debitTotal).toBe(tb.creditTotal);
    });

    it('the balance sheet balances once the surplus is carried', async () => {
      const res = await server()
        .get('/api/v1/accounting/reports/balance-sheet')
        .query({ from: day(-30), to: day(0) })
        .set(auth(accountantToken))
        .expect(200);
      const bs = dataOf<{ balanced: boolean; difference: number }>(res);
      expect(bs.balanced).toBe(true);
      expect(bs.difference).toBe(0);
    });

    it('the three statements agree with each other', async () => {
      const [tbRes, isRes, bsRes] = await Promise.all([
        server()
          .get('/api/v1/accounting/reports/trial-balance')
          .query({ from: day(-30), to: day(0) })
          .set(auth(accountantToken)),
        server()
          .get('/api/v1/accounting/reports/income-statement')
          .query({ from: day(-30), to: day(0) })
          .set(auth(accountantToken)),
        server()
          .get('/api/v1/accounting/reports/balance-sheet')
          .query({ from: day(-30), to: day(0) })
          .set(auth(accountantToken)),
      ]);

      const tb = dataOf<{ debitTotal: number; creditTotal: number }>(tbRes);
      const is = dataOf<{ incomeTotal: number; expenseTotal: number }>(isRes);
      const bs = dataOf<{
        assetTotal: number;
        liabilityTotal: number;
        equityTotal: number;
      }>(bsRes);

      expect(tb.debitTotal).toBeCloseTo(bs.assetTotal + is.expenseTotal, 2);
      expect(tb.creditTotal).toBeCloseTo(
        bs.liabilityTotal + bs.equityTotal + is.incomeTotal,
        2,
      );
    });

    it('the general ledger runs a balance forward', async () => {
      const res = await server()
        .get('/api/v1/accounting/reports/ledger')
        .query({
          from: day(-30),
          to: day(0),
          accountId: account.get('1110'),
        })
        .set(auth(accountantToken))
        .expect(200);

      const ledger = dataOf<{
        rows: Array<{ balance: number; balanceSide: string }>;
        closingBalance: number;
        closingSide: string;
      }>(res);
      expect(ledger.rows.length).toBeGreaterThan(0);
      expect(ledger.closingSide).toBe('DEBIT');
      expect(ledger.rows.at(-1)?.balance).toBe(ledger.closingBalance);
    });

    it('receipts & payments derives its closing figure from its own lines', async () => {
      const res = await server()
        .get('/api/v1/accounting/reports/receipts-payments')
        .query({ from: day(-30), to: day(0) })
        .set(auth(accountantToken))
        .expect(200);
      const rp = dataOf<{
        openingCash: number;
        receiptTotal: number;
        paymentTotal: number;
        closingCash: number;
      }>(res);
      expect(rp.closingCash).toBeCloseTo(
        rp.openingCash + rp.receiptTotal - rp.paymentTotal,
        2,
      );
    });

    it('exports the trial balance as XLSX', async () => {
      const res = await server()
        .get('/api/v1/accounting/reports/trial-balance.xlsx')
        .query({ from: day(-30), to: day(0) })
        .set(auth(accountantToken))
        .expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      // supertest only buffers known binary types — assert on the header
      // (the M12 attendance-export convention).
      expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
      expect(res.headers['content-disposition']).toContain('.xlsx');
    });

    it('403s a report request without accounting.report', async () => {
      await server()
        .get('/api/v1/accounting/reports/trial-balance')
        .set(auth(plainToken))
        .expect(403);
    });
  });

  // ── budgets ─────────────────────────────────────────────────────────

  describe('budgets', () => {
    let budgetId: string;

    it('refuses a budget on an asset account', async () => {
      await server()
        .post('/api/v1/budgets')
        .set(auth(accountantToken))
        .send({
          sessionId,
          accountId: account.get('1110'),
          amount: 1000,
          note: NAME,
        })
        .expect(400);
    });

    it('creates a yearly budget on an income account', async () => {
      const res = await server()
        .post('/api/v1/budgets')
        .set(auth(accountantToken))
        .send({
          sessionId,
          accountId: account.get('4100'),
          period: 'YEARLY',
          amount: 1000,
          note: NAME,
        })
        .expect(201);
      budgetId = dataOf<{ id: string }>(res).id;
    });

    it('refuses a second yearly budget for the same account', async () => {
      await server()
        .post('/api/v1/budgets')
        .set(auth(accountantToken))
        .send({
          sessionId,
          accountId: account.get('4100'),
          period: 'YEARLY',
          amount: 500,
          note: NAME,
        })
        .expect(409);
    });

    it('reports the variance and reads its sign by group', async () => {
      const res = await server()
        .get('/api/v1/accounting/reports/budget-vs-actual')
        .query({ sessionId, from: day(-30), to: day(0) })
        .set(auth(accountantToken))
        .expect(200);

      const report = dataOf<{
        rows: Array<{ code: string; actual: number; favourable: boolean }>;
      }>(res);
      const tuition = report.rows.find((row) => row.code === '4100');
      // Budgeted 1,000, earned 2,000 net of the refund — income over
      // budget is good news.
      expect(tuition?.actual).toBe(2000);
      expect(tuition?.favourable).toBe(true);
    });

    it('removes the budget line', async () => {
      await server()
        .delete(`/api/v1/budgets/${budgetId}`)
        .set(auth(accountantToken))
        .expect(204);
    });
  });

  // ── period close ────────────────────────────────────────────────────

  describe('fiscal periods', () => {
    let periodId: string;
    let draftInRange: string;

    it('creates a period', async () => {
      const res = await server()
        .post('/api/v1/fiscal-periods')
        .set(auth(accountantToken))
        .send({
          name: 'E2E-ACC FY',
          startDate: day(-60),
          endDate: day(-1),
        })
        .expect(201);
      periodId = dataOf<{ id: string }>(res).id;
    });

    it('refuses an overlapping period', async () => {
      const res = await server()
        .post('/api/v1/fiscal-periods')
        .set(auth(accountantToken))
        .send({
          name: 'E2E-ACC Overlap',
          startDate: day(-30),
          endDate: day(10),
        })
        .expect(409);
      expect(errorOf(res)).toContain('overlaps');
    });

    it('refuses to close over an unposted draft', async () => {
      const res = await server()
        .post('/api/v1/vouchers')
        .set(auth(accountantToken))
        .send({
          type: 'JOURNAL',
          date: day(-10),
          narration: `${NAME} unfinished`,
          entries: [
            { accountId: account.get('5900'), debit: 50, credit: 0 },
            { accountId: account.get('1110'), debit: 0, credit: 50 },
          ],
        })
        .expect(201);
      draftInRange = dataOf<{ id: string }>(res).id;

      const close = await server()
        .post(`/api/v1/fiscal-periods/${periodId}/close`)
        .set(auth(accountantToken))
        .send({})
        .expect(409);
      expect(errorOf(close)).toContain('draft voucher');
    });

    it('closes once the draft is dealt with', async () => {
      await server()
        .post(`/api/v1/vouchers/${draftInRange}/cancel`)
        .set(auth(adminToken))
        .send({ reason: `${NAME} abandoned` })
        .expect(201);

      const res = await server()
        .post(`/api/v1/fiscal-periods/${periodId}/close`)
        .set(auth(accountantToken))
        .send({ note: `${NAME} year end` })
        .expect(201);
      expect(dataOf<{ status: string }>(res).status).toBe('CLOSED');
    });

    it('a voucher dated inside a closed period posts into the next open one with a note', async () => {
      // Roadmap §8, the documented BD behaviour: the money genuinely
      // arrived, so refusing it would leave real cash outside the books.
      const next = await server()
        .post('/api/v1/fiscal-periods')
        .set(auth(accountantToken))
        .send({
          name: 'E2E-ACC Next',
          startDate: day(0),
          endDate: day(120),
        })
        .expect(201);
      const nextId = dataOf<{ id: string }>(next).id;

      const res = await server()
        .post('/api/v1/vouchers')
        .set(auth(accountantToken))
        .send({
          type: 'CREDIT',
          date: day(-30),
          narration: `${NAME} late receipt`,
          entries: [
            { accountId: account.get('1110'), debit: 700, credit: 0 },
            { accountId: account.get('4900'), debit: 0, credit: 700 },
          ],
          post: true,
        })
        .expect(201);

      const voucher = dataOf<{
        narration: string;
        fiscalPeriodId: string | null;
      }>(res);
      expect(voucher.narration).toContain('was closed');
      expect(voucher.fiscalPeriodId).toBe(nextId);
    });

    it('refuses outright when there is no open period to fall into', async () => {
      await prisma.fiscalPeriod.updateMany({
        where: { schoolId: DEFAULT_SCHOOL_ID, name: 'E2E-ACC Next' },
        data: { status: 'CLOSED', closedAt: new Date() },
      });

      const res = await server()
        .post('/api/v1/vouchers')
        .set(auth(accountantToken))
        .send({
          type: 'CREDIT',
          date: day(-30),
          narration: `${NAME} stranded receipt`,
          entries: [
            { accountId: account.get('1110'), debit: 50, credit: 0 },
            { accountId: account.get('4900'), debit: 0, credit: 50 },
          ],
          post: true,
        })
        .expect(409);
      expect(errorOf(res)).toContain('no open period');

      await prisma.fiscalPeriod.updateMany({
        where: { schoolId: DEFAULT_SCHOOL_ID, name: 'E2E-ACC Next' },
        data: { status: 'OPEN', closedAt: null },
      });
    });

    it('403s the accountant on reopen — a separate permission by design', async () => {
      await server()
        .post(`/api/v1/fiscal-periods/${periodId}/reopen`)
        .set(auth(accountantToken))
        .send({ reason: 'correction needed' })
        .expect(403);
    });

    it('reopens for the head, with a reason', async () => {
      const res = await server()
        .post(`/api/v1/fiscal-periods/${periodId}/reopen`)
        .set(auth(adminToken))
        .send({ reason: `${NAME} audit correction` })
        .expect(201);
      expect(dataOf<{ status: string }>(res).status).toBe('OPEN');
    });
  });

  // ── the §8 tools ────────────────────────────────────────────────────

  describe('gateway settlement and opening balances (§8)', () => {
    it('settles a clearing account net of commission', async () => {
      const res = await server()
        .post('/api/v1/vouchers/tools/settlement')
        .set(auth(adminToken))
        .send({
          clearingAccountId: account.get('1310'),
          bankAccountId: account.get('1210'),
          gross: 10000,
          charges: 185,
          date: day(-1),
          reference: `${NAME}-SETTLE`,
        })
        .expect(201);

      const voucher = dataOf<{
        status: string;
        entries: Array<{ accountId: string; debit: string; credit: string }>;
      }>(res);
      expect(voucher.status).toBe('POSTED');

      const bank = voucher.entries.find(
        (entry) => entry.accountId === account.get('1210'),
      );
      const charges = voucher.entries.find(
        (entry) => entry.accountId === account.get('5600'),
      );
      const clearing = voucher.entries.find(
        (entry) => entry.accountId === account.get('1310'),
      );
      expect(Number(bank!.debit)).toBe(9815);
      expect(Number(charges!.debit)).toBe(185);
      expect(Number(clearing!.credit)).toBe(10000);
    });

    it('refuses a commission larger than the gross', async () => {
      await server()
        .post('/api/v1/vouchers/tools/settlement')
        .set(auth(adminToken))
        .send({
          clearingAccountId: account.get('1310'),
          bankAccountId: account.get('1210'),
          gross: 100,
          charges: 500,
          date: day(-1),
        })
        .expect(400);
    });

    it('balances an incomplete opening set through the equity account', async () => {
      const res = await server()
        .post('/api/v1/vouchers/tools/opening-balances')
        .set(auth(adminToken))
        .send({
          date: day(-1),
          narration: `${NAME} opening balances`,
          lines: [
            { accountId: account.get('1120'), debit: 5000, credit: 0 },
            { accountId: account.get('1220'), debit: 45000, credit: 0 },
          ],
        })
        .expect(201);

      const voucher = dataOf<{
        entries: Array<{ accountId: string; credit: string }>;
      }>(res);
      const equity = voucher.entries.find(
        (entry) => entry.accountId === account.get('3100'),
      );
      expect(Number(equity!.credit)).toBe(50000);
    });

    it('the trial balance still balances afterwards', async () => {
      const res = await server()
        .get('/api/v1/accounting/reports/trial-balance')
        .query({ from: day(-60), to: day(0) })
        .set(auth(accountantToken))
        .expect(200);
      expect(dataOf<{ balanced: boolean }>(res).balanced).toBe(true);
    });
  });
});

/**
 * The auto-posting listener is in-process but asynchronous — the fee
 * mutation returns before the voucher exists. Polling is how M15's
 * audit-row assertion was fixed; reading once here would be flaky by
 * construction.
 */
async function waitFor(
  assertion: () => Promise<void>,
  attempts = 25,
  delayMs = 120,
): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await assertion();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
