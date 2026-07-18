import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEFAULT_SCHOOL_ID, UserType } from '../src/common/constants';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { AdmissionTokenService } from '../src/modules/admission/services/admission-token.service';
import {
  seedSystemRoles,
  syncPermissionRegistry,
} from '../src/modules/rbac/seed/rbac.seeder';

/**
 * Requires dev infra (DB + redis). Uses a dedicated class at level 17 and
 * a far-future session so real dev data is untouched; everything created
 * here is removed in afterAll. Application numbers claimed stay burned
 * (by design — same as student UIDs).
 *
 * OTP delivery cannot be intercepted in e2e (hash-stored, SMS log-only),
 * so the phone-verification token is minted directly via
 * AdmissionTokenService; the OTP endpoints themselves are covered for
 * issuance + wrong-code rejection (internals are unit-tested in M02).
 */
describe('Admission Management (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokens: AdmissionTokenService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-admission-admin@test.local';
  const PLAIN = 'e2e-admission-plain@test.local';
  // Applicant/guardian phone pool — distinct prefix from other suites.
  const PHONES = Array.from(
    { length: 10 },
    (_, i) => `017991880${String(i).padStart(2, '0')}`,
  );
  const GUARDIAN_PHONE = '01799188955';
  const CYCLE_NAME = 'E2E Admission Cycle';

  let adminToken: string;
  let plainToken: string;
  let classId: string;
  let sessionId: string;
  let cycleId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;
  const binaryParser = (
    res: request.Response,
    cb: (err: Error | null, body: Buffer) => void,
  ) => {
    const chunks: Buffer[] = [];
    const stream = res as unknown as NodeJS.ReadableStream;
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  /** Applicant ≈ 22 yrs for class level 17 (expected 22 ± 3). */
  const applyPayload = (i: number, extra: object = {}) => ({
    verificationToken: tokens.signPhoneToken(PHONES[i]),
    cycleId,
    classId,
    firstName: 'E2EAdm',
    lastName: `Applicant${i}`,
    gender: 'FEMALE',
    dob: `2004-0${(i % 8) + 1}-15`,
    previousGpa: 3 + (i % 3) * 0.5,
    guardian: {
      name: 'E2E Adm Guardian',
      relation: 'MOTHER',
      phone: GUARDIAN_PHONE,
    },
    ...extra,
  });

  const cleanup = async () => {
    await prisma.admissionApplication.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, phone: { in: PHONES } },
    });
    await prisma.admissionCycle.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: CYCLE_NAME },
    });
    const students = await prisma.student.findMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: 'E2EAdm' },
      select: { id: true, userId: true },
    });
    if (students.length > 0) {
      await prisma.student.deleteMany({
        where: { id: { in: students.map((s) => s.id) } },
      });
    }
    await prisma.guardian.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, phone: GUARDIAN_PHONE },
    });
    await prisma.schoolClass.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: 'E2E AdmClass' },
    });
    await prisma.academicSession.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: 'E2E-ADM-2098' },
    });
    await prisma.otpCode.deleteMany({
      where: { identifier: { in: PHONES } },
    });
    const users = await prisma.user.findMany({
      where: { email: { in: [ADMIN, PLAIN] } },
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
    tokens = app.get(AdmissionTokenService);
    await syncPermissionRegistry(prisma);
    await seedSystemRoles(prisma, DEFAULT_SCHOOL_ID);

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
    const adminRole = await prisma.role.findFirst({
      where: { schoolId: DEFAULT_SCHOOL_ID, slug: 'admin', deletedAt: null },
    });
    await prisma.userRole.create({
      data: { userId: adminUser.id, roleId: adminRole!.id },
    });

    const klass = await prisma.schoolClass.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: 'E2E AdmClass',
        numericLevel: 17,
      },
    });
    classId = klass.id;
    const session = await prisma.academicSession.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: 'E2E-ADM-2098',
        startDate: new Date('2098-01-01'),
        endDate: new Date('2098-12-31'),
      },
    });
    sessionId = session.id;

    const login = async (identifier: string) => {
      const res = await server()
        .post('/api/v1/auth/login')
        .send({ identifier, password: PASSWORD })
        .expect(200);
      return (res.body as { data: { accessToken: string } }).data.accessToken;
    };
    adminToken = await login(ADMIN);
    plainToken = await login(PLAIN);
  }, 120_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  }, 120_000);

  // ── cycle setup ─────────────────────────────────────────────────────

  it('admission endpoints are permission-guarded', async () => {
    await server()
      .get('/api/v1/admission-cycles')
      .set(auth(plainToken))
      .expect(403);
    await server()
      .post('/api/v1/admission-cycles')
      .set(auth(plainToken))
      .send({})
      .expect(403);
  });

  it('creates a cycle with per-class seats and fee', async () => {
    const res = await server()
      .post('/api/v1/admission-cycles')
      .set(auth(adminToken))
      .send({
        sessionId,
        name: CYCLE_NAME,
        startAt: new Date(Date.now() - 3600_000).toISOString(),
        endAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
        testRequired: true,
        instructions: 'Bring the admit card.',
        classes: [{ classId, seats: 2, applicationFee: 100 }],
      })
      .expect(201);
    const cycle = dataOf<{
      id: string;
      status: string;
      classes: Array<{ seats: number; applicationFee: string }>;
    }>(res);
    cycleId = cycle.id;
    expect(cycle.status).toBe('DRAFT');
    expect(cycle.classes).toHaveLength(1);
  });

  it('rejects a duplicate cycle name', async () => {
    await server()
      .post('/api/v1/admission-cycles')
      .set(auth(adminToken))
      .send({
        sessionId,
        name: CYCLE_NAME,
        startAt: new Date().toISOString(),
        endAt: new Date(Date.now() + 3600_000).toISOString(),
        classes: [{ classId, seats: 1 }],
      })
      .expect(409);
  });

  it('opens the cycle (public listing shows it)', async () => {
    await server()
      .post(`/api/v1/admission-cycles/${cycleId}/open`)
      .set(auth(adminToken))
      .expect(201);

    const res = await server().get('/api/v1/public/admissions/cycles');
    expect(res.status).toBe(200);
    const cycles = dataOf<Array<{ id: string; classes: unknown[] }>>(res);
    expect(cycles.some((c) => c.id === cycleId)).toBe(true);
  });

  // ── public application flow ─────────────────────────────────────────

  it('issues an OTP and rejects a wrong code', async () => {
    await server()
      .post('/api/v1/public/admissions/request-otp')
      .send({ phone: PHONES[0] })
      .expect(201);
    await server()
      .post('/api/v1/public/admissions/verify-otp')
      .send({ phone: PHONES[0], code: '000000' })
      .expect(400);
  });

  it('rejects apply without a valid phone token', async () => {
    await server()
      .post('/api/v1/public/admissions/apply')
      .send({ ...applyPayload(0), verificationToken: 'garbage' })
      .expect(401);
  });

  let appNoA: string;

  it('accepts an application (fee due → PAYMENT_PENDING)', async () => {
    const res = await server()
      .post('/api/v1/public/admissions/apply')
      .send(applyPayload(0))
      .expect(201);
    const data = dataOf<{
      applicationNo: string;
      status: string;
      applicationFee: number;
    }>(res);
    appNoA = data.applicationNo;
    expect(data.status).toBe('PAYMENT_PENDING');
    expect(data.applicationFee).toBe(100);
    expect(data.applicationNo).toMatch(/^ADM-\d{2}-\d{6}$/);
  });

  it('blocks a duplicate application (same cycle/class/phone/dob)', async () => {
    await server()
      .post('/api/v1/public/admissions/apply')
      .send(applyPayload(0))
      .expect(409);
  });

  it('hard-rejects an applicant far outside the class age band', async () => {
    await server()
      .post('/api/v1/public/admissions/apply')
      .send(applyPayload(5, { dob: '2020-01-01' }))
      .expect(400);
  });

  it('tracks by application number + phone (both must match)', async () => {
    const res = await server()
      .get('/api/v1/public/admissions/track')
      .query({ appNo: appNoA, phone: PHONES[0] })
      .expect(200);
    const data = dataOf<{ status: string; applicantName: string }>(res);
    expect(data.status).toBe('PAYMENT_PENDING');
    expect(data.applicantName).toBe('E2EAdm Applicant0');

    await server()
      .get('/api/v1/public/admissions/track')
      .query({ appNo: appNoA, phone: PHONES[1] })
      .expect(404);
  });

  // ── payments, test, marks ───────────────────────────────────────────

  const applicationIds: string[] = [];

  it('records offline payments (PAYMENT_PENDING → SUBMITTED)', async () => {
    // Two more applicants join first.
    for (const i of [1, 2]) {
      await server()
        .post('/api/v1/public/admissions/apply')
        .send(applyPayload(i))
        .expect(201);
    }

    const list = dataOf<Array<{ id: string; status: string }>>(
      await server()
        .get('/api/v1/admission-applications')
        .query({ cycleId, limit: 50 })
        .set(auth(adminToken))
        .expect(200),
    );
    expect(list).toHaveLength(3);
    applicationIds.push(...list.map((a) => a.id));

    for (const id of applicationIds) {
      const res = await server()
        .post(`/api/v1/admission-applications/${id}/payment`)
        .set(auth(adminToken))
        .send({ method: 'CASH', reference: 'E2E-RCPT' })
        .expect(201);
      const app = dataOf<{ status: string; paymentStatus: string }>(res);
      expect(app.paymentStatus).toBe('PAID');
      expect(app.status).toBe('SUBMITTED');
    }
  });

  it('schedules the test (paid applications → TEST_SCHEDULED)', async () => {
    await server()
      .put(`/api/v1/admission-cycles/${cycleId}/tests`)
      .set(auth(adminToken))
      .send({
        tests: [
          {
            classId,
            testDate: '2097-12-01',
            venue: 'Main Hall',
            totalMarks: 100,
            passMarks: 25,
          },
        ],
      })
      .expect(200);

    const list = dataOf<Array<{ status: string }>>(
      await server()
        .get('/api/v1/admission-applications')
        .query({ cycleId, limit: 50 })
        .set(auth(adminToken))
        .expect(200),
    );
    expect(list.every((a) => a.status === 'TEST_SCHEDULED')).toBe(true);
  });

  it('serves the admit card PDF publicly (app no + phone)', async () => {
    const res = await server()
      .get('/api/v1/public/admissions/admit-card')
      .query({ appNo: appNoA, phone: PHONES[0] })
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('enters test marks (grades PASSED/FAILED, caps at total)', async () => {
    await server()
      .post(`/api/v1/admission-cycles/${cycleId}/test-marks`)
      .set(auth(adminToken))
      .send({
        entries: [{ applicationId: applicationIds[0], marks: 150 }],
      })
      .expect(400);

    const res = await server()
      .post(`/api/v1/admission-cycles/${cycleId}/test-marks`)
      .set(auth(adminToken))
      .send({
        entries: [
          { applicationId: applicationIds[0], marks: 90 },
          { applicationId: applicationIds[1], marks: 70 },
          { applicationId: applicationIds[2], marks: 40 },
        ],
      })
      .expect(201);
    expect(dataOf<{ passed: number; failed: number }>(res)).toMatchObject({
      passed: 3,
      failed: 0,
    });
  });

  // ── merit, waitlist, conversion ─────────────────────────────────────

  it('refuses merit generation while the cycle is OPEN', async () => {
    await server()
      .post(`/api/v1/admission-cycles/${cycleId}/generate-merit-list`)
      .set(auth(adminToken))
      .send({ classId })
      .expect(409);
  });

  it('closes the cycle and generates the merit list (2 seats → 1 waitlisted)', async () => {
    await server()
      .post(`/api/v1/admission-cycles/${cycleId}/close`)
      .set(auth(adminToken))
      .expect(201);

    const res = await server()
      .post(`/api/v1/admission-cycles/${cycleId}/generate-merit-list`)
      .set(auth(adminToken))
      .send({ classId })
      .expect(201);
    expect(dataOf<{ selected: number; waitlisted: number }>(res)).toMatchObject(
      { selected: 2, waitlisted: 1 },
    );

    const merit = dataOf<
      Array<{ applicationNo: string; meritPosition: number; status: string }>
    >(
      await server()
        .get(`/api/v1/admission-cycles/${cycleId}/merit-list`)
        .query({ classId })
        .set(auth(adminToken))
        .expect(200),
    );
    // 90 and 70 marks selected, in that order.
    expect(merit.map((m) => m.meritPosition)).toEqual([1, 2]);

    const waiting = dataOf<Array<{ meritPosition: number }>>(
      await server()
        .get(`/api/v1/admission-cycles/${cycleId}/waiting-list`)
        .query({ classId })
        .set(auth(adminToken))
        .expect(200),
    );
    expect(waiting).toHaveLength(1);
    expect(waiting[0].meritPosition).toBe(3);
  });

  it('cancelling a SELECTED application auto-promotes the waitlist', async () => {
    // applicationIds[1] scored 70 → SELECTED at position 2.
    await server()
      .put(`/api/v1/admission-applications/${applicationIds[1]}/status`)
      .set(auth(adminToken))
      .send({ status: 'CANCELLED', reason: 'Family declined the seat' })
      .expect(200);

    const promoted = dataOf<{ status: string }>(
      await server()
        .get(`/api/v1/admission-applications/${applicationIds[2]}`)
        .set(auth(adminToken))
        .expect(200),
    );
    expect(promoted.status).toBe('SELECTED');
  });

  it('admits the top candidate → student created via the M09 path', async () => {
    const res = await server()
      .post(`/api/v1/admission-applications/${applicationIds[0]}/admit`)
      .set(auth(adminToken))
      .expect(201);
    const data = dataOf<{
      student: { id: string; studentUid: string };
      alreadyAdmitted: boolean;
    }>(res);
    expect(data.alreadyAdmitted).toBe(false);
    expect(data.student.studentUid).toBeTruthy();

    // Idempotent re-admit returns the same student.
    const again = dataOf<{
      student: { id: string };
      alreadyAdmitted: boolean;
    }>(
      await server()
        .post(`/api/v1/admission-applications/${applicationIds[0]}/admit`)
        .set(auth(adminToken))
        .expect(201),
    );
    expect(again.alreadyAdmitted).toBe(true);
    expect(again.student.id).toBe(data.student.id);

    // Guardian master row created from the snapshot (deduped by phone).
    const guardians = await prisma.guardian.findMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, phone: GUARDIAN_PHONE },
    });
    expect(guardians).toHaveLength(1);
  });

  it('refuses to admit a non-SELECTED application', async () => {
    await server()
      .post(`/api/v1/admission-applications/${applicationIds[1]}/admit`)
      .set(auth(adminToken))
      .expect(409);
  });

  it('reports the funnel summary per class', async () => {
    const res = await server()
      .get('/api/v1/admission-reports/summary')
      .query({ cycleId })
      .set(auth(adminToken))
      .expect(200);
    const data = dataOf<{
      funnel: { applied: number; admitted: number };
      classes: Array<{ admitted: number; feesCollected: number }>;
    }>(res);
    expect(data.funnel.applied).toBe(3);
    expect(data.funnel.admitted).toBe(1);
    expect(data.classes[0].admitted).toBe(1);
    expect(data.classes[0].feesCollected).toBe(300);
  });

  it('blocks deleting a cycle with applications', async () => {
    await server()
      .delete(`/api/v1/admission-cycles/${cycleId}`)
      .set(auth(adminToken))
      .expect(409);
  });
});
