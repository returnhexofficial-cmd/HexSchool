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
 * Requires dev infra (DB + redis). Uses the CURRENT session where rules
 * demand it (leaves, resign guard) with an E2E class at level 17 so real
 * dev data is untouched; assignments/leaves created here are removed in
 * afterAll. Teacher IDs claimed stay burned (by design).
 */
describe('Teacher Management (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-teacher-admin@test.local';
  const PLAIN = 'e2e-teacher-plain@test.local';
  const PHONES = Array.from(
    { length: 8 },
    (_, i) => `017990066${String(i).padStart(2, '0')}`,
  );

  let adminToken: string;
  let plainToken: string;
  let currentSessionId: string;
  let classId: string;
  let sectionId: string;
  let subjectAId: string;
  let subjectBId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;

  const teacherPayload = (i: number, extra: object = {}) => ({
    phone: PHONES[i],
    firstName: 'E2ETeacher',
    lastName: `Member${i}`,
    designation: 'ASSISTANT_TEACHER',
    gender: 'MALE',
    dob: '1985-05-05',
    joiningDate: '2018-01-10',
    ...extra,
  });

  const cleanup = async () => {
    // FK order matters: assignments (RESTRICT on teacher/subject) →
    // sections (RESTRICT on class) → teachers → class/subjects → users.
    const teachers = await prisma.teacher.findMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: 'E2ETeacher' },
      select: { id: true },
    });
    const teacherIds = teachers.map((t) => t.id);
    if (teacherIds.length > 0) {
      await prisma.teacherSectionSubject.deleteMany({
        where: { teacherId: { in: teacherIds } },
      });
      await prisma.section.updateMany({
        where: { classTeacherId: { in: teacherIds } },
        data: { classTeacherId: null },
      });
    }
    const classes = await prisma.schoolClass.findMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: 'E2E TClass' },
      select: { id: true },
    });
    if (classes.length > 0) {
      await prisma.section.deleteMany({
        where: { classId: { in: classes.map((c) => c.id) } },
      });
      await prisma.schoolClass.deleteMany({
        where: { id: { in: classes.map((c) => c.id) } },
      });
    }
    if (teacherIds.length > 0) {
      await prisma.teacher.deleteMany({ where: { id: { in: teacherIds } } });
    }
    await prisma.subject.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, code: { startsWith: 'E2ET' } },
    });
    const users = await prisma.user.findMany({
      where: {
        OR: [{ email: { in: [ADMIN, PLAIN] } }, { phone: { in: PHONES } }],
      },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    if (ids.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    // The temporary current session (ours by name), incl. crashed runs.
    await prisma.academicSession.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: 'E2E-T Current' },
    });
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

    // Leaves/resign rules run against the CURRENT session — use the dev
    // DB's if present, otherwise create a wide temporary one. (After
    // cleanup: it removes the temp session from a previous crashed run.)
    const existingCurrent = await prisma.academicSession.findFirst({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        isCurrent: true,
        deletedAt: null,
      },
    });
    if (existingCurrent) {
      currentSessionId = existingCurrent.id;
    } else {
      const created = await prisma.academicSession.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          name: 'E2E-T Current',
          startDate: new Date('2020-01-01'),
          endDate: new Date('2099-12-31'),
          isCurrent: true,
          status: 'ACTIVE',
        },
      });
      currentSessionId = created.id;
    }

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

    // Structure fixtures: class (level 17), section in the current
    // session, two subjects.
    const klass = await prisma.schoolClass.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: 'E2E TClass',
        numericLevel: 17,
      },
    });
    classId = klass.id;
    const section = await prisma.section.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        classId,
        sessionId: currentSessionId,
        name: 'T1',
      },
    });
    sectionId = section.id;
    const [subjectA, subjectB] = await Promise.all([
      prisma.subject.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          name: 'E2E TMath',
          code: 'E2ETMAT',
        },
      }),
      prisma.subject.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          name: 'E2E TBio',
          code: 'E2ETBIO',
        },
      }),
    ]);
    subjectAId = subjectA.id;
    subjectBId = subjectB.id;

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

  let teacherAId: string;
  let teacherAUserId: string;
  let teacherBId: string;

  it('teacher endpoints are permission-guarded', async () => {
    await server().get('/api/v1/teachers').set(auth(plainToken)).expect(403);
    await server()
      .post('/api/v1/teachers')
      .set(auth(plainToken))
      .send(teacherPayload(0))
      .expect(403);
  });

  it('creating a teacher creates the user with the teacher role', async () => {
    const res = await server()
      .post('/api/v1/teachers')
      .set(auth(adminToken))
      .send(teacherPayload(0))
      .expect(201);
    const data = dataOf<{
      id: string;
      userId: string;
      employeeId: string;
      user: { userType: string; mustChangePassword: boolean };
    }>(res);
    teacherAId = data.id;
    teacherAUserId = data.userId;

    expect(data.employeeId).toMatch(/-T-18\d{4}$/); // joining year 2018
    expect(data.user.userType).toBe('TEACHER');
    expect(data.user.mustChangePassword).toBe(true);

    const roles = await prisma.userRole.findMany({
      where: { userId: data.userId },
      include: { role: true },
    });
    expect(roles.map((r) => r.role.slug)).toContain('teacher');

    teacherBId = dataOf<{ id: string }>(
      await server()
        .post('/api/v1/teachers')
        .set(auth(adminToken))
        .send(teacherPayload(1))
        .expect(201),
    ).id;
  });

  it('qualifications CRUD (passing year > current → 400)', async () => {
    const created = await server()
      .post(`/api/v1/teachers/${teacherAId}/qualifications`)
      .set(auth(adminToken))
      .send({
        degree: 'BSc in Mathematics',
        institution: 'University of Dhaka',
        passingYear: 2008,
        result: 'First class',
      })
      .expect(201);
    const qid = dataOf<{ id: string }>(created).id;

    await server()
      .post(`/api/v1/teachers/${teacherAId}/qualifications`)
      .set(auth(adminToken))
      .send({
        degree: 'MSc',
        institution: 'DU',
        passingYear: new Date().getUTCFullYear() + 1,
      })
      .expect(400);

    await server()
      .put(`/api/v1/teachers/${teacherAId}/qualifications/${qid}`)
      .set(auth(adminToken))
      .send({ result: 'CGPA 3.8' })
      .expect(200);
  });

  it('expertise set: PUT replaces; unknown subject → 400', async () => {
    await server()
      .put(`/api/v1/teachers/${teacherAId}/subjects`)
      .set(auth(adminToken))
      .send({ subjectIds: [subjectAId] })
      .expect(200);

    const res = await server()
      .get(`/api/v1/teachers/${teacherAId}/subjects`)
      .set(auth(adminToken))
      .expect(200);
    expect(dataOf<Array<{ id: string }>>(res).map((s) => s.id)).toEqual([
      subjectAId,
    ]);

    await server()
      .put(`/api/v1/teachers/${teacherAId}/subjects`)
      .set(auth(adminToken))
      .send({ subjectIds: ['00000000-0000-4000-8000-00000000dead'] })
      .expect(400);
  });

  describe('assignments', () => {
    it('assigns within expertise; expertise mismatch → 409; override works', async () => {
      await server()
        .post('/api/v1/teacher-assignments')
        .set(auth(adminToken))
        .send({
          sessionId: currentSessionId,
          sectionId,
          subjectId: subjectAId,
          teacherId: teacherAId,
        })
        .expect(201);

      // subjectB is NOT in teacher A's expertise set.
      await server()
        .post('/api/v1/teacher-assignments')
        .set(auth(adminToken))
        .send({
          sessionId: currentSessionId,
          sectionId,
          subjectId: subjectBId,
          teacherId: teacherAId,
        })
        .expect(409);

      // Admin holds the full catalog incl. teacher.assign.override.
      await server()
        .post('/api/v1/teacher-assignments')
        .set(auth(adminToken))
        .send({
          sessionId: currentSessionId,
          sectionId,
          subjectId: subjectBId,
          teacherId: teacherAId,
          override: true,
        })
        .expect(201);
    });

    it('re-assigning the slot REPLACES the holder (one per slot)', async () => {
      await server()
        .put(`/api/v1/teachers/${teacherBId}/subjects`)
        .set(auth(adminToken))
        .send({ subjectIds: [subjectAId, subjectBId] })
        .expect(200);

      await server()
        .post('/api/v1/teacher-assignments')
        .set(auth(adminToken))
        .send({
          sessionId: currentSessionId,
          sectionId,
          subjectId: subjectAId,
          teacherId: teacherBId,
        })
        .expect(201);

      const rows = await prisma.teacherSectionSubject.findMany({
        where: {
          sessionId: currentSessionId,
          sectionId,
          subjectId: subjectAId,
        },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].teacherId).toBe(teacherBId);

      // Hand it back for the transfer test below.
      await server()
        .post('/api/v1/teacher-assignments')
        .set(auth(adminToken))
        .send({
          sessionId: currentSessionId,
          sectionId,
          subjectId: subjectAId,
          teacherId: teacherAId,
        })
        .expect(201);
    });

    it('workload reports assignment counts', async () => {
      const res = await server()
        .get(
          `/api/v1/teacher-assignments/workload?sessionId=${currentSessionId}`,
        )
        .set(auth(adminToken))
        .expect(200);
      const rows =
        dataOf<Array<{ teacherId: string; assignments: number }>>(res);
      const teacherA = rows.find((r) => r.teacherId === teacherAId);
      expect(teacherA?.assignments).toBe(2); // subjectA + overridden subjectB
    });

    it('schedule lists the teacher’s slots', async () => {
      const res = await server()
        .get(
          `/api/v1/teachers/${teacherAId}/schedule?sessionId=${currentSessionId}`,
        )
        .set(auth(adminToken))
        .expect(200);
      expect(dataOf<unknown[]>(res)).toHaveLength(2);
    });
  });

  describe('leaves', () => {
    let leaveId: string;

    it('creates and approves a leave (emits the M12 hook)', async () => {
      const res = await server()
        .post('/api/v1/teacher-leaves')
        .set(auth(adminToken))
        .send({
          teacherId: teacherAId,
          fromDate: '2026-08-03',
          toDate: '2026-08-05',
          type: 'CASUAL',
          reason: 'E2E family event',
        })
        .expect(201);
      leaveId = dataOf<{ id: string }>(res).id;

      await server()
        .post(`/api/v1/teacher-leaves/${leaveId}/approve`)
        .set(auth(adminToken))
        .expect(201);
    });

    it('overlapping range with the APPROVED leave → 409 on approve', async () => {
      const res = await server()
        .post('/api/v1/teacher-leaves')
        .set(auth(adminToken))
        .send({
          teacherId: teacherAId,
          fromDate: '2026-08-05',
          toDate: '2026-08-07',
        })
        .expect(409); // blocked at create already (overlaps approved)
      expect(res.body).toBeDefined();
    });

    it('approved leave cannot be edited or deleted', async () => {
      await server()
        .put(`/api/v1/teacher-leaves/${leaveId}`)
        .set(auth(adminToken))
        .send({ reason: 'nope' })
        .expect(400);
      await server()
        .delete(`/api/v1/teacher-leaves/${leaveId}`)
        .set(auth(adminToken))
        .expect(400);
    });
  });

  describe('class teacher (deferred M06 FK now live)', () => {
    it('sets a class teacher; the cap (default 1) blocks a second section', async () => {
      await server()
        .put(`/api/v1/sections/${sectionId}`)
        .set(auth(adminToken))
        .send({ classTeacherId: teacherBId })
        .expect(200);

      const second = await prisma.section.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          classId,
          sessionId: currentSessionId,
          name: 'T2',
        },
      });
      await server()
        .put(`/api/v1/sections/${second.id}`)
        .set(auth(adminToken))
        .send({ classTeacherId: teacherBId })
        .expect(409);
    });
  });

  describe('resign guard + transfer helper (roadmap M08 §8)', () => {
    it('RESIGNED blocked while assignments exist', async () => {
      await server()
        .put(`/api/v1/teachers/${teacherAId}/status`)
        .set(auth(adminToken))
        .send({ status: 'RESIGNED', reason: 'E2E resignation' })
        .expect(409);
    });

    it('bulk transfer moves the assignments (override for subjectB)', async () => {
      const res = await server()
        .post('/api/v1/teacher-assignments/transfer')
        .set(auth(adminToken))
        .send({
          fromTeacherId: teacherAId,
          toTeacherId: teacherBId,
          sessionId: currentSessionId,
        })
        .expect(201);
      expect(dataOf<{ transferred: number }>(res).transferred).toBe(2);
    });

    it('after the transfer the resignation proceeds and the user deactivates', async () => {
      await server()
        .put(`/api/v1/teachers/${teacherAId}/status`)
        .set(auth(adminToken))
        .send({ status: 'RESIGNED', reason: 'E2E resignation' })
        .expect(200);

      // Cascade is out-of-band — poll briefly.
      let status = '';
      for (let i = 0; i < 20; i += 1) {
        const user = await prisma.user.findUnique({
          where: { id: teacherAUserId },
        });
        status = user!.status;
        if (status === 'INACTIVE') break;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      expect(status).toBe('INACTIVE');
    });
  });
});
