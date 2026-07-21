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

/**
 * Requires dev infra (DB + redis). Uses far-future E2E sessions (2092/
 * 2093) + a level-17 class so real dev data is untouched; afterAll
 * removes everything (session FK cascades take sections/enrollments/
 * promotion batches; students are deleted explicitly).
 */
describe('Enrollment & Promotion (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-enroll-admin@test.local';
  const PLAIN = 'e2e-enroll-plain@test.local';
  const NAME = 'E2EEnroll';

  let adminToken: string;
  let plainToken: string;
  let classId: string;
  let sessionA: string;
  let sessionB: string;
  let secA1: string;
  let secA1b: string;
  let secCap: string;
  let secA2: string;
  const studentIds: string[] = [];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;

  const cleanup = async () => {
    await prisma.academicSession.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E-EN ' } },
    });
    await prisma.student.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: NAME },
    });
    await prisma.schoolClass.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: 'E2E EnClass' },
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

  const makeStudent = async (i: number): Promise<string> => {
    const s = await prisma.student.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        studentUid: `E2E-EN-${Date.now()}-${i}`,
        firstName: NAME,
        lastName: `Pupil${i}`,
        gender: 'MALE',
        dob: new Date('2013-05-05'),
        admissionDate: new Date('2026-01-01'),
        admissionClassId: classId,
        qrToken: randomUUID(),
      },
    });
    return s.id;
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
      data: { schoolId: DEFAULT_SCHOOL_ID, name: 'E2E EnClass', numericLevel: 17 },
    });
    classId = klass.id;

    const [a, b] = await Promise.all([
      prisma.academicSession.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          name: 'E2E-EN 2092',
          startDate: new Date('2092-01-01'),
          endDate: new Date('2092-12-31'),
        },
      }),
      prisma.academicSession.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          name: 'E2E-EN 2093',
          startDate: new Date('2093-01-01'),
          endDate: new Date('2093-12-31'),
        },
      }),
    ]);
    sessionA = a.id;
    sessionB = b.id;

    const mkSection = async (
      sessionId: string,
      name: string,
      capacity: number | null,
    ) =>
      (
        await prisma.section.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            classId,
            sessionId,
            name,
            capacity,
          },
        })
      ).id;
    secA1 = await mkSection(sessionA, 'A1', null);
    secA1b = await mkSection(sessionA, 'A1b', null);
    secCap = await mkSection(sessionA, 'Cap', 1);
    secA2 = await mkSection(sessionB, 'A2', null);

    for (let i = 0; i < 6; i += 1) studentIds.push(await makeStudent(i));

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

  const enroll = (body: object, token = adminToken) =>
    server().post('/api/v1/enrollments').set(auth(token)).send(body);

  it('is permission-guarded', async () => {
    await server().get('/api/v1/enrollments').set(auth(plainToken)).expect(403);
    await enroll(
      { studentId: studentIds[0], sessionId: sessionA, sectionId: secA1 },
      plainToken,
    ).expect(403);
  });

  it('enrolls a student with an auto-assigned roll', async () => {
    const res = await enroll({
      studentId: studentIds[0],
      sessionId: sessionA,
      sectionId: secA1,
    }).expect(201);
    expect(dataOf<{ rollNo: number }>(res).rollNo).toBe(1);

    const res2 = await enroll({
      studentId: studentIds[1],
      sessionId: sessionA,
      sectionId: secA1,
    }).expect(201);
    expect(dataOf<{ rollNo: number }>(res2).rollNo).toBe(2);
  });

  it('rejects a second enrollment in the same session (409)', async () => {
    await enroll({
      studentId: studentIds[0],
      sessionId: sessionA,
      sectionId: secA1,
    }).expect(409);
  });

  it('enforces section capacity, override lets an admin exceed it', async () => {
    await enroll({
      studentId: studentIds[2],
      sessionId: sessionA,
      sectionId: secCap,
    }).expect(201);
    // Second into a capacity-1 section without override → 409.
    await enroll({
      studentId: studentIds[3],
      sessionId: sessionA,
      sectionId: secCap,
    }).expect(409);
    // Admin holds enrollment.capacity.override → allowed.
    await enroll({
      studentId: studentIds[3],
      sessionId: sessionA,
      sectionId: secCap,
      overrideCapacity: true,
    }).expect(201);
  });

  it('bulk-enrolls, skipping already-enrolled students', async () => {
    const res = await server()
      .post('/api/v1/enrollments/bulk')
      .set(auth(adminToken))
      .send({
        sessionId: sessionA,
        sectionId: secA1b,
        studentIds: [studentIds[4], studentIds[5], studentIds[2]],
      })
      .expect(201);
    const data = dataOf<{
      enrolled: Array<{ rollNo: number }>;
      skipped: Array<{ studentId: string; reason: string }>;
    }>(res);
    expect(data.enrolled).toHaveLength(2);
    expect(data.skipped).toHaveLength(1);
    expect(data.skipped[0].studentId).toBe(studentIds[2]);
  });

  it('lists enrollable students (no live enrollment in the session)', async () => {
    const res = await server()
      .get(`/api/v1/enrollments/enrollable?sessionId=${sessionB}`)
      .set(auth(adminToken))
      .expect(200);
    // Nobody is enrolled in session B yet → all 6 are enrollable.
    const data = dataOf<Array<{ id: string }>>(res);
    expect(data.length).toBeGreaterThanOrEqual(6);
  });

  it('transfers a student to another section, reassigning a taken roll', async () => {
    const enr = await prisma.enrollment.findFirst({
      where: { studentId: studentIds[0], sessionId: sessionA },
    });
    const res = await server()
      .post(`/api/v1/enrollments/${enr!.id}/transfer-section`)
      .set(auth(adminToken))
      .send({ toSectionId: secA1b, keepRoll: true })
      .expect(201);
    // Roll 1 is taken in A1b (bulk assigned 1,2) → reassigned to 3.
    expect(dataOf<{ rollNo: number }>(res).rollNo).toBe(3);

    const history = await server()
      .get(`/api/v1/enrollments/${enr!.id}/transfers`)
      .set(auth(adminToken))
      .expect(200);
    expect(dataOf<unknown[]>(history)).toHaveLength(1);
  });

  it('renumbers a section (roll-assign)', async () => {
    const res = await server()
      .post('/api/v1/enrollments/roll-assign')
      .set(auth(adminToken))
      .send({ sectionId: secA1b, sessionId: sessionA, strategy: 'SEQUENTIAL' })
      .expect(201);
    const rolls = dataOf<Array<{ rollNo: number }>>(res).map((e) => e.rollNo);
    expect(rolls).toEqual([1, 2, 3]);
  });

  it('serves the canonical section roster', async () => {
    const res = await server()
      .get(`/api/v1/sections/${secA1b}/students`)
      .set(auth(adminToken))
      .expect(200);
    expect(dataOf<unknown[]>(res)).toHaveLength(3);
  });

  it('blocks deleting a section that still has enrollments (M06 guard)', async () => {
    await server()
      .delete(`/api/v1/sections/${secA1}`)
      .set(auth(adminToken))
      .expect(409);
  });

  it('runs a full promotion cycle: build → execute → rollback', async () => {
    // Build a DRAFT batch mapping the E2E class into session B.
    const created = await server()
      .post('/api/v1/promotions')
      .set(auth(adminToken))
      .send({
        fromSessionId: sessionA,
        toSessionId: sessionB,
        mappings: [
          { fromClassId: classId, toClassId: classId, toSectionId: secA2 },
        ],
      })
      .expect(201);
    const batch = dataOf<{
      batch: { id: string };
      items: Array<{ decision: string }>;
    }>(created);
    const batchId = batch.batch.id;
    // 6 students are enrolled in session A → 6 PROMOTE candidates.
    expect(batch.items).toHaveLength(6);
    expect(batch.items.every((i) => i.decision === 'PROMOTE')).toBe(true);

    const preview = await server()
      .get(`/api/v1/promotions/${batchId}/preview`)
      .set(auth(adminToken))
      .expect(200);
    expect(dataOf<{ counts: { PROMOTE: number } }>(preview).counts.PROMOTE).toBe(
      6,
    );

    const exec = await server()
      .post(`/api/v1/promotions/${batchId}/execute`)
      .set(auth(adminToken))
      .send({})
      .expect(201);
    expect(dataOf<{ promoted: number }>(exec).promoted).toBe(6);

    // New enrollments exist in session B / section A2.
    const rosterB = await server()
      .get(`/api/v1/sections/${secA2}/students`)
      .set(auth(adminToken))
      .expect(200);
    expect(dataOf<unknown[]>(rosterB)).toHaveLength(6);
    // Old session-A enrollments are now PROMOTED (not ACTIVE).
    const oldActive = await prisma.enrollment.count({
      where: { sessionId: sessionA, status: 'ACTIVE' },
    });
    expect(oldActive).toBe(0);

    // Roll back: new enrollments removed, old ones reactivated.
    await server()
      .post(`/api/v1/promotions/${batchId}/rollback`)
      .set(auth(adminToken))
      .expect(201);
    const afterRollback = await prisma.enrollment.count({
      where: { sessionId: sessionB, deletedAt: null },
    });
    expect(afterRollback).toBe(0);
    const reactivated = await prisma.enrollment.count({
      where: { sessionId: sessionA, status: 'ACTIVE' },
    });
    expect(reactivated).toBe(6);
  });
});
