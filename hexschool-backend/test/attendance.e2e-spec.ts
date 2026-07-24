import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  DEFAULT_SCHOOL_ID,
  SettingsGroup,
  UserType,
} from '../src/common/constants';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { SettingsService } from '../src/modules/school/services/settings.service';
import type { AccessTokenPayload } from '../src/modules/auth/interfaces/token-payload.interface';
import {
  seedSystemRoles,
  syncPermissionRegistry,
} from '../src/modules/rbac/seed/rbac.seeder';

/**
 * Requires dev infra (DB + redis). Attendance dates must fall inside the
 * session and may not be in the future, so unlike the other suites this
 * one needs a session spanning TODAY — it is created with a distinctive
 * name, is_current is never touched (the dev session keeps it), and
 * afterAll removes everything (session FK cascades take sections,
 * enrollments, attendance rows and leave applications).
 */
describe('Attendance (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-att-admin@test.local';
  const MARKER = 'e2e-att-marker@test.local';
  const PLAIN = 'e2e-att-plain@test.local';
  const NAME = 'E2EAtt';
  const ROLE_SLUG = 'e2e-att-marker';

  let adminToken: string;
  let markerToken: string;
  let plainToken: string;
  let classId: string;
  let sessionId: string;
  let sectionId: string;
  const studentIds: string[] = [];
  const enrollmentIds: string[] = [];

  /** Today and yesterday in Asia/Dhaka — the only markable dates here. */
  const dhaka = (offsetDays = 0) =>
    new Date(Date.now() + 6 * 3_600_000 + offsetDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
  const TODAY = dhaka(0);
  const YESTERDAY = dhaka(-1);
  const TOMORROW = dhaka(1);
  const YEAR = Number(TODAY.slice(0, 4));

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;

  const cleanup = async () => {
    await prisma.academicSession.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E-AT ' } },
    });
    await prisma.student.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: NAME },
    });
    await prisma.guardian.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: `${NAME} Guardian` },
    });
    await prisma.schoolClass.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: 'E2E AttClass' },
    });
    await prisma.role.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, slug: ROLE_SLUG },
    });
    const users = await prisma.user.findMany({
      where: { email: { in: [ADMIN, MARKER, PLAIN] } },
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

    // Marking uses the real "today"; without this the suite fails on
    // Fridays (the default weekly holiday blocks TODAY). Clear the weekly
    // off-day for the test school so every weekday is markable; restored
    // in afterAll. The explicit-holiday test uses a `holidays` row, so it
    // is unaffected.
    const settings = app.get(SettingsService);
    const sysActor: AccessTokenPayload = {
      sub: '00000000-0000-4000-8000-000000000001',
      schoolId: DEFAULT_SCHOOL_ID,
      userType: UserType.SUPER_ADMIN,
    };
    await settings.updateGroup(
      DEFAULT_SCHOOL_ID,
      SettingsGroup.general,
      { 'general.weekly_holidays': [] },
      sysActor,
    );

    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    const [adminUser, markerUser] = await Promise.all(
      (
        [
          [ADMIN, UserType.ADMIN],
          [MARKER, UserType.TEACHER],
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

    // A marker who may mark and edit but holds NEITHER the holiday
    // override NOR the past-edit permission — the two runtime checks.
    const markerRole = await prisma.role.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: 'E2E Attendance Marker',
        slug: ROLE_SLUG,
      },
    });
    const codes = await prisma.permission.findMany({
      where: {
        code: {
          in: [
            'attendance.view',
            'attendance.mark',
            'attendance.edit',
            'enrollment.view',
            'student.leave.view',
            'student.leave.manage',
            'student.leave.approve',
          ],
        },
      },
      select: { id: true },
    });
    await prisma.rolePermission.createMany({
      data: codes.map((p) => ({ roleId: markerRole.id, permissionId: p.id })),
    });
    await prisma.userRole.create({
      data: { userId: markerUser.id, roleId: markerRole.id },
    });

    const klass = await prisma.schoolClass.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: 'E2E AttClass',
        numericLevel: 18,
      },
    });
    classId = klass.id;

    // Spans today so attendance dates are inside the session.
    const session = await prisma.academicSession.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `E2E-AT ${YEAR}`,
        startDate: new Date(`${YEAR}-01-01`),
        endDate: new Date(`${YEAR}-12-31`),
        status: 'ACTIVE',
      },
    });
    sessionId = session.id;

    const section = await prisma.section.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        classId,
        sessionId,
        name: 'AT1',
      },
    });
    sectionId = section.id;

    const guardian = await prisma.guardian.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `${NAME} Guardian`,
        phone: '01712345678',
      },
    });

    for (let i = 0; i < 3; i += 1) {
      const student = await prisma.student.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          studentUid: `E2E-AT-${Date.now()}-${i}`,
          firstName: NAME,
          lastName: `Pupil${i}`,
          gender: 'MALE',
          dob: new Date('2013-05-05'),
          admissionDate: new Date(`${YEAR}-01-01`),
          admissionClassId: classId,
          qrToken: randomUUID(),
        },
      });
      studentIds.push(student.id);
      await prisma.studentGuardian.create({
        data: {
          studentId: student.id,
          guardianId: guardian.id,
          isPrimary: i === 0,
        },
      });
      const enrollment = await prisma.enrollment.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          studentId: student.id,
          sessionId,
          classId,
          sectionId,
          rollNo: i + 1,
          enrollmentDate: new Date(`${YEAR}-01-01`),
        },
      });
      enrollmentIds.push(enrollment.id);
    }

    const login = async (identifier: string) => {
      const res = await server()
        .post('/api/v1/auth/login')
        .send({ identifier, password: PASSWORD })
        .expect(200);
      return (res.body as { data: { accessToken: string } }).data.accessToken;
    };
    adminToken = await login(ADMIN);
    markerToken = await login(MARKER);
    plainToken = await login(PLAIN);
  }, 180_000);

  afterAll(async () => {
    // Restore the default weekly holiday for suites that run after this one.
    const settings = app.get(SettingsService);
    await settings.updateGroup(
      DEFAULT_SCHOOL_ID,
      SettingsGroup.general,
      { 'general.weekly_holidays': ['FRIDAY'] },
      {
        sub: '00000000-0000-4000-8000-000000000001',
        schoolId: DEFAULT_SCHOOL_ID,
        userType: UserType.SUPER_ADMIN,
      },
    );
    await cleanup();
    await app.close();
  }, 120_000);

  const mark = (body: object, token = adminToken) =>
    server().post('/api/v1/attendance/students').set(auth(token)).send(body);

  const sheet = (date: string, token = adminToken) =>
    server()
      .get('/api/v1/attendance/students')
      .query({ sectionId, date })
      .set(auth(token));

  const entries = (statuses: string[]) =>
    enrollmentIds.map((id, index) => ({
      enrollmentId: id,
      status: statuses[index],
    }));

  // ── guards ──────────────────────────────────────────────────────────

  it('is permission-guarded', async () => {
    await sheet(TODAY, plainToken).expect(403);
    await mark(
      {
        sectionId,
        date: TODAY,
        entries: entries(['PRESENT', 'PRESENT', 'PRESENT']),
      },
      plainToken,
    ).expect(403);
    await server()
      .get('/api/v1/attendance/staff')
      .query({ date: TODAY })
      .set(auth(plainToken))
      .expect(403);
  });

  it('validates the payload', async () => {
    await sheet('21-07-2026').expect(400);
    await mark({ sectionId, date: TODAY, entries: [] }).expect(400);
    await mark({
      sectionId,
      date: TODAY,
      entries: [{ enrollmentId: enrollmentIds[0], status: 'NOT_A_STATUS' }],
    }).expect(400);
    // Regex-valid but impossible calendar date (M05 parseDate rule).
    await sheet(`${YEAR}-13-99`).expect(400);
  });

  // ── marking ─────────────────────────────────────────────────────────

  it('serves an unmarked sheet with the full roster', async () => {
    const res = await sheet(TODAY).expect(200);
    const body = dataOf<{
      marked: boolean;
      editable: boolean;
      rows: Array<{ status: string | null; rollNo: number }>;
    }>(res);
    expect(body.marked).toBe(false);
    expect(body.editable).toBe(true);
    expect(body.rows).toHaveLength(3);
    expect(body.rows.every((r) => r.status === null)).toBe(true);
  });

  it('marks a section and reflects it on the sheet', async () => {
    const res = await mark({
      sectionId,
      date: TODAY,
      entries: entries(['PRESENT', 'ABSENT', 'LATE']),
    }).expect(201);
    expect(dataOf<{ saved: number }>(res).saved).toBe(3);

    const after = await sheet(TODAY).expect(200);
    const body = dataOf<{
      marked: boolean;
      rows: Array<{ status: string }>;
    }>(after);
    expect(body.marked).toBe(true);
    expect(body.rows.map((r) => r.status)).toEqual([
      'PRESENT',
      'ABSENT',
      'LATE',
    ]);
  });

  it('is idempotent — re-marking updates in place, never duplicates', async () => {
    await mark({
      sectionId,
      date: TODAY,
      entries: entries(['PRESENT', 'PRESENT', 'LATE']),
    }).expect(201);

    const rows = await prisma.studentAttendance.findMany({
      where: { sectionId, deletedAt: null },
    });
    expect(rows).toHaveLength(3);
    const second = rows.find((r) => r.enrollmentId === enrollmentIds[1]);
    expect(second!.status).toBe('PRESENT');
  });

  it('refuses future dates', async () => {
    await mark({
      sectionId,
      date: TOMORROW,
      entries: entries(['PRESENT', 'PRESENT', 'PRESENT']),
    }).expect(400);
  });

  it('skips entries that do not belong to the section', async () => {
    const res = await mark({
      sectionId,
      date: YESTERDAY,
      entries: [
        { enrollmentId: enrollmentIds[0], status: 'PRESENT' },
        { enrollmentId: randomUUID(), status: 'PRESENT' },
      ],
    }).expect(201);
    const body = dataOf<{ saved: number; skipped: unknown[] }>(res);
    expect(body.saved).toBe(1);
    expect(body.skipped).toHaveLength(1);
  });

  // ── holiday guard ───────────────────────────────────────────────────

  it('blocks marking a holiday; the override needs the permission', async () => {
    const holiday = await prisma.holiday.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        sessionId,
        title: 'E2E Declared Holiday',
        startDate: new Date(YESTERDAY),
        endDate: new Date(YESTERDAY),
        type: 'SCHOOL',
      },
    });

    const payload = {
      sectionId,
      date: YESTERDAY,
      entries: entries(['PRESENT', 'PRESENT', 'PRESENT']),
    };
    await mark(payload).expect(400);
    // The marker role deliberately lacks attendance.holiday.override.
    await mark({ ...payload, overrideHoliday: true }, markerToken).expect(403);
    await mark({ ...payload, overrideHoliday: true }).expect(201);

    await prisma.holiday.delete({ where: { id: holiday.id } });
  });

  it('converts an already-marked date to HOLIDAY', async () => {
    const res = await server()
      .post('/api/v1/attendance/convert-holiday')
      .set(auth(adminToken))
      .send({
        sectionId,
        date: YESTERDAY,
        reason: 'Government holiday declared late',
      })
      .expect(201);
    expect(dataOf<{ converted: number }>(res).converted).toBeGreaterThan(0);

    const rows = await prisma.studentAttendance.findMany({
      where: { sectionId, date: new Date(YESTERDAY), deletedAt: null },
    });
    expect(rows.every((r) => r.status === 'HOLIDAY')).toBe(true);
  });

  // ── leave applications ──────────────────────────────────────────────

  it('approving a leave retro-marks recorded ABSENT days as LEAVE', async () => {
    // Re-mark today with an absence to correct.
    await mark({
      sectionId,
      date: TODAY,
      entries: entries(['PRESENT', 'ABSENT', 'PRESENT']),
    }).expect(201);

    const created = await server()
      .post('/api/v1/student-leaves')
      .set(auth(markerToken))
      .send({
        studentId: studentIds[1],
        sessionId,
        fromDate: TODAY,
        toDate: TODAY,
        reason: 'Fever — e2e',
      })
      .expect(201);
    const leaveId = dataOf<{ id: string }>(created).id;

    // Overlapping second application is refused.
    await server()
      .post('/api/v1/student-leaves')
      .set(auth(markerToken))
      .send({
        studentId: studentIds[1],
        sessionId,
        fromDate: TODAY,
        toDate: TODAY,
        reason: 'Duplicate — e2e',
      })
      .expect(409);

    const approved = await server()
      .post(`/api/v1/student-leaves/${leaveId}/approve`)
      .set(auth(markerToken))
      .send({ note: 'Medical certificate seen' })
      .expect(201);
    expect(dataOf<{ correctedDays: number }>(approved).correctedDays).toBe(1);

    const row = await prisma.studentAttendance.findFirst({
      where: {
        enrollmentId: enrollmentIds[1],
        date: new Date(TODAY),
        deletedAt: null,
      },
    });
    expect(row!.status).toBe('LEAVE');

    // Approving twice is refused (only PENDING may be decided).
    await server()
      .post(`/api/v1/student-leaves/${leaveId}/approve`)
      .set(auth(markerToken))
      .send({})
      .expect(400);
  });

  it('an approved leave overrides a later submitted ABSENT', async () => {
    const res = await mark({
      sectionId,
      date: TODAY,
      entries: entries(['PRESENT', 'ABSENT', 'PRESENT']),
    }).expect(201);
    expect(dataOf<{ leaveOverrides: number }>(res).leaveOverrides).toBe(1);
  });

  // ── QR check-in ─────────────────────────────────────────────────────

  it('rejects an unknown QR token', async () => {
    await server()
      .post('/api/v1/attendance/qr-checkin')
      .set(auth(adminToken))
      .send({ qrToken: 'not-a-real-token' })
      .expect(404);
    await server()
      .post('/api/v1/attendance/qr-checkin')
      .set(auth(plainToken))
      .send({ qrToken: 'not-a-real-token' })
      .expect(403);
  });

  // ── staff attendance ────────────────────────────────────────────────

  it('serves and marks the staff sheet', async () => {
    const res = await server()
      .get('/api/v1/attendance/staff')
      .query({ date: TODAY })
      .set(auth(adminToken))
      .expect(200);
    const rows = dataOf<{
      rows: Array<{ personType: string; personId: string }>;
    }>(res).rows;

    if (rows.length === 0) return; // dev DB with no employees yet
    await server()
      .post('/api/v1/attendance/staff')
      .set(auth(adminToken))
      .send({
        date: TODAY,
        entries: [
          {
            personType: rows[0].personType,
            personId: rows[0].personId,
            status: 'PRESENT',
          },
        ],
      })
      .expect(201);

    const after = await server()
      .get('/api/v1/attendance/staff')
      .query({ date: TODAY })
      .set(auth(adminToken))
      .expect(200);
    const marked = dataOf<{ rows: Array<{ status: string | null }> }>(
      after,
    ).rows.filter((r) => r.status !== null);
    expect(marked.length).toBeGreaterThan(0);

    await prisma.staffAttendance.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, date: new Date(TODAY) },
    });
  });

  // ── reports ─────────────────────────────────────────────────────────

  it('reports the day, the month register and the student summary', async () => {
    const daily = await server()
      .get('/api/v1/attendance/reports/daily')
      .query({ date: TODAY, sectionId, sessionId })
      .set(auth(adminToken))
      .expect(200);
    const dailyBody = dataOf<{
      sections: Array<{ marked: number; enrolled: number }>;
      students: unknown[];
    }>(daily);
    expect(dailyBody.sections[0].enrolled).toBe(3);
    expect(dailyBody.sections[0].marked).toBe(3);
    expect(dailyBody.students).toHaveLength(3);

    const monthly = await server()
      .get('/api/v1/attendance/reports/monthly')
      .query({ sectionId, month: TODAY.slice(0, 7) })
      .set(auth(adminToken))
      .expect(200);
    const register = dataOf<{
      days: string[];
      rows: Array<{
        marks: Record<string, string>;
        summary: { percentage: number };
      }>;
    }>(monthly);
    expect(register.days).toContain(TODAY);
    expect(register.rows).toHaveLength(3);
    expect(register.rows[0].marks[TODAY]).toBe('PRESENT');

    const student = await server()
      .get(`/api/v1/attendance/reports/student/${studentIds[0]}`)
      .query({ sessionId })
      .set(auth(adminToken))
      .expect(200);
    const summary = dataOf<{
      summary: { percentage: number; workingDays: number };
      bySection: unknown[];
    }>(student);
    expect(summary.summary.workingDays).toBeGreaterThan(0);
    expect(summary.bySection).toHaveLength(1);

    const overall = await server()
      .get('/api/v1/attendance/reports/summary')
      .query({ sessionId })
      .set(auth(adminToken))
      .expect(200);
    expect(
      dataOf<{ sections: unknown[] }>(overall).sections.length,
    ).toBeGreaterThan(0);

    const late = await server()
      .get('/api/v1/attendance/reports/late-analysis')
      .query({ month: TODAY.slice(0, 7), sectionId })
      .set(auth(adminToken))
      .expect(200);
    expect(dataOf<{ threshold: number }>(late).threshold).toBeGreaterThan(0);
  });

  it('exports the register as XLSX and PDF', async () => {
    const xlsx = await server()
      .get('/api/v1/attendance/reports/monthly/export')
      .query({ sectionId, month: TODAY.slice(0, 7), format: 'xlsx' })
      .set(auth(adminToken))
      .expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    // supertest only buffers known binary types — assert on the header.
    expect(Number(xlsx.headers['content-length'])).toBeGreaterThan(0);
    expect(xlsx.headers['content-disposition']).toContain('.xlsx');

    const pdf = await server()
      .get('/api/v1/attendance/reports/daily/export')
      .query({ date: TODAY, sectionId, sessionId, format: 'pdf' })
      .set(auth(adminToken))
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    // supertest buffers application/pdf, so the magic bytes are checkable.
    expect(
      Buffer.from(pdf.body as Buffer)
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
  });

  it('exporting needs attendance.report, which the marker lacks', async () => {
    await server()
      .get('/api/v1/attendance/reports/monthly/export')
      .query({ sectionId, month: TODAY.slice(0, 7) })
      .set(auth(markerToken))
      .expect(403);
  });

  // ── M11 promotion rollback guard now bites ──────────────────────────

  it('blocks a promotion rollback once attendance exists', async () => {
    const target = await prisma.academicSession.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `E2E-AT ${YEAR + 1}`,
        startDate: new Date(`${YEAR + 1}-01-01`),
        endDate: new Date(`${YEAR + 1}-12-31`),
      },
    });
    const batch = await prisma.promotionBatch.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        fromSessionId: sessionId,
        toSessionId: target.id,
        status: 'EXECUTED',
      },
    });
    // The "created" enrollment points at a row that already has marks.
    await prisma.promotionItem.create({
      data: {
        batchId: batch.id,
        studentId: studentIds[0],
        decision: 'PROMOTE',
        toEnrollmentId: enrollmentIds[0],
      },
    });

    await server()
      .post(`/api/v1/promotions/${batch.id}/rollback`)
      .set(auth(adminToken))
      .expect(409);
  });
});
