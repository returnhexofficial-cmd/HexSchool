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
import { seedNotificationTemplates } from '../src/modules/communication/seed/communication.seeder';

/**
 * Requires dev infra (DB + redis). Exercises the M17 surface end to end:
 * template CRUD + validation + preview, the single send entry point
 * driven to a real SENT row (through the log-only SMS fallback, which is
 * the deterministic seam — the gateway is unconfigured in test),
 * the in-app inbox, notices, SMS-credit accounting, the DLR webhook, the
 * bulk audience preview, and the raw DB constraints.
 *
 * Delivery is async through the BullMQ worker (the sole dispatcher — a
 * single locked job, so no double-processing); the tests enqueue via the
 * HTTP entry point and poll the row until the worker settles it.
 *
 * Everything is created under `E2E-COMM` / `0199…` markers and removed in
 * afterAll (SMS-credit rows too, so a later suite's raw sends stay
 * unmetered).
 */
describe('Communication & Notifications (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  /** Poll a notification until it reaches `status` (the worker settles it). */
  const waitForStatus = async (
    id: string,
    status: string,
    timeoutMs = 8000,
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const row = await prisma.notification.findUnique({ where: { id } });
      if (row?.status === status) return;
      await new Promise((r) => setTimeout(r, 120));
    }
    throw new Error(`notification ${id} did not reach ${status} in time`);
  };

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-comm-admin@test.local';
  const PLAIN = 'e2e-comm-plain@test.local';
  const NAME = 'E2ECOMM';

  let adminToken: string;
  let plainToken: string;
  let adminUserId: string;

  let sessionId: string;
  let classId: string;
  let sectionId: string;

  const TEST_PHONE = ['01990000001', '01990000002'];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;

  const cleanup = async () => {
    await prisma.notification.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        OR: [
          { destination: { in: TEST_PHONE } },
          { templateCode: 'LOW_SMS_CREDIT' },
          ...(adminUserId ? [{ recipientId: adminUserId }] : []),
        ],
      },
    });
    await prisma.smsCredit.deleteMany({ where: { schoolId: DEFAULT_SCHOOL_ID } });
    await prisma.notificationTemplate.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, language: 'BN' },
    });
    await prisma.notice.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, title: { startsWith: 'E2E-COMM' } },
    });
    await prisma.academicSession.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E-COMM ' } },
    });
    await prisma.guardian.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2ECOMM' } },
    });
    await prisma.student.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: NAME },
    });
    await prisma.schoolClass.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2ECOMMClass' } },
    });
    const users = await prisma.user.findMany({
      where: { email: { in: [ADMIN, PLAIN] } },
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
    await seedNotificationTemplates(prisma, DEFAULT_SCHOOL_ID);
    await cleanup();

    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const [adminUser] = await Promise.all(
      (
        [
          [ADMIN, UserType.ADMIN],
          [PLAIN, UserType.STAFF],
        ] as const
      ).map(([email, userType]) =>
        prisma.user.create({
          data: { schoolId: DEFAULT_SCHOOL_ID, email, passwordHash, userType },
        }),
      ),
    );
    adminUserId = adminUser.id;

    const adminRole = await prisma.role.findFirst({
      where: { schoolId: DEFAULT_SCHOOL_ID, slug: 'admin', deletedAt: null },
    });
    await prisma.userRole.create({
      data: { userId: adminUser.id, roleId: adminRole!.id },
    });

    const now = new Date();
    const session = await prisma.academicSession.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `E2E-COMM ${now.getUTCFullYear()}`,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        status: 'ACTIVE',
      },
    });
    sessionId = session.id;

    const klass = await prisma.schoolClass.create({
      data: { schoolId: DEFAULT_SCHOOL_ID, name: 'E2ECOMMClassA', numericLevel: 7 },
    });
    classId = klass.id;
    const section = await prisma.section.create({
      data: { schoolId: DEFAULT_SCHOOL_ID, classId, sessionId, name: 'A1' },
    });
    sectionId = section.id;

    // Two students with a primary guardian each — the PARENTS audience.
    for (let i = 0; i < 2; i += 1) {
      const student = await prisma.student.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          studentUid: `E2E-COMM-${Date.now()}-${i}`,
          firstName: NAME,
          lastName: `Pupil${i}`,
          gender: 'MALE',
          dob: new Date('2014-05-05'),
          admissionDate: new Date('2026-01-02'),
          admissionClassId: classId,
          qrToken: randomUUID(),
        },
      });
      const guardian = await prisma.guardian.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          name: `E2ECOMM Guardian ${i}`,
          phone: TEST_PHONE[i],
        },
      });
      await prisma.studentGuardian.create({
        data: { studentId: student.id, guardianId: guardian.id, isPrimary: true },
      });
      await prisma.enrollment.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          studentId: student.id,
          sessionId,
          classId,
          sectionId,
          rollNo: i + 1,
          enrollmentDate: new Date('2026-01-02'),
          status: 'ACTIVE',
        },
      });
    }

    const login = async (identifier: string) => {
      const res = await server()
        .post('/api/v1/auth/login')
        .send({ identifier, password: PASSWORD })
        .expect(200);
      return dataOf<{ accessToken: string }>(res).accessToken;
    };
    adminToken = await login(ADMIN);
    plainToken = await login(PLAIN);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  // ── permission guards ──────────────────────────────────────────────

  it('refuses a user without communication permissions', async () => {
    await server()
      .get('/api/v1/notification-templates')
      .set(auth(plainToken))
      .expect(403);
    await server().get('/api/v1/notices').set(auth(plainToken)).expect(403);
    await server()
      .get('/api/v1/sms-credits/balance')
      .set(auth(plainToken))
      .expect(403);
  });

  it('lets any authenticated user read their own in-app inbox', async () => {
    await server().get('/api/v1/notifications/me').set(auth(plainToken)).expect(200);
  });

  // ── templates ──────────────────────────────────────────────────────

  it('lists the seeded default templates', async () => {
    const res = await server()
      .get('/api/v1/notification-templates')
      .set(auth(adminToken))
      .expect(200);
    const templates = dataOf<Array<{ code: string }>>(res);
    expect(templates.some((t) => t.code === 'ABSENT_ALERT')).toBe(true);
  });

  it('exposes the code catalog with allowed variables', async () => {
    const res = await server()
      .get('/api/v1/notification-templates/codes')
      .set(auth(adminToken))
      .expect(200);
    const codes = dataOf<Array<{ code: string; variables: string[] }>>(res);
    const absent = codes.find((c) => c.code === 'ABSENT_ALERT');
    expect(absent?.variables).toContain('student_name');
  });

  it('rejects a template body with an unknown variable', async () => {
    await server()
      .post('/api/v1/notification-templates')
      .set(auth(adminToken))
      .send({
        code: 'ABSENT_ALERT',
        channel: 'SMS',
        language: 'BN',
        body: '{{studnet_name}} was absent', // typo — not in the allow-list
      })
      .expect(400);
  });

  it('creates a BN template and refuses a duplicate identity', async () => {
    await server()
      .post('/api/v1/notification-templates')
      .set(auth(adminToken))
      .send({
        code: 'ABSENT_ALERT',
        channel: 'SMS',
        language: 'BN',
        body: '{{student_name}} আজ অনুপস্থিত ছিল',
      })
      .expect(201);
    await server()
      .post('/api/v1/notification-templates')
      .set(auth(adminToken))
      .send({
        code: 'ABSENT_ALERT',
        channel: 'SMS',
        language: 'BN',
        body: '{{student_name}} absent again',
      })
      .expect(409);
  });

  it('previews a Bangla body as multi-part UCS-2', async () => {
    const res = await server()
      .post('/api/v1/notification-templates/preview')
      .set(auth(adminToken))
      .send({
        code: 'ABSENT_ALERT',
        body: 'ক'.repeat(80), // > 70 UCS-2 chars → 2 parts
      })
      .expect(200);
    const preview = dataOf<{ segments: number; unicode: boolean }>(res);
    expect(preview.unicode).toBe(true);
    expect(preview.segments).toBe(2);
  });

  // ── direct send + dispatch + log ───────────────────────────────────

  it('sends an SMS through the entry point and dispatches it SENT', async () => {
    const res = await server()
      .post('/api/v1/notifications/send')
      .set(auth(adminToken))
      .send({
        channel: 'SMS',
        recipientType: 'RAW',
        destination: TEST_PHONE[0],
        message: 'Hello from E2E',
      })
      .expect(201);
    const row = dataOf<{ id: string; status: string; segments: number }>(res);
    expect(row.status).toBe('QUEUED');
    expect(row.segments).toBe(1);

    await waitForStatus(row.id, 'SENT');

    const after = await server()
      .get(`/api/v1/notifications/${row.id}`)
      .set(auth(adminToken))
      .expect(200);
    const sent = dataOf<{ status: string; providerMsgId: string; sentAt: string }>(
      after,
    );
    expect(sent.status).toBe('SENT');
    expect(sent.providerMsgId).toMatch(/^LOG-/);
    expect(sent.sentAt).toBeTruthy();
  });

  it('shows the sent message in the delivery log', async () => {
    const res = await server()
      .get('/api/v1/notifications?channel=SMS&status=SENT')
      .set(auth(adminToken))
      .expect(200);
    const rows = dataOf<Array<{ destination: string }>>(res);
    expect(rows.some((r) => r.destination === TEST_PHONE[0])).toBe(true);
  });

  // ── in-app inbox ───────────────────────────────────────────────────

  it('delivers an IN_APP message to the recipient inbox and marks it read', async () => {
    await server()
      .post('/api/v1/notifications/send')
      .set(auth(adminToken))
      .send({
        channel: 'IN_APP',
        recipientType: 'USER',
        recipientId: adminUserId,
        message: 'E2E in-app ping',
      })
      .expect(201);

    const inbox = await server()
      .get('/api/v1/notifications/me?unread=true')
      .set(auth(adminToken))
      .expect(200);
    const before = dataOf<{ unread: number; items: unknown[] }>(inbox);
    expect(before.unread).toBeGreaterThanOrEqual(1);

    const read = await server()
      .put('/api/v1/notifications/me/read')
      .set(auth(adminToken))
      .send({})
      .expect(200);
    expect((read.body as { data: { updated: number } }).data.updated).toBeGreaterThanOrEqual(1);

    const after = await server()
      .get('/api/v1/notifications/me?unread=true')
      .set(auth(adminToken))
      .expect(200);
    expect(dataOf<{ unread: number }>(after).unread).toBe(0);
  });

  // ── notices ────────────────────────────────────────────────────────

  it('creates, publishes, feeds and unpublishes a notice', async () => {
    const created = await server()
      .post('/api/v1/notices')
      .set(auth(adminToken))
      .send({
        title: 'E2E-COMM Closure',
        body: 'School closed tomorrow for weather.',
        audience: 'ALL',
        isWebsiteVisible: true,
      })
      .expect(201);
    const noticeId = dataOf<{ id: string }>(created).id;

    await server()
      .put(`/api/v1/notices/${noticeId}/publish`)
      .set(auth(adminToken))
      .send({ publish: true })
      .expect(200);

    const feed = await server()
      .get('/api/v1/notices/feed')
      .set(auth(adminToken))
      .expect(200);
    expect(
      dataOf<Array<{ id: string }>>(feed).some((n) => n.id === noticeId),
    ).toBe(true);

    await server()
      .put(`/api/v1/notices/${noticeId}/publish`)
      .set(auth(adminToken))
      .send({ publish: false })
      .expect(200);
  });

  it('refuses to publish a notice with a future publish date', async () => {
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await server()
      .post('/api/v1/notices')
      .set(auth(adminToken))
      .send({
        title: 'E2E-COMM Future',
        body: 'Scheduled.',
        audience: 'ALL',
        isPublished: true,
        publishAt: future,
      })
      .expect(400);
  });

  // ── SMS credits ────────────────────────────────────────────────────

  it('purchases credit and consumes a part on a metered send', async () => {
    await server()
      .post('/api/v1/sms-credits/adjust')
      .set(auth(adminToken))
      .send({ qty: 100, purchase: true, ref: 'E2E top-up' })
      .expect(201);

    const balance = await server()
      .get('/api/v1/sms-credits/balance')
      .set(auth(adminToken))
      .expect(200);
    expect(dataOf<{ balance: number; metered: boolean }>(balance)).toEqual({
      balance: 100,
      metered: true,
    });

    // A metered send consumes exactly its part count.
    const res = await server()
      .post('/api/v1/notifications/send')
      .set(auth(adminToken))
      .send({
        channel: 'SMS',
        recipientType: 'RAW',
        destination: TEST_PHONE[1],
        message: 'metered part',
      })
      .expect(201);
    await waitForStatus(dataOf<{ id: string }>(res).id, 'SENT');

    const after = await server()
      .get('/api/v1/sms-credits/balance')
      .set(auth(adminToken))
      .expect(200);
    expect(dataOf<{ balance: number }>(after).balance).toBe(99);
  });

  it('fails a metered send with insufficient credit and never sends it', async () => {
    // Drain the balance to zero with a manual adjustment.
    await server()
      .post('/api/v1/sms-credits/adjust')
      .set(auth(adminToken))
      .send({ qty: -99, ref: 'E2E drain' })
      .expect(201);

    const res = await server()
      .post('/api/v1/notifications/send')
      .set(auth(adminToken))
      .send({
        channel: 'SMS',
        recipientType: 'RAW',
        destination: TEST_PHONE[1],
        message: 'should fail — no credit',
      })
      .expect(201);
    const id = dataOf<{ id: string }>(res).id;
    await waitForStatus(id, 'FAILED');

    const row = await prisma.notification.findUnique({ where: { id } });
    expect(row?.status).toBe('FAILED');
    expect(row?.error).toContain('Insufficient SMS credit');
  });

  // ── DLR webhook ────────────────────────────────────────────────────

  it('marks a message DELIVERED from a secret-verified DLR webhook', async () => {
    await server()
      .put('/api/v1/settings/communication')
      .set(auth(adminToken))
      .send({ 'communication.dlr_webhook_secret': 'e2e-secret' })
      .expect(200);

    const row = await prisma.notification.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        channel: 'SMS',
        recipientType: 'RAW',
        destination: TEST_PHONE[0],
        bodyRendered: 'dlr target',
        status: 'SENT',
        sentAt: new Date(),
        providerMsgId: 'DLR-E2E-1',
      },
    });

    await server()
      .post('/api/v1/webhooks/sms-dlr?secret=e2e-secret')
      .send({ message_id: 'DLR-E2E-1', status: 'DELIVERED' })
      .expect(200);

    const updated = await prisma.notification.findUnique({ where: { id: row.id } });
    expect(updated?.status).toBe('DELIVERED');
    expect(updated?.deliveredAt).toBeTruthy();
  });

  it('rejects a DLR webhook with the wrong secret', async () => {
    await server()
      .post('/api/v1/webhooks/sms-dlr?secret=wrong')
      .send({ message_id: 'DLR-E2E-1', status: 'DELIVERED' })
      .expect(403);
  });

  // ── bulk composer ──────────────────────────────────────────────────

  it('previews a PARENTS audience with the recipient count', async () => {
    const res = await server()
      .post('/api/v1/notifications/bulk/preview')
      .set(auth(adminToken))
      .send({
        channel: 'SMS',
        audience: 'PARENTS',
        sessionId,
        message: 'Dear parent, {{name}} — meeting tomorrow.',
      })
      .expect(200);
    const preview = dataOf<{ recipients: number }>(res);
    expect(preview.recipients).toBe(2);
  });

  it('refuses a bulk RAW send with zero valid numbers', async () => {
    await server()
      .post('/api/v1/notifications/bulk')
      .set(auth(adminToken))
      .send({ channel: 'SMS', audience: 'RAW', customNumbers: [], message: 'x' })
      .expect(400);
  });

  // ── raw DB constraints ─────────────────────────────────────────────

  it('refuses an SMS-credit movement that would overdraw the balance', async () => {
    await expect(
      prisma.smsCredit.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          type: 'CONSUME',
          qty: -5,
          balanceAfter: -5,
        },
      }),
    ).rejects.toThrow();
  });

  it('refuses a SENT notification with no sent_at (evidence CHECK)', async () => {
    await expect(
      prisma.notification.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          channel: 'SMS',
          recipientType: 'RAW',
          destination: TEST_PHONE[0],
          bodyRendered: 'no evidence',
          status: 'SENT',
        },
      }),
    ).rejects.toThrow();
  });
});
