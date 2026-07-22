import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { School } from '@prisma/client';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEFAULT_SCHOOL_ID, UserType } from '../src/common/constants';
import { PrismaService } from '../src/database/prisma/prisma.service';
import {
  seedSystemRoles,
  syncPermissionRegistry,
} from '../src/modules/rbac/seed/rbac.seeder';
import { seedNctbGradingSystem } from '../src/modules/school/seed/school.seeder';

/**
 * Requires dev infra (DB + redis; test-email additionally uses Mailpit on
 * localhost:1025). Runs against the shared default school, so every field
 * it touches is captured in beforeAll and restored in afterAll.
 */
describe('School Setup & Settings (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-school-admin@test.local';
  const PLAIN = 'e2e-school-plain@test.local';
  const TOUCHED_SETTINGS = [
    'email.smtp_host',
    'email.smtp_port',
    'email.from_email',
    'email.smtp_pass',
  ];

  let adminToken: string;
  let plainToken: string;
  let originalSchool: School;
  let originalSettings: Array<{ key: string; value: unknown; group: string }>;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => request(app.getHttpServer());

  const cleanupUsers = async () => {
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
    await syncPermissionRegistry(prisma);
    await seedSystemRoles(prisma, DEFAULT_SCHOOL_ID);
    await seedNctbGradingSystem(prisma, DEFAULT_SCHOOL_ID);
    await cleanupUsers();

    // Snapshot shared state we mutate.
    originalSchool = await prisma.school.findUniqueOrThrow({
      where: { id: DEFAULT_SCHOOL_ID },
    });
    originalSettings = (
      await prisma.schoolSetting.findMany({
        where: { schoolId: DEFAULT_SCHOOL_ID, key: { in: TOUCHED_SETTINGS } },
      })
    ).map((r) => ({ key: r.key, value: r.value, group: r.group }));

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
    // Restore shared school fields + settings rows; drop test roles/systems.
    await prisma.school.update({
      where: { id: DEFAULT_SCHOOL_ID },
      data: {
        name: originalSchool.name,
        eiinNumber: originalSchool.eiinNumber,
        principalName: originalSchool.principalName,
      },
    });
    await prisma.schoolSetting.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, key: { in: TOUCHED_SETTINGS } },
    });
    for (const row of originalSettings) {
      await prisma.schoolSetting.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          key: row.key,
          value: row.value as object,
          group: row.group as never,
        },
      });
    }
    await prisma.gradingSystem.updateMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: 'NCTB Standard' },
      data: { isDefault: true },
    });
    await prisma.gradingSystem.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E ' } },
    });
    await cleanupUsers();
    await app.close();
  });

  describe('school profile', () => {
    it('GET /school is identity data — any authenticated user', async () => {
      const res = await server()
        .get('/api/v1/school')
        .set(auth(plainToken))
        .expect(200);
      expect((res.body as { data: { code: string } }).data.code).toBeTruthy();
    });

    it('PUT /school requires school.update', async () => {
      await server()
        .put('/api/v1/school')
        .set(auth(plainToken))
        .send({ name: 'Nope' })
        .expect(403);
    });

    it('PUT /school updates the profile and writes an audit diff', async () => {
      const res = await server()
        .put('/api/v1/school')
        .set(auth(adminToken))
        .send({
          name: 'E2E High School',
          eiinNumber: '123456',
          principalName: 'Prof. E2E',
        })
        .expect(200);
      expect((res.body as { data: { name: string } }).data.name).toBe(
        'E2E High School',
      );

      // Audit writes are deliberately fire-and-forget (PROJECT_CONTEXT
      // §16: auditing must never delay or fail the mutation), so the row
      // may not exist the instant the response lands. Reading it once
      // lost that race under load; poll for it, as the other suites do.
      let entry: { newValues: unknown } | null = null;
      for (let attempt = 0; attempt < 40 && entry === null; attempt += 1) {
        entry = await prisma.auditLog.findFirst({
          where: {
            entityType: 'School',
            entityId: DEFAULT_SCHOOL_ID,
            action: 'UPDATE',
          },
          orderBy: { createdAt: 'desc' },
          select: { newValues: true },
        });
        if (entry === null) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      expect(entry?.newValues).toMatchObject({ name: 'E2E High School' });
    });

    it('rejects a malformed EIIN', async () => {
      await server()
        .put('/api/v1/school')
        .set(auth(adminToken))
        .send({ eiinNumber: '12345' })
        .expect(400);
    });
  });

  describe('settings', () => {
    it('GET returns registry defaults for an untouched group', async () => {
      const res = await server()
        .get('/api/v1/settings/exam')
        .set(auth(adminToken))
        .expect(200);
      const views = (
        res.body as {
          data: Array<{ key: string; value: unknown }>;
        }
      ).data;
      expect(views.find((v) => v.key === 'exam.default_pass_mark')?.value).toBe(
        33,
      );
    });

    it('is permission-guarded', async () => {
      await server()
        .get('/api/v1/settings/email')
        .set(auth(plainToken))
        .expect(403);
      await server()
        .put('/api/v1/settings/email')
        .set(auth(plainToken))
        .send({})
        .expect(403);
    });

    it('rejects an unknown group and unknown/mistyped keys', async () => {
      await server()
        .get('/api/v1/settings/bogus')
        .set(auth(adminToken))
        .expect(400);
      await server()
        .put('/api/v1/settings/email')
        .set(auth(adminToken))
        .send({ nonsense: true })
        .expect(400);
      await server()
        .put('/api/v1/settings/email')
        .set(auth(adminToken))
        .send({ 'email.smtp_port': 'twenty-five' })
        .expect(400);
    });

    it('saves a group; secrets come back masked and the mask keeps the value', async () => {
      await server()
        .put('/api/v1/settings/email')
        .set(auth(adminToken))
        .send({
          'email.smtp_host': 'localhost',
          'email.smtp_port': 1025,
          'email.from_email': 'test@hexschool.local',
          'email.smtp_pass': 'super-secret',
        })
        .expect(200);

      const res = await server()
        .get('/api/v1/settings/email')
        .set(auth(adminToken))
        .expect(200);
      const views = (
        res.body as {
          data: Array<{ key: string; value: unknown; secret: boolean }>;
        }
      ).data;
      expect(views.find((v) => v.key === 'email.smtp_pass')?.value).toBe(
        '__SECRET__',
      );

      const storedBefore = await prisma.schoolSetting.findUnique({
        where: {
          schoolId_key: {
            schoolId: DEFAULT_SCHOOL_ID,
            key: 'email.smtp_pass',
          },
        },
      });
      // Round-tripping the mask must not rewrite the ciphertext.
      await server()
        .put('/api/v1/settings/email')
        .set(auth(adminToken))
        .send({
          'email.smtp_pass': '__SECRET__',
          'email.smtp_host': 'localhost',
        })
        .expect(200);
      const storedAfter = await prisma.schoolSetting.findUnique({
        where: {
          schoolId_key: {
            schoolId: DEFAULT_SCHOOL_ID,
            key: 'email.smtp_pass',
          },
        },
      });
      expect(storedAfter?.value).toEqual(storedBefore?.value);
      expect(storedAfter?.value).not.toBe('super-secret'); // encrypted at rest
    });

    it('test-email sends through the SAVED config (Mailpit)', async () => {
      const res = await server()
        .post('/api/v1/settings/test-email')
        .set(auth(adminToken))
        .send({})
        .expect(200);
      expect((res.body as { data: { ok: boolean } }).data.ok).toBe(true);
    });

    it('test-sms is log-only until Module 17', async () => {
      const res = await server()
        .post('/api/v1/settings/test-sms')
        .set(auth(adminToken))
        .send({})
        .expect(200);
      const data = (res.body as { data: { ok: boolean; detail: string } }).data;
      expect(data.ok).toBe(true);
      expect(data.detail).toContain('Module 17');
    });
  });

  describe('grading systems', () => {
    let customId: string;

    it('lists the NCTB seed with its 7 bands (permission-guarded)', async () => {
      await server()
        .get('/api/v1/grading-systems')
        .set(auth(plainToken))
        .expect(403);

      const res = await server()
        .get('/api/v1/grading-systems')
        .set(auth(adminToken))
        .expect(200);
      const systems = (
        res.body as {
          data: Array<{
            name: string;
            isDefault: boolean;
            gradePoints: unknown[];
          }>;
        }
      ).data;
      const nctb = systems.find((s) => s.name === 'NCTB Standard');
      expect(nctb?.isDefault).toBe(true);
      expect(nctb?.gradePoints).toHaveLength(7);
    });

    it('rejects overlapping bands', async () => {
      await server()
        .post('/api/v1/grading-systems')
        .set(auth(adminToken))
        .send({
          name: 'E2E Broken',
          gradePoints: [
            { grade: 'A', point: 5, minMark: 60, maxMark: 100 },
            { grade: 'B', point: 4, minMark: 50, maxMark: 60 },
          ],
        })
        .expect(400);
    });

    it('creates a gappy NON-default system, refuses to promote it', async () => {
      const res = await server()
        .post('/api/v1/grading-systems')
        .set(auth(adminToken))
        .send({
          name: 'E2E Partial',
          gradePoints: [{ grade: 'PASS', point: 4, minMark: 40, maxMark: 100 }],
        })
        .expect(201);
      customId = (res.body as { data: { id: string } }).data.id;

      await server()
        .put(`/api/v1/grading-systems/${customId}`)
        .set(auth(adminToken))
        .send({ isDefault: true })
        .expect(400);
    });

    it('a covering system can become default; the old default is demoted', async () => {
      await server()
        .put(`/api/v1/grading-systems/${customId}`)
        .set(auth(adminToken))
        .send({
          isDefault: true,
          gradePoints: [
            { grade: 'PASS', point: 4, minMark: 33, maxMark: 100 },
            { grade: 'FAIL', point: 0, minMark: 0, maxMark: 32 },
          ],
        })
        .expect(200);

      const res = await server()
        .get('/api/v1/grading-systems')
        .set(auth(adminToken))
        .expect(200);
      const systems = (
        res.body as {
          data: Array<{ id: string; name: string; isDefault: boolean }>;
        }
      ).data;
      expect(systems.find((s) => s.id === customId)?.isDefault).toBe(true);
      expect(systems.find((s) => s.name === 'NCTB Standard')?.isDefault).toBe(
        false,
      );
    });

    it('the default cannot be deleted; after switching back it can', async () => {
      await server()
        .delete(`/api/v1/grading-systems/${customId}`)
        .set(auth(adminToken))
        .expect(409);

      const list = await server()
        .get('/api/v1/grading-systems')
        .set(auth(adminToken))
        .expect(200);
      const nctb = (
        list.body as {
          data: Array<{ id: string; name: string }>;
        }
      ).data.find((s) => s.name === 'NCTB Standard');

      await server()
        .put(`/api/v1/grading-systems/${nctb!.id}`)
        .set(auth(adminToken))
        .send({ isDefault: true })
        .expect(200);
      await server()
        .delete(`/api/v1/grading-systems/${customId}`)
        .set(auth(adminToken))
        .expect(200);
    });
  });
});
