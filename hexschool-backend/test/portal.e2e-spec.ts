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
  /** Restored in cleanup — see the note where it is captured. */
  let previousCurrentSessionId: string | null = null;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;

  const emails = [ADMIN, PLAIN, STUDENT_A, PARENT, TEACHER];

  const cleanup = async () => {
    await prisma.contactMessage.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    // M28 — "Contact School" now opens a ticket rather than filing an
    // office-inbox message, so this suite creates rows in a second table
    // and has to take them away again.
    await prisma.ticketComment.deleteMany({
      where: { ticket: { subject: { startsWith: NAME } } },
    });
    await prisma.ticket.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, subject: { startsWith: NAME } },
    });
    await prisma.leaveApplication.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, reason: { contains: NAME } },
    });
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
    // Hand the current-session flag back before the next suite runs.
    if (previousCurrentSessionId) {
      await prisma.academicSession.update({
        where: { id: previousCurrentSessionId },
        data: { isCurrent: true },
      });
      previousCurrentSessionId = null;
    }
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

    // This suite needs a *current* session: the routine read and the M08
    // leave rule both resolve through `getCurrent`. Only one session per
    // school may be current (M05 partial unique), so remember whichever
    // one held the flag and hand it back in cleanup — the academic suite
    // asserts on it.
    const incumbent = await prisma.academicSession.findFirst({
      where: { schoolId: DEFAULT_SCHOOL_ID, isCurrent: true, deletedAt: null },
      select: { id: true },
    });
    previousCurrentSessionId = incumbent?.id ?? null;
    if (incumbent) {
      await prisma.academicSession.update({
        where: { id: incumbent.id },
        data: { isCurrent: false },
      });
    }

    const session = await prisma.academicSession.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `E2E-PORTAL ${new Date().getUTCFullYear()}`,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        status: 'ACTIVE',
        isCurrent: true,
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

  // Every route added after the original IDOR matrix has to join it —
  // a new portal endpoint is a new chance to leak a stranger's child.
  it('403s a parent on a stranger’s profile/documents/routine/report-card', async () => {
    for (const path of [
      `profile`,
      `documents`,
      `routine`,
      `report-card/${randomUUID()}`,
    ]) {
      await server()
        .get(`/api/v1/portal/parent/child/${studentBId}/${path}`)
        .set(auth(parentToken))
        .expect(403);
    }
  });

  it('lets a parent read their own child’s profile and documents', async () => {
    const profile = await server()
      .get(`/api/v1/portal/parent/child/${studentAId}/profile`)
      .set(auth(parentToken))
      .expect(200);
    const p = dataOf<{
      student: { id: string };
      guardians: Array<{ name: string }>;
    }>(profile);
    expect(p.student.id).toBe(studentAId);
    expect(p.guardians.map((g) => g.name)).toContain(`${NAME} Parent`);

    const docs = await server()
      .get(`/api/v1/portal/parent/child/${studentAId}/documents`)
      .set(auth(parentToken))
      .expect(200);
    // Certificates stay a self-describing stub until M27.
    expect(
      dataOf<{ certificates: { available: boolean } }>(docs).certificates
        .available,
    ).toBe(false);
  });

  it('never exposes the office’s internal status trail on the portal profile', async () => {
    const res = await server()
      .get('/api/v1/portal/student/profile')
      .set(auth(studentAToken))
      .expect(200);
    const body = dataOf<Record<string, unknown>>(res);
    expect(body).not.toHaveProperty('statusHistory');
    expect(body).not.toHaveProperty('medical');
  });

  it('404s a report card for an exam with no published result', async () => {
    await server()
      .get(`/api/v1/portal/student/report-card/${randomUUID()}`)
      .set(auth(studentAToken))
      .expect(404);
  });

  it('serves the student routine as an empty grid when none is published', async () => {
    const res = await server()
      .get('/api/v1/portal/student/routine')
      .set(auth(studentAToken))
      .expect(200);
    // The section resolves but no timetable was published, so the payload is
    // an empty grid — not a 404, and not a draft leaking into a portal.
    const d = dataOf<{ available: boolean; cells: unknown[] }>(res);
    expect(d.available).toBe(true);
    expect(d.cells).toEqual([]);
  });

  it('tells an unenrolled student why there is no routine, rather than 404ing', async () => {
    // Student B has an enrollment but no portal user; the reasoned-payload
    // branch is what a mid-setup school hits, so assert it directly.
    const unenrolled = await prisma.student.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        studentUid: `E2E-PORTAL-C-${Date.now()}`,
        firstName: NAME,
        lastName: 'Charlie',
        gender: 'MALE',
        dob: new Date('2014-03-03'),
        admissionDate: new Date('2026-01-02'),
        qrToken: randomUUID(),
      },
    });
    const res = await server()
      .get(`/api/v1/portal/parent/child/${unenrolled.id}/routine`)
      .set(auth(adminToken))
      .expect(403);
    // An admin is not an owner either — ownership is the only key here.
    expect(res.status).toBe(403);
  });

  it('lists the payable invoices Pay Now may be pointed at', async () => {
    const res = await server()
      .get('/api/v1/portal/student/dues')
      .set(auth(studentAToken))
      .expect(200);
    expect(
      Array.isArray(
        dataOf<{ payableInvoices: unknown[] }>(res).payableInvoices,
      ),
    ).toBe(true);
  });

  // ── messages + contact ──────────────────────────────────────────────

  it('serves a self-scoped message history with no id to tamper with', async () => {
    const res = await server()
      .get('/api/v1/portal/messages')
      .set(auth(parentToken))
      .expect(200);
    expect(Array.isArray(dataOf<{ items: unknown[] }>(res).items)).toBe(true);
  });

  /**
   * **Changed by M28.** This used to file into the M19 `contact_messages`
   * inbox; it now opens a real M28 ticket the family can follow, reply on
   * and rate. The property being asserted is unchanged and is the one that
   * mattered all along: **the sender comes from the account, never from
   * the request body.**
   */
  it('accepts a portal contact message and files it under the account’s own row', async () => {
    const res = await server()
      .post('/api/v1/portal/contact-school')
      .set(auth(parentToken))
      .send({
        subject: 'E2EPORTAL question',
        body: 'Is there class on Sunday?',
      })
      .expect(201);

    const ticketNo = dataOf<{ ticketNo: string }>(res).ticketNo;
    expect(ticketNo).toMatch(/^CMP-/);

    const guardian = await prisma.guardian.findFirst({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: `${NAME} Parent` },
    });
    const row = await prisma.ticket.findFirst({
      where: { schoolId: DEFAULT_SCHOOL_ID, ticketNo },
    });
    expect(row?.raisedByType).toBe('GUARDIAN');
    expect(row?.raisedById).toBe(guardian?.id);
  });

  it('refuses a contact message that tries to set its own sender', async () => {
    await server()
      .post('/api/v1/portal/contact-school')
      .set(auth(parentToken))
      .send({ name: 'Someone Else', body: 'Impersonation attempt' })
      .expect(400);
  });

  it('404s a payment status for a reference that is not ours', async () => {
    await server()
      .get('/api/v1/portal/payment-status')
      .query({ reference: `E2EPORTAL-${randomUUID()}` })
      .set(auth(parentToken))
      .expect(404);
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

  it('lets a teacher read and file their own leave, never a colleague’s', async () => {
    const before = await server()
      .get('/api/v1/portal/teacher/leaves')
      .set(auth(teacherToken))
      .expect(200);
    // The envelope lifts `meta` out of a paginated handler, so the rows sit
    // directly in `data` — one unwrap, not two.
    expect(Array.isArray(dataOf<unknown[]>(before))).toBe(true);

    // Leave attaches to the session covering its dates (M21), so they come from
    // whichever session the school actually has current — this suite must
    // not flip `is_current`, which the academic suite asserts on.
    const current = await prisma.academicSession.findFirst({
      where: { schoolId: DEFAULT_SCHOOL_ID, isCurrent: true, deletedAt: null },
      select: { startDate: true },
    });
    const day = (offset: number) => {
      const d = new Date(current!.startDate);
      d.setUTCDate(d.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    };

    // M21: leave now hangs off a `leave_types` row, seeded per school.
    const casual = await prisma.leaveType.findFirst({
      where: { schoolId: DEFAULT_SCHOOL_ID, code: 'CASUAL', deletedAt: null },
      select: { id: true },
    });

    await server()
      .post('/api/v1/portal/teacher/leaves')
      .set(auth(teacherToken))
      .send({
        fromDate: day(30),
        toDate: day(31),
        leaveTypeId: casual!.id,
        reason: 'E2EPORTAL leave',
      })
      .expect(201);

    const filed = await prisma.leaveApplication.findFirst({
      where: { schoolId: DEFAULT_SCHOOL_ID, reason: 'E2EPORTAL leave' },
      select: { status: true },
    });
    // Filed, not auto-approved — the M21 approval flow still owns that.
    expect(filed?.status).toBe('PENDING');

    // The route has no personId to pass — supplying one is rejected by the
    // whitelist, so a teacher cannot apply in a colleague's name.
    await server()
      .post('/api/v1/portal/teacher/leaves')
      .set(auth(teacherToken))
      .send({
        personId: randomUUID(),
        fromDate: day(40),
        toDate: day(41),
        leaveTypeId: casual!.id,
        reason: 'E2EPORTAL leave 2',
      })
      .expect(400);
  });

  it('404s a non-teacher on the teacher leave routes', async () => {
    await server()
      .get('/api/v1/portal/teacher/leaves')
      .set(auth(studentAToken))
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

  it('ships the four chart series on the admin dashboard', async () => {
    // Cached from the previous case, so bust it to exercise a live compute.
    const res = await server()
      .get('/api/v1/dashboard/admin')
      .set(auth(adminToken))
      .expect(200);
    const d = dataOf<{
      attendanceTrend: Array<{ date: string; percentage: number | null }>;
      collectionTrend: unknown[];
      recentActivity: Array<{ id: string }>;
      gpaDistribution: unknown;
    }>(res);

    // Exactly 30 days, oldest first, with unmarked days as null rather than
    // a zero that would read as "everybody was absent".
    expect(d.attendanceTrend).toHaveLength(30);
    expect(
      d.attendanceTrend.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date)),
    ).toBe(true);
    expect(
      d.attendanceTrend.every(
        (p) => p.percentage === null || typeof p.percentage === 'number',
      ),
    ).toBe(true);
    expect(d.collectionTrend).toHaveLength(6);
    // BIGSERIAL audit ids must be stringified — a BigInt would not survive
    // JSON serialization.
    for (const row of d.recentActivity) {
      expect(typeof row.id).toBe('string');
    }
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
