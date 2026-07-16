import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
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

/**
 * Requires dev infra (DB + redis). Test rows use E2E prefixes and
 * far-future sessions (2094/2095) plus class levels 18/19 so they never
 * collide with real dev data; afterAll removes everything (session FK
 * cascades take sections + class_subjects).
 */
describe('Academic Structure (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-structure-admin@test.local';
  const PLAIN = 'e2e-structure-plain@test.local';

  let adminToken: string;
  let plainToken: string;
  let sessionA: string;
  let sessionB: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => request(app.getHttpServer());
  const id = (res: request.Response): string =>
    (res.body as { data: { id: string } }).data.id;

  const cleanup = async () => {
    await prisma.academicSession.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E-S ' } },
    });
    await prisma.subject.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, code: { startsWith: 'E2E' } },
    });
    await prisma.schoolClass.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E ' } },
    });
    await prisma.group.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E ' } },
    });
    await prisma.shift.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E ' } },
    });
    await prisma.department.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, code: { startsWith: 'E2E' } },
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
    await syncPermissionRegistry(prisma);
    await seedSystemRoles(prisma, DEFAULT_SCHOOL_ID);
    await cleanup();

    const [a, b] = await Promise.all([
      prisma.academicSession.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          name: 'E2E-S 2094',
          startDate: new Date('2094-01-01'),
          endDate: new Date('2094-12-31'),
        },
      }),
      prisma.academicSession.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          name: 'E2E-S 2095',
          startDate: new Date('2095-01-01'),
          endDate: new Date('2095-12-31'),
        },
      }),
    ]);
    sessionA = a.id;
    sessionB = b.id;

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
    await cleanup();
    await app.close();
  });

  let classSenior: string; // level 19
  let classJunior: string; // level 18
  let shiftId: string;
  let groupId: string;
  let subjectPhy: string;
  let subjectChe: string;
  let sectionId: string;

  it('masters are permission-guarded', async () => {
    await server().get('/api/v1/classes').set(auth(plainToken)).expect(403);
    await server()
      .post('/api/v1/subjects')
      .set(auth(plainToken))
      .send({ name: 'Nope', code: 'E2ENO' })
      .expect(403);
  });

  it('creates the masters (department, shift, classes, group, subjects)', async () => {
    await server()
      .post('/api/v1/departments')
      .set(auth(adminToken))
      .send({ name: 'E2E Science Dept', code: 'E2E-SCI' })
      .expect(201);

    shiftId = id(
      await server()
        .post('/api/v1/shifts')
        .set(auth(adminToken))
        .send({ name: 'E2E Morning', startTime: '07:30', endTime: '12:00' })
        .expect(201),
    );

    classSenior = id(
      await server()
        .post('/api/v1/classes')
        .set(auth(adminToken))
        .send({ name: 'E2E Class 19', numericLevel: 19 })
        .expect(201),
    );
    classJunior = id(
      await server()
        .post('/api/v1/classes')
        .set(auth(adminToken))
        .send({ name: 'E2E Class 18', numericLevel: 18 })
        .expect(201),
    );

    groupId = id(
      await server()
        .post('/api/v1/groups')
        .set(auth(adminToken))
        .send({ name: 'E2E Stream', applicableFromLevel: 19 })
        .expect(201),
    );

    subjectPhy = id(
      await server()
        .post('/api/v1/subjects')
        .set(auth(adminToken))
        .send({ name: 'E2E Physics', code: 'E2EPHY', type: 'BOTH' })
        .expect(201),
    );
    subjectChe = id(
      await server()
        .post('/api/v1/subjects')
        .set(auth(adminToken))
        .send({ name: 'E2E Chemistry', code: 'E2ECHE' })
        .expect(201),
    );
  });

  it('uniqueness violations → 409; bad shift times → 400', async () => {
    await server()
      .post('/api/v1/classes')
      .set(auth(adminToken))
      .send({ name: 'E2E Dup Level', numericLevel: 19 })
      .expect(409);
    await server()
      .post('/api/v1/subjects')
      .set(auth(adminToken))
      .send({ name: 'E2E Dup Code', code: 'E2EPHY' })
      .expect(409);
    await server()
      .post('/api/v1/shifts')
      .set(auth(adminToken))
      .send({ name: 'E2E Bad', startTime: '13:00', endTime: '08:00' })
      .expect(400);
  });

  describe('sections', () => {
    it('creates a section; identity duplicate → 409', async () => {
      sectionId = id(
        await server()
          .post('/api/v1/sections')
          .set(auth(adminToken))
          .send({
            classId: classSenior,
            sessionId: sessionA,
            name: 'A',
            shiftId,
            groupId,
            capacity: 40,
          })
          .expect(201),
      );

      await server()
        .post('/api/v1/sections')
        .set(auth(adminToken))
        .send({
          classId: classSenior,
          sessionId: sessionA,
          name: 'a', // case-insensitive duplicate
          shiftId,
        })
        .expect(409);
    });

    it('group below its applicable level → 400', async () => {
      await server()
        .post('/api/v1/sections')
        .set(auth(adminToken))
        .send({
          classId: classJunior, // level 18 < group's 19
          sessionId: sessionA,
          name: 'A',
          groupId,
        })
        .expect(400);
    });
  });

  describe('class-subject mapping', () => {
    it('bulk assign persists rows in payload order', async () => {
      await server()
        .put(`/api/v1/classes/${classSenior}/subjects`)
        .set(auth(adminToken))
        .send({
          sessionId: sessionA,
          subjects: [
            { subjectId: subjectChe },
            { subjectId: subjectPhy, isOptional: true, fullMarksDefault: 50 },
          ],
        })
        .expect(200);

      const res = await server()
        .get(`/api/v1/classes/${classSenior}/subjects?sessionId=${sessionA}`)
        .set(auth(adminToken))
        .expect(200);
      const rows = (
        res.body as {
          data: Array<{
            subject: { code: string };
            isOptional: boolean;
            displayOrder: number;
          }>;
        }
      ).data;
      expect(rows.map((r) => r.subject.code)).toEqual(['E2ECHE', 'E2EPHY']);
      expect(rows[1].isOptional).toBe(true);
    });

    it('re-PUT with reversed order persists the new order', async () => {
      await server()
        .put(`/api/v1/classes/${classSenior}/subjects`)
        .set(auth(adminToken))
        .send({
          sessionId: sessionA,
          subjects: [{ subjectId: subjectPhy }, { subjectId: subjectChe }],
        })
        .expect(200);
      const res = await server()
        .get(`/api/v1/classes/${classSenior}/subjects?sessionId=${sessionA}`)
        .set(auth(adminToken))
        .expect(200);
      const codes = (
        res.body as { data: Array<{ subject: { code: string } }> }
      ).data.map((r) => r.subject.code);
      expect(codes).toEqual(['E2EPHY', 'E2ECHE']);
    });

    it('unknown subject id → 400', async () => {
      await server()
        .put(`/api/v1/classes/${classSenior}/subjects`)
        .set(auth(adminToken))
        .send({
          sessionId: sessionA,
          subjects: [{ subjectId: '00000000-0000-4000-8000-00000000dead' }],
        })
        .expect(400);
    });
  });

  describe('clone to new session', () => {
    it('preview reports counts without writing', async () => {
      const res = await server()
        .post('/api/v1/academic-structure/clone')
        .set(auth(adminToken))
        .send({ fromSessionId: sessionA, toSessionId: sessionB, preview: true })
        .expect(200);
      const report = (
        res.body as {
          data: {
            sections: { toCreate: number };
            classSubjects: { toCreate: number };
          };
        }
      ).data;
      expect(report.sections.toCreate).toBe(1);
      expect(report.classSubjects.toCreate).toBe(2);

      const targetSections = await prisma.section.count({
        where: { sessionId: sessionB },
      });
      expect(targetSections).toBe(0);
    });

    it('clone copies rows; a second clone is a no-op (idempotent)', async () => {
      await server()
        .post('/api/v1/academic-structure/clone')
        .set(auth(adminToken))
        .send({ fromSessionId: sessionA, toSessionId: sessionB })
        .expect(200);

      expect(
        await prisma.section.count({ where: { sessionId: sessionB } }),
      ).toBe(1);
      expect(
        await prisma.classSubject.count({ where: { sessionId: sessionB } }),
      ).toBe(2);

      const res = await server()
        .post('/api/v1/academic-structure/clone')
        .set(auth(adminToken))
        .send({ fromSessionId: sessionA, toSessionId: sessionB })
        .expect(200);
      const report = (
        res.body as {
          data: {
            sections: { toCreate: number; alreadyPresent: number };
            classSubjects: { toCreate: number };
          };
        }
      ).data;
      expect(report.sections).toEqual({ toCreate: 0, alreadyPresent: 1 });
      expect(report.classSubjects.toCreate).toBe(0);
    });
  });

  describe('delete guards (explanatory 409s)', () => {
    it('a class with sections/mappings cannot be deleted', async () => {
      await server()
        .delete(`/api/v1/classes/${classSenior}`)
        .set(auth(adminToken))
        .expect(409);
    });

    it('a mapped subject cannot be deleted', async () => {
      await server()
        .delete(`/api/v1/subjects/${subjectPhy}`)
        .set(auth(adminToken))
        .expect(409);
    });

    it('a shift in use cannot be deleted; unused it can', async () => {
      await server()
        .delete(`/api/v1/shifts/${shiftId}`)
        .set(auth(adminToken))
        .expect(409);

      await server()
        .delete(`/api/v1/sections/${sectionId}`)
        .set(auth(adminToken))
        .expect(200);
      // Section in the cloned session B still uses the shift.
      await server()
        .delete(`/api/v1/shifts/${shiftId}`)
        .set(auth(adminToken))
        .expect(409);
    });

    it('an unreferenced class deletes cleanly', async () => {
      await server()
        .delete(`/api/v1/classes/${classJunior}`)
        .set(auth(adminToken))
        .expect(200);
    });
  });
});
