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
 * Requires dev infra (DB + redis). The whole M15 loop, in the order a
 * school lives it: enter marks on the M14 papers, walk the four-eyes
 * lifecycle, process, check the GPA arithmetic against hand-computed
 * NCTB values, rank, publish, correct a locked mark, republish, and
 * search the result publicly.
 *
 * The fixture is built to make the interesting rules observable:
 * class A has three compulsory subjects plus a 4th (optional) one that
 * only two of its six students chose, one student is deliberately given
 * a failing paper, one a near-miss for grace, and one is marked absent.
 *
 * Everything is created under distinctive `E2E-RS`/`E2E RS` names and
 * removed in afterAll (the session FK cascades take sections,
 * enrollments, exams, marks and results).
 */
describe('Marks & Results (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-rs-admin@test.local';
  const TEACHER = 'e2e-rs-teacher@test.local';
  const CONTROLLER = 'e2e-rs-controller@test.local';
  const PLAIN = 'e2e-rs-plain@test.local';
  const NAME = 'E2ERS';
  const TEACHER_ROLE = 'e2e-rs-teacher';
  const CONTROLLER_ROLE = 'e2e-rs-controller';

  let adminToken: string;
  let teacherToken: string;
  let controllerToken: string;
  let plainToken: string;

  let sessionId: string;
  let examTypeId: string;
  let secondTypeId: string;
  let examId: string;
  let secondExamId: string;
  let classA: string;
  let classB: string;
  let sectionA: string;
  let subBangla: string;
  let subMaths: string;
  let subScience: string;
  let subOptional: string;

  /** examSubjectId per subject, filled once the exam seeds its papers. */
  const paperOf = new Map<string, string>();
  /** enrollmentId per roll number 1..6. */
  const enrollments = new Map<number, string>();
  const studentIds = new Map<number, string>();

  const day = (offset: number): string => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;

  const saveMarks = (
    subjectId: string,
    marks: Array<Record<string, unknown>>,
    token = teacherToken,
  ) =>
    server()
      .put(`/api/v1/exams/${examId}/marks`)
      .set(auth(token))
      .send({ examSubjectId: paperOf.get(subjectId), marks });

  const lifecycle = (
    action: 'submit' | 'verify' | 'lock',
    subjectId: string,
    token = adminToken,
  ) =>
    server()
      .post(`/api/v1/exams/${examId}/marks/${action}`)
      .set(auth(token))
      .send({ examSubjectId: paperOf.get(subjectId) });

  const cleanup = async () => {
    await prisma.academicSession.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E-RS ' } },
    });
    await prisma.student.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: NAME },
    });
    await prisma.examType.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E RS ' } },
    });
    await prisma.subject.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, code: { startsWith: 'E2ERSS' } },
    });
    await prisma.schoolClass.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: { startsWith: 'E2E RSClass' },
      },
    });
    await prisma.role.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        slug: { in: [TEACHER_ROLE, CONTROLLER_ROLE] },
      },
    });
    const users = await prisma.user.findMany({
      where: { email: { in: [ADMIN, TEACHER, CONTROLLER, PLAIN] } },
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
    const [adminUser, teacherUser, controllerUser] = await Promise.all(
      (
        [
          [ADMIN, UserType.ADMIN],
          [TEACHER, UserType.STAFF],
          [CONTROLLER, UserType.STAFF],
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

    const grantRole = async (
      slug: string,
      name: string,
      userId: string,
      codes: string[],
    ) => {
      const role = await prisma.role.create({
        data: { schoolId: DEFAULT_SCHOOL_ID, name, slug },
      });
      const permissions = await prisma.permission.findMany({
        where: { code: { in: codes } },
        select: { id: true },
      });
      await prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });
      await prisma.userRole.create({ data: { userId, roleId: role.id } });
    };

    // Enters and submits — deliberately CANNOT verify or lock its own
    // work. That separation is the whole point of the four-eyes flow.
    await grantRole(TEACHER_ROLE, 'E2E Mark Entry', teacherUser.id, [
      'exam.view',
      'mark.view',
      'mark.entry',
      'mark.submit',
      'result.view',
    ]);
    // Verifies, locks and processes — but may NOT publish.
    await grantRole(CONTROLLER_ROLE, 'E2E Controller', controllerUser.id, [
      'exam.view',
      'mark.view',
      'mark.verify',
      'mark.lock',
      'result.view',
      'result.process',
    ]);

    const session = await prisma.academicSession.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `E2E-RS ${new Date().getUTCFullYear()}`,
        startDate: new Date(day(-180)),
        endDate: new Date(day(180)),
        status: 'ACTIVE',
      },
    });
    sessionId = session.id;

    const klass = await prisma.schoolClass.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: 'E2E RSClassA',
        numericLevel: 19,
      },
    });
    classA = klass.id;
    // A second class with no students — it exists only so the
    // detach-a-class guard has somewhere to detach TO.
    classB = (
      await prisma.schoolClass.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          name: 'E2E RSClassB',
          numericLevel: 20,
        },
      })
    ).id;

    const makeSubject = async (code: string, name: string) => {
      const subject = await prisma.subject.create({
        data: { schoolId: DEFAULT_SCHOOL_ID, name, code },
      });
      return subject.id;
    };
    subBangla = await makeSubject('E2ERSS1', 'E2E RS Bangla');
    subMaths = await makeSubject('E2ERSS2', 'E2E RS Maths');
    subScience = await makeSubject('E2ERSS3', 'E2E RS Science');
    subOptional = await makeSubject('E2ERSS4', 'E2E RS Agriculture');

    await prisma.classSubject.createMany({
      data: [
        {
          schoolId: DEFAULT_SCHOOL_ID,
          classId: classA,
          subjectId: subBangla,
          sessionId,
          displayOrder: 1,
        },
        {
          schoolId: DEFAULT_SCHOOL_ID,
          classId: classA,
          subjectId: subMaths,
          sessionId,
          displayOrder: 2,
        },
        {
          schoolId: DEFAULT_SCHOOL_ID,
          classId: classA,
          subjectId: subScience,
          sessionId,
          displayOrder: 3,
        },
        {
          schoolId: DEFAULT_SCHOOL_ID,
          classId: classA,
          subjectId: subOptional,
          sessionId,
          isOptional: true,
          displayOrder: 4,
        },
      ],
    });

    const section = await prisma.section.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        classId: classA,
        sessionId,
        name: 'A1',
        roomNo: 'R-A1',
      },
    });
    sectionA = section.id;

    // Rolls 1 and 2 take the 4th subject; the rest do not.
    for (let roll = 1; roll <= 6; roll += 1) {
      const student = await prisma.student.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          studentUid: `E2E-RS-${Date.now()}-${roll}`,
          firstName: NAME,
          lastName: `Pupil${roll}`,
          gender: 'MALE',
          dob: new Date('2012-04-04'),
          admissionDate: new Date(day(-200)),
          admissionClassId: classA,
          qrToken: randomUUID(),
        },
      });
      studentIds.set(roll, student.id);
      const enrollment = await prisma.enrollment.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          studentId: student.id,
          sessionId,
          classId: classA,
          sectionId: sectionA,
          rollNo: roll,
          enrollmentDate: new Date(day(-190)),
          status: 'ACTIVE',
          ...(roll <= 2 ? { optionalSubjectId: subOptional } : {}),
        },
      });
      enrollments.set(roll, enrollment.id);
    }

    const login = async (identifier: string) => {
      const res = await server()
        .post('/api/v1/auth/login')
        .send({ identifier, password: PASSWORD })
        .expect(200);
      return (res.body as { data: { accessToken: string } }).data.accessToken;
    };
    adminToken = await login(ADMIN);
    teacherToken = await login(TEACHER);
    controllerToken = await login(CONTROLLER);
    plainToken = await login(PLAIN);

    // ── the M14 exam this module hangs off ────────────────────────────
    examTypeId = dataOf<{ id: string }>(
      await server()
        .post('/api/v1/exam-types')
        .set(auth(adminToken))
        .send({ name: 'E2E RS Half-Yearly', weight: 30 })
        .expect(201),
    ).id;
    secondTypeId = dataOf<{ id: string }>(
      await server()
        .post('/api/v1/exam-types')
        .set(auth(adminToken))
        .send({ name: 'E2E RS Annual', weight: 70 })
        .expect(201),
    ).id;

    /**
     * The two exams need DISJOINT windows and rooms: they cover the same
     * class, so overlapping sittings would be a structural clash the M14
     * engine refuses outright (and rightly — a class cannot be in two
     * halls at once).
     */
    const makeExam = async (
      name: string,
      typeId: string,
      firstDay: number,
      room: string,
    ) => {
      const exam = dataOf<{ id: string }>(
        await server()
          .post('/api/v1/exams')
          .set(auth(adminToken))
          .send({
            name,
            sessionId,
            examTypeId: typeId,
            startDate: day(firstDay),
            endDate: day(firstDay + 4),
            classIds: [classA],
          })
          .expect(201),
      );
      // Schedule every seeded paper so the status machine will advance.
      const papers = dataOf<Array<{ subjectId: string }>>(
        await server()
          .get(`/api/v1/exams/${exam.id}/subjects`)
          .set(auth(adminToken))
          .expect(200),
      );
      await server()
        .put(`/api/v1/exams/${exam.id}/subjects`)
        .set(auth(adminToken))
        .send({
          subjects: papers.map((paper, index) => ({
            classId: classA,
            subjectId: paper.subjectId,
            fullMarks: 100,
            passMarks: 33,
            examDate: day(firstDay + index),
            startTime: '09:00',
            durationMin: 180,
            room,
          })),
        })
        .expect(200);

      for (const status of ['SCHEDULED', 'ONGOING', 'MARK_ENTRY']) {
        await server()
          .put(`/api/v1/exams/${exam.id}/status`)
          .set(auth(adminToken))
          .send({ status })
          .expect(200);
      }
      return exam.id;
    };

    examId = await makeExam('E2E RS Exam One', examTypeId, -13, 'RS-HALL-A');
    secondExamId = await makeExam(
      'E2E RS Exam Two',
      secondTypeId,
      -25,
      'RS-HALL-B',
    );

    const papers = dataOf<Array<{ id: string; subjectId: string }>>(
      await server()
        .get(`/api/v1/exams/${examId}/subjects`)
        .set(auth(adminToken))
        .expect(200),
    );
    for (const paper of papers) paperOf.set(paper.subjectId, paper.id);
  }, 240_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  }, 120_000);

  // ── permissions ─────────────────────────────────────────────────────

  it('is permission-guarded', async () => {
    await server()
      .get(`/api/v1/exams/${examId}/marks/status`)
      .set(auth(plainToken))
      .expect(403);
    await server()
      .post(`/api/v1/exams/${examId}/process`)
      .set(auth(plainToken))
      .send({})
      .expect(403);
  });

  it('separates entry from verification (the four-eyes rule)', async () => {
    // The teacher who enters marks may submit but must not verify.
    await server()
      .post(`/api/v1/exams/${examId}/marks/verify`)
      .set(auth(teacherToken))
      .send({ examSubjectId: paperOf.get(subBangla) })
      .expect(403);
    // The controller may verify but must not publish.
    await server()
      .post(`/api/v1/exams/${examId}/publish`)
      .set(auth(controllerToken))
      .send({})
      .expect(403);
  });

  // ── the mark-entry grid ─────────────────────────────────────────────

  describe('mark entry', () => {
    it('lists the whole class for a compulsory paper', async () => {
      const grid = dataOf<{ rows: unknown[]; components: string[] }>(
        await server()
          .get(
            `/api/v1/exams/${examId}/marks?examSubjectId=${paperOf.get(subBangla)}`,
          )
          .set(auth(teacherToken))
          .expect(200),
      );

      expect(grid.rows).toHaveLength(6);
      expect(grid.components).toEqual([]);
    });

    it('lists ONLY the choosers for the optional 4th subject', async () => {
      // The candidate rule M14 established for seat plans, re-applied:
      // marking the whole class here would give four students a
      // compulsory F in a subject they never took.
      const grid = dataOf<{ rows: Array<{ rollNo: number }> }>(
        await server()
          .get(
            `/api/v1/exams/${examId}/marks?examSubjectId=${paperOf.get(subOptional)}`,
          )
          .set(auth(teacherToken))
          .expect(200),
      );

      expect(grid.rows.map((r) => r.rollNo).sort()).toEqual([1, 2]);
    });

    it('refuses a mark above the paper total, saving nothing', async () => {
      const res = await saveMarks(subBangla, [
        { enrollmentId: enrollments.get(1), total: 80 },
        { enrollmentId: enrollments.get(2), total: 140 },
      ]).expect(400);

      expect(
        (res.body as { error: { details: { marks: unknown[] } } }).error.details
          .marks,
      ).toHaveLength(1);

      // Nothing was written — not even the valid first row.
      const grid = dataOf<{ entered: number }>(
        await server()
          .get(
            `/api/v1/exams/${examId}/marks?examSubjectId=${paperOf.get(subBangla)}`,
          )
          .set(auth(teacherToken))
          .expect(200),
      );
      expect(grid.entered).toBe(0);
    });

    it('refuses a student who did not take the optional subject', async () => {
      await saveMarks(subOptional, [
        { enrollmentId: enrollments.get(5), total: 70 },
      ]).expect(400);
    });

    it('refuses marks alongside the absent flag', async () => {
      await saveMarks(subBangla, [
        { enrollmentId: enrollments.get(1), total: 40, isAbsent: true },
      ]).expect(400);
    });

    it('saves the grid, and is idempotent on re-save', async () => {
      // Roll 4 fails Bangla outright; roll 5 misses by one mark (the
      // grace candidate); roll 6 is absent.
      const rows = [
        { enrollmentId: enrollments.get(1), total: 85 },
        { enrollmentId: enrollments.get(2), total: 78 },
        { enrollmentId: enrollments.get(3), total: 62 },
        { enrollmentId: enrollments.get(4), total: 20 },
        { enrollmentId: enrollments.get(5), total: 32 },
        { enrollmentId: enrollments.get(6), isAbsent: true },
      ];
      await saveMarks(subBangla, rows).expect(200);
      await saveMarks(subBangla, rows).expect(200);

      const grid = dataOf<{ entered: number; rows: Array<{ total: number }> }>(
        await server()
          .get(
            `/api/v1/exams/${examId}/marks?examSubjectId=${paperOf.get(subBangla)}`,
          )
          .set(auth(teacherToken))
          .expect(200),
      );
      expect(grid.entered).toBe(6);
      expect(grid.rows.find((r) => r.total === 85)).toBeDefined();
    });

    it('reports a paper nobody has touched as DRAFT, not locked', async () => {
      const statuses = dataOf<
        Array<{ subjectId: string; status: string; entered: number }>
      >(
        await server()
          .get(`/api/v1/exams/${examId}/marks/status`)
          .set(auth(teacherToken))
          .expect(200),
      );

      const maths = statuses.find((s) => s.subjectId === subMaths);
      expect(maths).toMatchObject({ status: 'DRAFT', entered: 0 });
    });
  });

  // ── the four-eyes lifecycle ─────────────────────────────────────────

  describe('lifecycle', () => {
    it('refuses to submit a partially-entered paper', async () => {
      await saveMarks(subMaths, [
        { enrollmentId: enrollments.get(1), total: 90 },
      ]).expect(200);

      await lifecycle('submit', subMaths, teacherToken).expect(409);
    });

    it('walks DRAFT → SUBMITTED → VERIFIED → LOCKED', async () => {
      await lifecycle('submit', subBangla, teacherToken).expect(201);
      await lifecycle('verify', subBangla, controllerToken).expect(201);
      await lifecycle('lock', subBangla, controllerToken).expect(201);

      const statuses = dataOf<Array<{ subjectId: string; status: string }>>(
        await server()
          .get(`/api/v1/exams/${examId}/marks/status`)
          .set(auth(teacherToken))
          .expect(200),
      );
      expect(statuses.find((s) => s.subjectId === subBangla)?.status).toBe(
        'LOCKED',
      );
    });

    it('refuses to skip a step', async () => {
      await lifecycle('lock', subMaths, controllerToken).expect(409);
    });

    it('refuses to edit a LOCKED paper through the grid', async () => {
      await saveMarks(subBangla, [
        { enrollmentId: enrollments.get(1), total: 99 },
      ]).expect(409);
    });

    it('locks the remaining papers', async () => {
      const complete = [
        { enrollmentId: enrollments.get(1), total: 90 },
        { enrollmentId: enrollments.get(2), total: 71 },
        { enrollmentId: enrollments.get(3), total: 55 },
        { enrollmentId: enrollments.get(4), total: 45 },
        { enrollmentId: enrollments.get(5), total: 40 },
        { enrollmentId: enrollments.get(6), isAbsent: true },
      ];
      await saveMarks(subMaths, complete).expect(200);
      await saveMarks(
        subScience,
        complete.map((row) => ({ ...row })),
      ).expect(200);
      // The optional paper is sat by two candidates only.
      await saveMarks(subOptional, [
        { enrollmentId: enrollments.get(1), total: 88 },
        { enrollmentId: enrollments.get(2), total: 30 },
      ]).expect(200);

      for (const subject of [subMaths, subScience, subOptional]) {
        await lifecycle('submit', subject, teacherToken).expect(201);
        await lifecycle('verify', subject, controllerToken).expect(201);
        await lifecycle('lock', subject, controllerToken).expect(201);
      }
    });
  });

  // ── processing ──────────────────────────────────────────────────────

  describe('processing', () => {
    it('refuses to publish before anything is processed', async () => {
      // The M14 EXAM_RESULT_GATE, live for the first time.
      const res = await server()
        .post(`/api/v1/exams/${examId}/publish`)
        .set(auth(adminToken))
        .send({})
        .expect(409);
      // The publication service refuses first, with the more useful
      // message; the gate itself is exercised by the staleness case
      // below, which only the gate can see.
      expect(JSON.stringify(res.body)).toMatch(/run processing first/i);
    });

    it('runs and completes', async () => {
      const dispatched = dataOf<{ run: { id: string }; mode: string }>(
        await server()
          .post(`/api/v1/exams/${examId}/process`)
          .set(auth(controllerToken))
          .send({})
          .expect(201),
      );
      expect(dispatched.run.id).toBeDefined();

      await waitForRun(examId);

      const status = dataOf<{
        run: { status: string; processed: number };
        results: number;
        stale: boolean;
      }>(
        await server()
          .get(`/api/v1/exams/${examId}/process/status`)
          .set(auth(controllerToken))
          .expect(200),
      );
      expect(status.run.status).toBe('COMPLETED');
      expect(status.results).toBe(6);
      expect(status.stale).toBe(false);
    });

    it('computes the NCTB GPA, with the 4th subject as a bonus only', async () => {
      const { results } = dataOf<{
        results: Array<{
          enrollment: { rollNo: number };
          gpa: string;
          gpaWithoutOptional: string;
          grade: string;
          status: string;
        }>;
      }>(
        await server()
          .get(`/api/v1/exams/${examId}/results`)
          .set(auth(adminToken))
          .expect(200),
      );

      const byRoll = new Map(results.map((r) => [r.enrollment.rollNo, r]));

      // Roll 1: Bangla 85 (A+ 5), Maths 90 (A+ 5), Science 90 (A+ 5),
      // optional 88 (A+ 5) → (15 + max(0, 5-2)) / 3 = 6.00, capped at 5.
      expect(Number(byRoll.get(1)!.gpa)).toBe(5);
      expect(Number(byRoll.get(1)!.gpaWithoutOptional)).toBe(5);
      expect(byRoll.get(1)!.status).toBe('PASSED');

      // Roll 2: Bangla 78 (A 4), Maths 71 (A 4), Science 71 (A 4),
      // optional 30 → F, so NO bonus: 12/3 = 4.00 exactly.
      expect(Number(byRoll.get(2)!.gpa)).toBe(4);
      expect(byRoll.get(2)!.grade).toBe('A');
      // …and a failed OPTIONAL never fails the candidate.
      expect(byRoll.get(2)!.status).toBe('PASSED');

      // Roll 3: 62 (A- 3.5), 55 (B 3), 55 (B 3) → 9.5/3 = 3.17.
      expect(Number(byRoll.get(3)!.gpa)).toBe(3.17);

      // Roll 4: Bangla 20 → F. One compulsory F is a fail, GPA 0.00 —
      // not the arithmetic mean.
      expect(byRoll.get(4)!.status).toBe('FAILED');
      expect(Number(byRoll.get(4)!.gpa)).toBe(0);

      // Roll 6 was absent in every paper.
      expect(byRoll.get(6)!.status).toBe('FAILED');
    });

    it('ranks by competition ranking among PASSED candidates only', async () => {
      const { results } = dataOf<{
        results: Array<{
          enrollment: { rollNo: number };
          status: string;
          meritPositionClass: number | null;
        }>;
      }>(
        await server()
          .get(`/api/v1/exams/${examId}/results`)
          .set(auth(adminToken))
          .expect(200),
      );
      const byRoll = new Map(results.map((r) => [r.enrollment.rollNo, r]));

      expect(byRoll.get(1)!.meritPositionClass).toBe(1);
      expect(byRoll.get(2)!.meritPositionClass).toBe(2);
      expect(byRoll.get(3)!.meritPositionClass).toBe(3);
      // A failed candidate gets no position at all.
      expect(byRoll.get(4)!.meritPositionClass).toBeNull();
    });

    it('writes the computed grade back onto each mark', async () => {
      const grid = dataOf<{ rows: Array<{ rollNo: number; grade: string }> }>(
        await server()
          .get(
            `/api/v1/exams/${examId}/marks?examSubjectId=${paperOf.get(subBangla)}`,
          )
          .set(auth(teacherToken))
          .expect(200),
      );
      expect(grid.rows.find((r) => r.rollNo === 1)?.grade).toBe('A+');
      expect(grid.rows.find((r) => r.rollNo === 4)?.grade).toBe('F');
    });

    it('froze the grade scale onto the exam at first processing', async () => {
      // M14 froze at PUBLISH, which would have let a band edit between
      // processing and publication restate a computed result.
      const exam = await prisma.exam.findUnique({
        where: { id: examId },
        select: { gradingSnapshot: true, status: true },
      });
      expect(exam!.gradingSnapshot).toBeTruthy();
      expect(exam!.status).toBe('PROCESSING');
    });

    it('is idempotent — a second run reproduces the same numbers', async () => {
      const before = await prisma.result.findMany({
        where: { examId },
        select: { enrollmentId: true, gpa: true, meritPositionClass: true },
        orderBy: { enrollmentId: 'asc' },
      });

      await server()
        .post(`/api/v1/exams/${examId}/process`)
        .set(auth(controllerToken))
        .send({})
        .expect(201);
      await waitForRun(examId);

      const after = await prisma.result.findMany({
        where: { examId },
        select: { enrollmentId: true, gpa: true, meritPositionClass: true },
        orderBy: { enrollmentId: 'asc' },
      });
      expect(after.map(String)).toEqual(before.map(String));
    });

    it('refuses a run while another is in flight', async () => {
      await prisma.resultRun.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          examId,
          status: 'RUNNING',
          triggeredBy: (
            await prisma.user.findFirstOrThrow({
              where: { email: ADMIN },
            })
          ).id,
        },
      });
      await server()
        .post(`/api/v1/exams/${examId}/process`)
        .set(auth(controllerToken))
        .send({})
        .expect(409);
      await prisma.resultRun.deleteMany({
        where: { examId, status: 'RUNNING' },
      });
    });

    it('refuses processing the second exam while its papers are unlocked', async () => {
      const res = await server()
        .post(`/api/v1/exams/${secondExamId}/process`)
        .set(auth(controllerToken))
        .send({})
        .expect(409);
      expect(JSON.stringify(res.body)).toMatch(/not LOCKED/);
    });
  });

  it('the EXAM_RESULT_GATE refuses publication when marks moved after the run', async () => {
    // This is the branch only the gate can see, and the reason M15
    // binds it: a mark edited after processing means the numbers about
    // to go home were computed from something else. Nudging
    // `updated_at` past the run is the honest way to reproduce it —
    // the service paths that touch a mark all reprocess.
    await prisma.$executeRawUnsafe(
      `UPDATE marks SET updated_at = now() + interval '1 hour' WHERE exam_id = '${examId}'`,
    );

    const res = await server()
      .post(`/api/v1/exams/${examId}/publish`)
      .set(auth(adminToken))
      .send({})
      .expect(409);
    expect(JSON.stringify(res.body)).toMatch(/reprocess before publishing/i);

    // Put it back so the publication suite below starts from a clean
    // state (a reprocess is what a school would actually do).
    await server()
      .post(`/api/v1/exams/${examId}/process`)
      .set(auth(controllerToken))
      .send({})
      .expect(201);
    await waitForRun(examId);
  });

  // ── reports ─────────────────────────────────────────────────────────

  describe('reports', () => {
    it('builds the tabulation matrix', async () => {
      const sheet = dataOf<{
        papers: unknown[];
        rows: Array<{ rollNo: number; marks: Record<string, unknown> }>;
        summary: { passed: number; failed: number };
      }>(
        await server()
          .get(`/api/v1/exams/${examId}/tabulation?sectionId=${sectionA}`)
          .set(auth(adminToken))
          .expect(200),
      );

      expect(sheet.papers).toHaveLength(4);
      expect(sheet.rows).toHaveLength(6);
      expect(sheet.summary).toMatchObject({ passed: 3, failed: 3 });
      // A student who did not take the optional paper has a null cell,
      // not a zero.
      const roll5 = sheet.rows.find((r) => r.rollNo === 5)!;
      expect(roll5.marks[paperOf.get(subOptional)!]).toBeNull();
    });

    it('streams the tabulation as XLSX and PDF', async () => {
      await server()
        .get(`/api/v1/exams/${examId}/tabulation.xlsx`)
        .set(auth(adminToken))
        .expect(200)
        .expect('Content-Type', /spreadsheetml/);
      await server()
        .get(`/api/v1/exams/${examId}/tabulation.pdf`)
        .set(auth(adminToken))
        .expect(200)
        .expect('Content-Type', /pdf/);
    });

    it('renders report cards, one page per candidate', async () => {
      const res = await server()
        .get(`/api/v1/exams/${examId}/report-cards?sectionId=${sectionA}`)
        .set(auth(adminToken))
        .expect(200)
        .expect('Content-Type', /pdf/);
      expect(res.headers['x-report-cards-issued']).toBe('6');
      expect((res.body as Buffer).length).toBeGreaterThan(1000);
    });

    it('reports analytics with a GPA histogram and subject difficulty', async () => {
      const analytics = dataOf<{
        overall: { passRate: number; candidates: number };
        gpaDistribution: Array<{ grade: string; count: number }>;
        subjects: Array<{ subjectName: string; averagePercentage: number }>;
      }>(
        await server()
          .get(`/api/v1/exams/${examId}/analytics`)
          .set(auth(adminToken))
          .expect(200),
      );

      expect(analytics.overall.candidates).toBe(6);
      expect(analytics.overall.passRate).toBe(50);
      expect(analytics.gpaDistribution.length).toBeGreaterThan(0);
      expect(analytics.subjects).toHaveLength(4);
    });
  });

  // ── publication ─────────────────────────────────────────────────────

  describe('publication', () => {
    it('publishes, stamps the results and advances the exam', async () => {
      const summary = dataOf<{
        publication: { version: number; isActive: boolean };
        results: number;
      }>(
        await server()
          .post(`/api/v1/exams/${examId}/publish`)
          .set(auth(adminToken))
          .send({ channels: { portal: true, website: true } })
          .expect(201),
      );

      expect(summary.publication).toMatchObject({ version: 1, isActive: true });
      expect(summary.results).toBe(6);

      const exam = await prisma.exam.findUnique({
        where: { id: examId },
        select: { status: true },
      });
      expect(exam!.status).toBe('PUBLISHED');
    });

    it('finds a published result through the public search', async () => {
      const result = dataOf<{
        student: { rollNo: number };
        gpa: number;
        grade: string;
      }>(
        await server()
          .get(
            `/api/v1/public/results/search?examId=${examId}&classId=${classA}&rollNo=1`,
          )
          .expect(200),
      );

      expect(result.student.rollNo).toBe(1);
      expect(result.gpa).toBe(5);
    });

    it('refuses the public search without exactly one identifier', async () => {
      await server()
        .get(`/api/v1/public/results/search?examId=${examId}&classId=${classA}`)
        .expect(400);
    });

    it('hides a WITHHELD result from the public search', async () => {
      const result = await prisma.result.findFirstOrThrow({
        where: { examId, enrollmentId: enrollments.get(1) },
      });
      await server()
        .put(`/api/v1/results/${result.id}/withhold`)
        .set(auth(adminToken))
        .send({ withheld: true, reason: 'Outstanding dues' })
        .expect(200);

      // Deliberately the SAME 404 as "no such student" — a public
      // endpoint must not confirm that a person exists.
      await server()
        .get(
          `/api/v1/public/results/search?examId=${examId}&classId=${classA}&rollNo=1`,
        )
        .expect(404);
    });

    it('refuses to withhold without a reason', async () => {
      const result = await prisma.result.findFirstOrThrow({
        where: { examId, enrollmentId: enrollments.get(2) },
      });
      await server()
        .put(`/api/v1/results/${result.id}/withhold`)
        .set(auth(adminToken))
        .send({ withheld: true })
        .expect(400);
    });

    it('a re-run does not quietly release a withheld result', async () => {
      await server()
        .post(`/api/v1/exams/${examId}/process`)
        .set(auth(controllerToken))
        .send({})
        .expect(201);
      await waitForRun(examId);

      const result = await prisma.result.findFirstOrThrow({
        where: { examId, enrollmentId: enrollments.get(1) },
      });
      expect(result.status).toBe('WITHHELD');
      expect(result.withheldReason).toBe('Outstanding dues');
    });

    it('releases the withheld result again', async () => {
      const result = await prisma.result.findFirstOrThrow({
        where: { examId, enrollmentId: enrollments.get(1) },
      });
      const released = dataOf<{ status: string }>(
        await server()
          .put(`/api/v1/results/${result.id}/withhold`)
          .set(auth(adminToken))
          .send({ withheld: false })
          .expect(200),
      );
      expect(released.status).toBe('PASSED');
    });

    it('unpublishes without touching the computed results', async () => {
      await server()
        .post(`/api/v1/exams/${examId}/unpublish`)
        .set(auth(adminToken))
        .send({ reason: 'Re-check pending' })
        .expect(201);

      // Visibility is the ACTIVE publication, not `exams.status` — the
      // status machine cannot rewind past PUBLISHED (M14).
      const exam = await prisma.exam.findUnique({
        where: { id: examId },
        select: { status: true },
      });
      expect(exam!.status).toBe('PUBLISHED');
      expect(await prisma.result.count({ where: { examId } })).toBe(6);

      await server()
        .get(
          `/api/v1/public/results/search?examId=${examId}&classId=${classA}&rollNo=2`,
        )
        .expect(404);
    });
  });

  // ── the correction / re-check flow ──────────────────────────────────

  describe('corrections', () => {
    it('changes a LOCKED mark, logs it, and re-processes the candidate', async () => {
      const mark = await prisma.mark.findFirstOrThrow({
        where: {
          examId,
          examSubjectId: paperOf.get(subBangla),
          enrollmentId: enrollments.get(4),
        },
      });

      await server()
        .put(`/api/v1/exams/${examId}/marks/${mark.id}/correct`)
        .set(auth(adminToken))
        .send({
          enrollmentId: enrollments.get(4),
          total: 60,
          reason: 'Re-check: page 3 was left unmarked',
        })
        .expect(200);

      const log = dataOf<
        Array<{ reason: string; oldValues: { total: number } }>
      >(
        await server()
          .get(`/api/v1/exams/${examId}/marks/corrections`)
          .set(auth(adminToken))
          .expect(200),
      );
      expect(log).toHaveLength(1);
      expect(log[0].reason).toMatch(/page 3/);
      expect(Number(log[0].oldValues.total)).toBe(20);

      // Roll 4 failed on that paper; correcting it should flip the whole
      // result to PASSED and give them a merit position.
      const result = await prisma.result.findFirstOrThrow({
        where: { examId, enrollmentId: enrollments.get(4) },
      });
      expect(result.status).toBe('PASSED');
      expect(result.meritPositionClass).not.toBeNull();
    });

    it('re-ranks everyone, not just the corrected candidate', async () => {
      // Leaving the others untouched would publish two students at the
      // same position with a gap above them.
      const results = await prisma.result.findMany({
        where: { examId, status: 'PASSED' },
        select: { meritPositionClass: true },
      });
      const positions = results
        .map((r) => r.meritPositionClass)
        .filter((p): p is number => p !== null)
        .sort((a, b) => a - b);
      expect(new Set(positions).size).toBe(positions.length);
    });

    it('refuses a correction with no reason', async () => {
      const mark = await prisma.mark.findFirstOrThrow({
        where: { examId, enrollmentId: enrollments.get(3) },
      });
      await server()
        .put(`/api/v1/exams/${examId}/marks/${mark.id}/correct`)
        .set(auth(adminToken))
        .send({ enrollmentId: enrollments.get(3), total: 70 })
        .expect(400);
    });

    it('republishes as version 2 with a changelog', async () => {
      const summary = dataOf<{
        publication: { version: number; note: string };
      }>(
        await server()
          .post(`/api/v1/exams/${examId}/publish`)
          .set(auth(adminToken))
          .send({ channels: { portal: true, website: true } })
          .expect(201),
      );

      // v1 was published then revoked; revoking does not consume a
      // version number, so the re-issue after the correction is v2.
      expect(summary.publication.version).toBe(2);

      const history = dataOf<{ publications: Array<{ isActive: boolean }> }>(
        await server()
          .get(`/api/v1/exams/${examId}/publications`)
          .set(auth(adminToken))
          .expect(200),
      );
      // Exactly one active version — the partial unique index says so.
      expect(history.publications.filter((p) => p.isActive)).toHaveLength(1);
    });
  });

  // ── transcripts and the student history tab ─────────────────────────

  describe('transcripts', () => {
    it('returns a student’s exam history', async () => {
      const transcript = dataOf<{ exams: unknown[]; student: { uid: string } }>(
        await server()
          .get(`/api/v1/students/${studentIds.get(1)}/transcript`)
          .set(auth(adminToken))
          .expect(200),
      );
      expect(transcript.exams).toHaveLength(1);
      expect(transcript.student.uid).toMatch(/^E2E-RS-/);
    });

    it('streams the transcript PDF', async () => {
      await server()
        .get(`/api/v1/students/${studentIds.get(1)}/transcript.pdf`)
        .set(auth(adminToken))
        .expect(200)
        .expect('Content-Type', /pdf/);
    });

    it('fills the M09 performance-history slot with real data', async () => {
      const history = dataOf<{ available: boolean; items: unknown[] }>(
        await server()
          .get(`/api/v1/students/${studentIds.get(1)}/performance-history`)
          .set(auth(adminToken))
          .expect(200),
      );
      expect(history.available).toBe(true);
      expect(history.items).toHaveLength(1);
    });
  });

  // ── combined results ────────────────────────────────────────────────

  describe('combined results', () => {
    beforeAll(async () => {
      // Give the second exam a full set of locked marks and process it,
      // so there are two exams to merge.
      const papers = dataOf<Array<{ id: string; subjectId: string }>>(
        await server()
          .get(`/api/v1/exams/${secondExamId}/subjects`)
          .set(auth(adminToken))
          .expect(200),
      );
      for (const paper of papers) {
        const optional = paper.subjectId === subOptional;
        const rolls = optional ? [1, 2] : [1, 2, 3, 4, 5, 6];
        await server()
          .put(`/api/v1/exams/${secondExamId}/marks`)
          .set(auth(adminToken))
          .send({
            examSubjectId: paper.id,
            marks: rolls.map((roll) => ({
              enrollmentId: enrollments.get(roll),
              total: 90 - roll * 5,
            })),
          })
          .expect(200);
        for (const action of ['submit', 'verify', 'lock']) {
          await server()
            .post(`/api/v1/exams/${secondExamId}/marks/${action}`)
            .set(auth(adminToken))
            .send({ examSubjectId: paper.id })
            .expect(201);
        }
      }
      await server()
        .post(`/api/v1/exams/${secondExamId}/process`)
        .set(auth(adminToken))
        .send({})
        .expect(201);
      await waitForRun(secondExamId);
    }, 120_000);

    it('refuses a weight set that does not sum to 100', async () => {
      const res = await server()
        .post('/api/v1/combined-results/generate')
        .set(auth(adminToken))
        .send({
          name: 'E2E RS Final',
          sessionId,
          components: [
            { examId, weight: 30 },
            { examId: secondExamId, weight: 60 },
          ],
        })
        .expect(400);
      expect(JSON.stringify(res.body)).toMatch(/sum to 90/);
    });

    it('refuses the same exam twice', async () => {
      await server()
        .post('/api/v1/combined-results/generate')
        .set(auth(adminToken))
        .send({
          name: 'E2E RS Final',
          sessionId,
          components: [
            { examId, weight: 50 },
            { examId, weight: 50 },
          ],
        })
        .expect(400);
    });

    it('generates a weighted merge and freezes the weights onto each row', async () => {
      const outcome = dataOf<{ generated: number; skipped: unknown[] }>(
        await server()
          .post('/api/v1/combined-results/generate')
          .set(auth(adminToken))
          .send({
            name: 'E2E RS Final',
            sessionId,
            components: [
              { examId, weight: 30 },
              { examId: secondExamId, weight: 70 },
            ],
          })
          .expect(201),
      );
      expect(outcome.generated).toBe(6);

      const rows = dataOf<
        Array<{
          enrollment: { rollNo: number };
          gpa: string;
          weights: Record<string, number>;
          meritPositionClass: number | null;
        }>
      >(
        await server()
          .get(
            `/api/v1/combined-results?name=${encodeURIComponent('E2E RS Final')}&sessionId=${sessionId}`,
          )
          .set(auth(adminToken))
          .expect(200),
      );

      expect(rows).toHaveLength(6);
      // The weight set is frozen onto the row, so editing the exam
      // type's weight later cannot restate an issued final result.
      expect(rows[0].weights[examId]).toBe(30);
      expect(rows[0].weights[secondExamId]).toBe(70);
      expect(rows.some((r) => r.meritPositionClass === 1)).toBe(true);
    });

    it('lists the batch in the session', async () => {
      const batches = dataOf<Array<{ name: string; candidates: number }>>(
        await server()
          .get(`/api/v1/combined-results/batches?sessionId=${sessionId}`)
          .set(auth(adminToken))
          .expect(200),
      );
      expect(batches.find((b) => b.name === 'E2E RS Final')?.candidates).toBe(
        6,
      );
    });
  });

  // ── the guards this module armed in earlier ones ────────────────────

  describe('cross-module guards armed by M15', () => {
    it('refuses to delete an exam paper once marks exist (M14 slot)', async () => {
      await server()
        .delete(`/api/v1/exams/${examId}/subjects/${paperOf.get(subBangla)}`)
        .set(auth(adminToken))
        .expect(409);
    });

    it('refuses to detach a class once marks exist (M14 slot)', async () => {
      // The guard is only REACHABLE on a shape-editable exam, and M14
      // freezes the shape at MARK_ENTRY — so the path that needs
      // guarding is: enter marks, step the status back one (M14 allows
      // exactly one step back), then try to detach the class. Without
      // this check that sequence silently cascades the marks away.
      const third = dataOf<{ id: string }>(
        await server()
          .post('/api/v1/exams')
          .set(auth(adminToken))
          .send({
            name: 'E2E RS Exam Three',
            sessionId,
            examTypeId: examTypeId,
            startDate: day(-40),
            endDate: day(-36),
            classIds: [classA],
          })
          .expect(201),
      );

      const papers = dataOf<Array<{ id: string; subjectId: string }>>(
        await server()
          .get(`/api/v1/exams/${third.id}/subjects`)
          .set(auth(adminToken))
          .expect(200),
      );
      await server()
        .put(`/api/v1/exams/${third.id}/subjects`)
        .set(auth(adminToken))
        .send({
          subjects: papers.map((paper, index) => ({
            classId: classA,
            subjectId: paper.subjectId,
            fullMarks: 100,
            passMarks: 33,
            examDate: day(-40 + index),
            startTime: '09:00',
            durationMin: 180,
            room: 'RS-HALL-C',
          })),
        })
        .expect(200);

      for (const status of ['SCHEDULED', 'ONGOING', 'MARK_ENTRY']) {
        await server()
          .put(`/api/v1/exams/${third.id}/status`)
          .set(auth(adminToken))
          .send({ status })
          .expect(200);
      }

      await server()
        .put(`/api/v1/exams/${third.id}/marks`)
        .set(auth(adminToken))
        .send({
          examSubjectId: papers[0].id,
          marks: [{ enrollmentId: enrollments.get(1), total: 70 }],
        })
        .expect(200);

      // One step back — the shape unfreezes.
      await server()
        .put(`/api/v1/exams/${third.id}/status`)
        .set(auth(adminToken))
        .send({ status: 'ONGOING' })
        .expect(200);

      const res = await server()
        .put(`/api/v1/exams/${third.id}/classes`)
        .set(auth(adminToken))
        .send({ classIds: [classB] })
        .expect(409);
      expect(JSON.stringify(res.body)).toMatch(
        /mark\(s\) have already been entered/,
      );
    });

    it('refuses to drop a subject from the curriculum once marks exist (M06 slot)', async () => {
      const res = await server()
        .put(`/api/v1/classes/${classA}/subjects`)
        .set(auth(adminToken))
        .send({
          sessionId,
          subjects: [
            { subjectId: subBangla },
            { subjectId: subMaths },
            { subjectId: subScience },
          ],
        })
        .expect(409);
      expect(JSON.stringify(res.body)).toMatch(/exam mark\(s\)/);
    });
  });

  // ── the DB constraints, driven past the service on purpose ──────────

  describe('database constraints', () => {
    const raw = (sql: string) => prisma.$executeRawUnsafe(sql);

    it('chk_marks_absent_empty refuses an absent candidate with marks', async () => {
      const mark = await prisma.mark.findFirstOrThrow({ where: { examId } });
      await expect(
        raw(
          `UPDATE marks SET is_absent = true, total = 40 WHERE id = '${mark.id}'`,
        ),
      ).rejects.toThrow(/chk_marks_absent_empty/);
    });

    it('chk_marks_grade_pair refuses a grade with no grade point', async () => {
      const mark = await prisma.mark.findFirstOrThrow({ where: { examId } });
      await expect(
        raw(
          `UPDATE marks SET grade = 'A+', grade_point = NULL WHERE id = '${mark.id}'`,
        ),
      ).rejects.toThrow(/chk_marks_grade_pair/);
    });

    it('chk_results_gpa_range refuses a GPA above the scale', async () => {
      const result = await prisma.result.findFirstOrThrow({
        where: { examId },
      });
      await expect(
        raw(`UPDATE results SET gpa = 9.5 WHERE id = '${result.id}'`),
      ).rejects.toThrow(/chk_results_gpa_range/);
    });

    it('chk_results_withheld_reason refuses a withheld row with no reason', async () => {
      const result = await prisma.result.findFirstOrThrow({
        where: { examId },
      });
      await expect(
        raw(
          `UPDATE results SET status = 'WITHHELD', withheld_reason = NULL WHERE id = '${result.id}'`,
        ),
      ).rejects.toThrow(/chk_results_withheld_reason/);
    });

    it('uq_result_publications_one_active keeps the active version singular', async () => {
      const active = await prisma.resultPublication.findFirstOrThrow({
        where: { examId, isActive: true },
      });
      await expect(
        raw(
          `UPDATE result_publications SET is_active = true WHERE exam_id = '${examId}' AND id <> '${active.id}'`,
        ),
      ).rejects.toThrow(/uq_result_publications_one_active/);
    });
  });

  /**
   * Poll until the queued run finishes. Processing goes through BullMQ,
   * so the POST returns before the work is done — which is the whole
   * reason the run's progress is durable in Postgres.
   */
  async function waitForRun(exam: string): Promise<void> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const run = await prisma.resultRun.findFirst({
        where: { examId: exam },
        orderBy: { createdAt: 'desc' },
      });
      if (run && (run.status === 'COMPLETED' || run.status === 'FAILED')) {
        if (run.status === 'FAILED') {
          throw new Error(`Result run failed: ${run.error ?? 'unknown'}`);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Result run did not finish in time');
  }
});
