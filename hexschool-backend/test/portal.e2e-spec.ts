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
 * Requires dev infra (DB + redis). The M18 security core: portal reads are
 * authorized by OWNERSHIP, not permissions, so this suite is mostly an
 * IDOR matrix — a parent may read their own child but not a stranger's, a
 * student only themselves, and the admin dashboards need the dashboard
 * permissions. It also smoke-tests the aggregate endpoints render for a
 * freshly-created (zero-data) student without crashing (roadmap §8).
 */
describe('Portals & Dashboards (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-portal-admin@test.local';
  const PLAIN = 'e2e-portal-plain@test.local';
  const STUDENT_A = 'e2e-portal-studentA@test.local';
  const PARENT = 'e2e-portal-parent@test.local';
  const TEACHER = 'e2e-portal-teacher@test.local';
  const NAME = 'E2EPORTAL';

  let adminToken: string;
  let plainToken: string;
  let studentAToken: string;
  let parentToken: string;
  let teacherToken: string;

  let studentAId: string;
  let studentBId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;

  const emails = [ADMIN, PLAIN, STUDENT_A, PARENT, TEACHER];

  const cleanup = async () => {
    await prisma.enrollment.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, student: { firstName: NAME } },
    });
    await prisma.studentGuardian.deleteMany({
      where: { student: { firstName: NAME } },
    });
    await prisma.guardian.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.student.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: NAME },
    });
    await prisma.teacher.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: NAME },
    });
    await prisma.academicSession.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: { startsWith: 'E2E-PORTAL ' },
      },
    });
    await prisma.schoolClass.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: { startsWith: 'E2EPORTALClass' },
      },
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
    const mk = (email: string, userType: UserType) =>
      prisma.user.create({
        data: { schoolId: DEFAULT_SCHOOL_ID, email, passwordHash, userType },
      });
    const [adminUser, , studentUserA, parentUser, teacherUser] =
      await Promise.all([
        mk(ADMIN, UserType.ADMIN),
        mk(PLAIN, UserType.STAFF),
        mk(STUDENT_A, UserType.STUDENT),
        mk(PARENT, UserType.PARENT),
        mk(TEACHER, UserType.TEACHER),
      ]);

    const adminRole = await prisma.role.findFirst({
      where: { schoolId: DEFAULT_SCHOOL_ID, slug: 'admin', deletedAt: null },
    });
    await prisma.userRole.create({
      data: { userId: adminUser.id, roleId: adminRole!.id },
    });

    const session = await prisma.academicSession.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `E2E-PORTAL ${new Date().getUTCFullYear()}`,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        status: 'ACTIVE',
      },
    });
    const klass = await prisma.schoolClass.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: 'E2EPORTALClassA',
        numericLevel: 6,
      },
    });
    const section = await prisma.section.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        classId: klass.id,
        sessionId: session.id,
        name: 'A1',
      },
    });

    // Student A — linked to the student portal user. Guardian G links to A
    // and to the parent portal user.
    const studentA = await prisma.student.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        userId: studentUserA.id,
        studentUid: `E2E-PORTAL-A-${Date.now()}`,
        firstName: NAME,
        lastName: 'Alpha',
        gender: 'MALE',
        dob: new Date('2014-01-01'),
        admissionDate: new Date('2026-01-02'),
        admissionClassId: klass.id,
        qrToken: randomUUID(),
      },
    });
    studentAId = studentA.id;
    const guardian = await prisma.guardian.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        userId: parentUser.id,
        name: `${NAME} Parent`,
        phone: '01990001111',
      },
    });
    await prisma.studentGuardian.create({
      data: {
        studentId: studentA.id,
        guardianId: guardian.id,
        isPrimary: true,
      },
    });
    await prisma.enrollment.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        studentId: studentA.id,
        sessionId: session.id,
        classId: klass.id,
        sectionId: section.id,
        rollNo: 1,
        enrollmentDate: new Date('2026-01-02'),
        status: 'ACTIVE',
      },
    });

    // Student B — a stranger the parent/student must NOT be able to read.
    const studentB = await prisma.student.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        studentUid: `E2E-PORTAL-B-${Date.now()}`,
        firstName: NAME,
        lastName: 'Bravo',
        gender: 'FEMALE',
        dob: new Date('2014-02-02'),
        admissionDate: new Date('2026-01-02'),
        admissionClassId: klass.id,
        qrToken: randomUUID(),
      },
    });
    studentBId = studentB.id;
    await prisma.enrollment.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        studentId: studentB.id,
        sessionId: session.id,
        classId: klass.id,
        sectionId: section.id,
        rollNo: 2,
        enrollmentDate: new Date('2026-01-02'),
        status: 'ACTIVE',
      },
    });

    // Teacher — linked to the teacher portal user.
    await prisma.teacher.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        userId: teacherUser.id,
        employeeId: `E2EPT-${Date.now()}`,
        firstName: NAME,
        lastName: 'Teacher',
        gender: 'MALE',
        dob: new Date('1990-01-01'),
        designation: 'ASSISTANT_TEACHER',
        joiningDate: new Date('2026-01-01'),
        status: 'ACTIVE',
      },
    });

    const login = async (identifier: string) => {
      const res = await server()
        .post('/api/v1/auth/login')
        .send({ identifier, password: PASSWORD })
        .expect(200);
      return dataOf<{ accessToken: string }>(res).accessToken;
    };
    adminToken = await login(ADMIN);
    plainToken = await login(PLAIN);
    studentAToken = await login(STUDENT_A);
    parentToken = await login(PARENT);
    teacherToken = await login(TEACHER);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  // ── portal principal ────────────────────────────────────────────────

  it('resolves the student principal to their own record', async () => {
    const res = await server()
      .get('/api/v1/portal/me')
      .set(auth(studentAToken))
      .expect(200);
    const me = dataOf<{ studentId: string; children: { studentId: string }[] }>(
      res,
    );
    expect(me.studentId).toBe(studentAId);
    expect(me.children.map((c) => c.studentId)).toEqual([studentAId]);
  });

  it('resolves the parent principal to their linked child only', async () => {
    const res = await server()
      .get('/api/v1/portal/me')
      .set(auth(parentToken))
      .expect(200);
    const me = dataOf<{ children: { studentId: string }[] }>(res);
    expect(me.children.map((c) => c.studentId)).toEqual([studentAId]);
  });

  // ── student self ────────────────────────────────────────────────────

  it('renders the student overview with zero-data gracefully', async () => {
    const res = await server()
      .get('/api/v1/portal/student/overview')
      .set(auth(studentAToken))
      .expect(200);
    const d = dataOf<{ student: { id: string }; averageGpa: number }>(res);
    expect(d.student.id).toBe(studentAId);
    expect(d.averageGpa).toBe(0);
  });

  it('serves student attendance/results/dues to the student', async () => {
    await server()
      .get('/api/v1/portal/student/attendance')
      .set(auth(studentAToken))
      .expect(200);
    await server()
      .get('/api/v1/portal/student/results')
      .set(auth(studentAToken))
      .expect(200);
    await server()
      .get('/api/v1/portal/student/dues')
      .set(auth(studentAToken))
      .expect(200);
  });

  // ── parent → child ──────────────────────────────────────────────────

  it('lets a parent read their own child', async () => {
    await server()
      .get(`/api/v1/portal/parent/child/${studentAId}/overview`)
      .set(auth(parentToken))
      .expect(200);
    await server()
      .get(`/api/v1/portal/parent/child/${studentAId}/results`)
      .set(auth(parentToken))
      .expect(200);
  });

  it('403s a parent reading a stranger’s child (IDOR)', async () => {
    await server()
      .get(`/api/v1/portal/parent/child/${studentBId}/overview`)
      .set(auth(parentToken))
      .expect(403);
    await server()
      .get(`/api/v1/portal/parent/child/${studentBId}/dues`)
      .set(auth(parentToken))
      .expect(403);
  });

  it('403s a student reading another student via the child route (IDOR)', async () => {
    await server()
      .get(`/api/v1/portal/parent/child/${studentBId}/overview`)
      .set(auth(studentAToken))
      .expect(403);
  });

  it('lets a student read themselves through the child route (owns self)', async () => {
    await server()
      .get(`/api/v1/portal/parent/child/${studentAId}/overview`)
      .set(auth(studentAToken))
      .expect(200);
  });

  // ── teacher ─────────────────────────────────────────────────────────

  it('renders the teacher overview', async () => {
    const res = await server()
      .get('/api/v1/portal/teacher/overview')
      .set(auth(teacherToken))
      .expect(200);
    const d = dataOf<{ teacher: { name: string } }>(res);
    expect(d.teacher.name).toContain(NAME);
  });

  it('404s a non-student asking for the student overview', async () => {
    await server()
      .get('/api/v1/portal/student/overview')
      .set(auth(teacherToken))
      .expect(404);
  });

  // ── dashboards + reports ────────────────────────────────────────────

  it('gates the admin dashboard behind dashboard.admin', async () => {
    await server()
      .get('/api/v1/dashboard/admin')
      .set(auth(plainToken))
      .expect(403);
    const res = await server()
      .get('/api/v1/dashboard/admin')
      .set(auth(adminToken))
      .expect(200);
    const d = dataOf<{ students: { total: number } }>(res);
    expect(typeof d.students.total).toBe('number');
  });

  it('serves the accountant dashboard to an admin', async () => {
    await server()
      .get('/api/v1/dashboard/accountant')
      .set(auth(adminToken))
      .expect(200);
  });

  it('filters the reports hub by the caller’s permissions', async () => {
    const admin = await server()
      .get('/api/v1/reports')
      .set(auth(adminToken))
      .expect(200);
    expect(dataOf<unknown[]>(admin).length).toBeGreaterThan(0);

    const student = await server()
      .get('/api/v1/reports')
      .set(auth(studentAToken))
      .expect(200);
    expect(dataOf<unknown[]>(student)).toEqual([]);
  });

  it('refuses a portal user the admin dashboard', async () => {
    await server()
      .get('/api/v1/dashboard/admin')
      .set(auth(studentAToken))
      .expect(403);
  });
});
