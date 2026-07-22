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
 * Requires dev infra (DB + redis). The whole M14 loop: define an exam
 * type, create an exam that seeds its papers from the class curricula,
 * have the clash engine refuse a structural clash but waive a same-day
 * one, walk the status machine to PUBLISHED, and prove the grade scale
 * was frozen on the way. Seat plans, admit cards, the postponement tool
 * and the curriculum sync are exercised in between.
 *
 * Everything is created under distinctive `E2E-EX`/`E2E EX` names and
 * removed in afterAll (the session FK cascades take sections, enrollments
 * and the exams themselves).
 */
describe('Examination (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-ex-admin@test.local';
  const VIEWER = 'e2e-ex-viewer@test.local';
  const SCHEDULER = 'e2e-ex-scheduler@test.local';
  const PLAIN = 'e2e-ex-plain@test.local';
  const NAME = 'E2EEX';
  const VIEWER_ROLE = 'e2e-ex-viewer';
  const SCHEDULER_ROLE = 'e2e-ex-scheduler';

  let adminToken: string;
  let viewerToken: string;
  let schedulerToken: string;
  let plainToken: string;

  let sessionId: string;
  let examTypeId: string;
  let examId: string;
  let classA: string;
  let classB: string;
  let sectionA: string;
  let subject1: string;
  let subject2: string;
  let subject3: string;
  let subject4: string;
  const enrollmentsA: string[] = [];
  let lateEnrollmentId: string;

  /**
   * Dates are computed relative to today rather than hard-coded: the exam
   * window has to sit inside the session AND be in the past, because
   * `→ MARK_ENTRY` is refused until the exam is over unless overridden.
   */
  const day = (offset: number): string => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const WINDOW_START = day(-13);
  const WINDOW_END = day(-9);
  const D1 = day(-12);
  const D2 = day(-11);
  const D3 = day(-10);

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;

  /** The clean routine: one paper per class per day, distinct rooms. */
  const canonicalRows = () => [
    {
      classId: classA,
      subjectId: subject1,
      fullMarks: 100,
      passMarks: 33,
      cqMarks: 70,
      mcqMarks: 30,
      examDate: D1,
      startTime: '09:00',
      durationMin: 180,
      room: 'HALL-A',
    },
    {
      classId: classA,
      subjectId: subject2,
      fullMarks: 100,
      passMarks: 33,
      examDate: D2,
      startTime: '09:00',
      durationMin: 180,
      room: 'HALL-A',
    },
    {
      classId: classA,
      subjectId: subject3,
      fullMarks: 100,
      passMarks: 33,
      examDate: D3,
      startTime: '09:00',
      durationMin: 180,
      room: 'HALL-A',
    },
    {
      classId: classB,
      subjectId: subject1,
      fullMarks: 100,
      passMarks: 33,
      examDate: D1,
      startTime: '09:00',
      durationMin: 180,
      room: 'HALL-B',
    },
  ];

  const putSubjects = (
    rows: ReturnType<typeof canonicalRows>,
    token = adminToken,
    override?: boolean,
  ) =>
    server()
      .put(`/api/v1/exams/${examId}/subjects`)
      .set(auth(token))
      .send({
        subjects: rows,
        ...(override === undefined ? {} : { override }),
      });

  const setStatus = (status: string, body: Record<string, unknown> = {}) =>
    server()
      .put(`/api/v1/exams/${examId}/status`)
      .set(auth(adminToken))
      .send({ status, ...body });

  const cleanup = async () => {
    // Cascades from the session take sections, class_subjects,
    // enrollments and the exams (with their papers and seat plans).
    await prisma.academicSession.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E-EX ' } },
    });
    await prisma.student.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: NAME },
    });
    await prisma.examType.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E EX ' } },
    });
    await prisma.subject.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, code: { startsWith: 'E2EEXS' } },
    });
    await prisma.schoolClass.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: { startsWith: 'E2E EXClass' },
      },
    });
    await prisma.role.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        slug: { in: [VIEWER_ROLE, SCHEDULER_ROLE] },
      },
    });
    const users = await prisma.user.findMany({
      where: { email: { in: [ADMIN, VIEWER, SCHEDULER, PLAIN] } },
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
    const [adminUser, viewerUser, schedulerUser] = await Promise.all(
      (
        [
          [ADMIN, UserType.ADMIN],
          [VIEWER, UserType.STAFF],
          [SCHEDULER, UserType.STAFF],
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
        data: permissions.map((p) => ({
          roleId: role.id,
          permissionId: p.id,
        })),
      });
      await prisma.userRole.create({ data: { userId, roleId: role.id } });
    };

    // Reads an exam but may not build one.
    await grantRole(VIEWER_ROLE, 'E2E Exam Viewer', viewerUser.id, [
      'exam.view',
      'structure.view',
    ]);
    // Builds a routine but may NOT waive the same-day policy — the
    // boundary `exam.schedule.override` exists to draw.
    await grantRole(SCHEDULER_ROLE, 'E2E Exam Scheduler', schedulerUser.id, [
      'exam.view',
      'exam.manage',
      'exam.schedule',
    ]);

    const session = await prisma.academicSession.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `E2E-EX ${new Date().getUTCFullYear()}`,
        startDate: new Date(day(-180)),
        endDate: new Date(day(180)),
        status: 'ACTIVE',
      },
    });
    sessionId = session.id;

    const makeClass = async (name: string, level: number) => {
      const klass = await prisma.schoolClass.create({
        data: { schoolId: DEFAULT_SCHOOL_ID, name, numericLevel: level },
      });
      return klass.id;
    };
    classA = await makeClass('E2E EXClassA', 17);
    classB = await makeClass('E2E EXClassB', 18);

    const makeSubject = async (code: string, name: string) => {
      const subject = await prisma.subject.create({
        data: { schoolId: DEFAULT_SCHOOL_ID, name, code },
      });
      return subject.id;
    };
    subject1 = await makeSubject('E2EEXS1', 'E2E Exam Bangla');
    subject2 = await makeSubject('E2EEXS2', 'E2E Exam Maths');
    subject3 = await makeSubject('E2EEXS3', 'E2E Exam Higher Maths');
    subject4 = await makeSubject('E2EEXS4', 'E2E Exam Agriculture');

    // Class A studies three subjects, the third as the BD "4th subject";
    // class B studies only the first. The optional mapping is what makes
    // the candidate-resolution rule observable.
    await prisma.classSubject.createMany({
      data: [
        {
          schoolId: DEFAULT_SCHOOL_ID,
          classId: classA,
          subjectId: subject1,
          sessionId,
        },
        {
          schoolId: DEFAULT_SCHOOL_ID,
          classId: classA,
          subjectId: subject2,
          sessionId,
        },
        {
          schoolId: DEFAULT_SCHOOL_ID,
          classId: classA,
          subjectId: subject3,
          sessionId,
          isOptional: true,
        },
        {
          schoolId: DEFAULT_SCHOOL_ID,
          classId: classB,
          subjectId: subject1,
          sessionId,
        },
      ],
    });

    const makeSection = async (classId: string, name: string) => {
      const section = await prisma.section.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          classId,
          sessionId,
          name,
          roomNo: `R-${name}`,
        },
      });
      return section.id;
    };
    sectionA = await makeSection(classA, 'A1');
    const sectionB = await makeSection(classB, 'B1');

    /** Enroll a student; `optional` picks the 4th subject. */
    const enroll = async (
      classId: string,
      sectionId: string,
      index: number,
      optional?: string,
    ): Promise<string> => {
      const student = await prisma.student.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          studentUid: `E2E-EX-${Date.now()}-${index}`,
          firstName: NAME,
          lastName: `Pupil${index}`,
          gender: 'MALE',
          dob: new Date('2012-04-04'),
          admissionDate: new Date(day(-200)),
          admissionClassId: classId,
          qrToken: randomUUID(),
        },
      });
      const enrollment = await prisma.enrollment.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          studentId: student.id,
          sessionId,
          classId,
          sectionId,
          rollNo: index,
          enrollmentDate: new Date(day(-190)),
          status: 'ACTIVE',
          ...(optional ? { optionalSubjectId: optional } : {}),
        },
      });
      return enrollment.id;
    };

    // Six in class A, the first two of them taking the optional paper.
    for (let i = 1; i <= 6; i += 1) {
      enrollmentsA.push(
        await enroll(classA, sectionA, i, i <= 2 ? subject3 : undefined),
      );
    }
    for (let i = 1; i <= 2; i += 1) {
      await enroll(classB, sectionB, i);
    }

    const login = async (identifier: string) => {
      const res = await server()
        .post('/api/v1/auth/login')
        .send({ identifier, password: PASSWORD })
        .expect(200);
      return (res.body as { data: { accessToken: string } }).data.accessToken;
    };
    adminToken = await login(ADMIN);
    viewerToken = await login(VIEWER);
    schedulerToken = await login(SCHEDULER);
    plainToken = await login(PLAIN);
  }, 180_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  }, 120_000);

  // ── permissions ─────────────────────────────────────────────────────

  it('is permission-guarded', async () => {
    await server()
      .get(`/api/v1/exams?sessionId=${sessionId}`)
      .set(auth(plainToken))
      .expect(403);
    await server()
      .post('/api/v1/exam-types')
      .set(auth(viewerToken))
      .send({ name: 'E2E EX Sneaky' })
      .expect(403);
  });

  // ── exam types ──────────────────────────────────────────────────────

  it('creates an exam type carrying its combination weight', async () => {
    const res = await server()
      .post('/api/v1/exam-types')
      .set(auth(adminToken))
      .send({ name: 'E2E EX Half Yearly', weight: 40 })
      .expect(201);
    const type = dataOf<{ id: string; name: string }>(res);
    examTypeId = type.id;
    expect(type.name).toBe('E2E EX Half Yearly');
  });

  it('refuses a duplicate exam-type name case-insensitively', async () => {
    await server()
      .post('/api/v1/exam-types')
      .set(auth(adminToken))
      .send({ name: 'e2e ex HALF yearly' })
      .expect(409);
  });

  // ── the exam aggregate ──────────────────────────────────────────────

  it('creates an exam and seeds a paper per curriculum subject', async () => {
    const res = await server()
      .post('/api/v1/exams')
      .set(auth(adminToken))
      .send({
        examTypeId,
        sessionId,
        name: 'E2E EX Half Yearly 2026',
        startDate: WINDOW_START,
        endDate: WINDOW_END,
        classIds: [classA, classB],
      })
      .expect(201);
    const exam = dataOf<{ id: string; status: string }>(res);
    examId = exam.id;
    expect(exam.status).toBe('DRAFT');

    const detail = await server()
      .get(`/api/v1/exams/${examId}`)
      .set(auth(viewerToken))
      .expect(200);
    const overview = dataOf<{
      papers: { total: number; scheduled: number; unscheduled: number };
      nextStatuses: string[];
      shapeEditable: boolean;
    }>(detail);
    // 3 for class A + 1 for class B.
    expect(overview.papers.total).toBe(4);
    expect(overview.papers.unscheduled).toBe(4);
    expect(overview.nextStatuses).toContain('SCHEDULED');
    expect(overview.shapeEditable).toBe(true);
  });

  it('refuses a duplicate exam name in the same session', async () => {
    await server()
      .post('/api/v1/exams')
      .set(auth(adminToken))
      .send({
        examTypeId,
        sessionId,
        name: 'e2e ex half yearly 2026',
        startDate: WINDOW_START,
        endDate: WINDOW_END,
      })
      .expect(409);
  });

  it('refuses an exam window outside the session', async () => {
    await server()
      .post('/api/v1/exams')
      .set(auth(adminToken))
      .send({
        examTypeId,
        sessionId,
        name: 'E2E EX Out Of Session',
        startDate: day(-400),
        endDate: day(-390),
      })
      .expect(400);
  });

  it('will not delete the exam type while an exam references it', async () => {
    await server()
      .delete(`/api/v1/exam-types/${examTypeId}`)
      .set(auth(adminToken))
      .expect(409);
  });

  // ── papers, distribution and the clash engine ───────────────────────

  it('refuses SCHEDULED while papers have no sitting', async () => {
    await setStatus('SCHEDULED').expect(400);
  });

  it('rejects a component split that does not sum to full marks', async () => {
    const rows = canonicalRows();
    rows[0].mcqMarks = 20; // 70 + 20 ≠ 100
    const res = await putSubjects(rows).expect(400);
    const body = res.body as { error?: { details?: { errors: string[] } } };
    expect(body.error?.details?.errors.length).toBeGreaterThan(0);

    // Nothing was saved — the grid is still entirely unscheduled.
    const detail = await server()
      .get(`/api/v1/exams/${examId}`)
      .set(auth(adminToken))
      .expect(200);
    expect(
      dataOf<{ papers: { unscheduled: number } }>(detail).papers.unscheduled,
    ).toBe(4);
  });

  it('refuses a structural clash — one class in two halls at once', async () => {
    const rows = canonicalRows();
    rows[1].examDate = D1; // class A sits two papers at 09:00 on D1
    const res = await putSubjects(rows).expect(409);
    const body = res.body as {
      error?: { details?: { clashes: Array<{ kind: string }> } };
    };
    expect(body.error?.details?.clashes.map((c) => c.kind)).toContain(
      'CLASS_OVERLAP',
    );
  });

  it('will not let override waive a structural room double-booking', async () => {
    const rows = canonicalRows();
    rows[3].room = 'HALL-A'; // class B into class A's hall at the same hour
    const res = await putSubjects(rows, adminToken, true).expect(409);
    const body = res.body as {
      error?: { details?: { clashes: Array<{ kind: string }> } };
    };
    expect(body.error?.details?.clashes.map((c) => c.kind)).toContain('ROOM');
  });

  it('treats the same-day policy as waivable, not structural', async () => {
    const rows = canonicalRows();
    rows[1].examDate = D1;
    rows[1].startTime = '14:00'; // same day, no time overlap
    const res = await putSubjects(rows).expect(409);
    const body = res.body as {
      error?: {
        message: string;
        details?: { clashes: unknown[]; waivable: Array<{ kind: string }> };
      };
    };
    expect(body.error?.details?.clashes).toHaveLength(0);
    expect(body.error?.details?.waivable.map((c) => c.kind)).toContain(
      'CLASS_SAME_DAY',
    );
  });

  it('requires exam.schedule.override to waive the same-day warning', async () => {
    const rows = canonicalRows();
    rows[1].examDate = D1;
    rows[1].startTime = '14:00';
    await putSubjects(rows, schedulerToken, true).expect(403);
  });

  it('saves the same-day routine when an entitled user overrides', async () => {
    const rows = canonicalRows();
    rows[1].examDate = D1;
    rows[1].startTime = '14:00';
    const res = await putSubjects(rows, adminToken, true).expect(200);
    const result = dataOf<{ saved: number; warnings: Array<{ kind: string }> }>(
      res,
    );
    expect(result.saved).toBe(4);
    expect(result.warnings.map((w) => w.kind)).toContain('CLASS_SAME_DAY');
  });

  it('saves the clean routine', async () => {
    const res = await putSubjects(canonicalRows()).expect(200);
    const result = dataOf<{ saved: number; warnings: unknown[] }>(res);
    expect(result.saved).toBe(4);
    expect(result.warnings).toHaveLength(0);
  });

  // ── status machine ──────────────────────────────────────────────────

  it('advances to SCHEDULED once every paper has a sitting', async () => {
    const res = await setStatus('SCHEDULED').expect(200);
    expect(dataOf<{ status: string }>(res).status).toBe('SCHEDULED');
  });

  it('refuses an illegal jump in the status machine', async () => {
    await setStatus('PUBLISHED').expect(400);
  });

  // ── routine ─────────────────────────────────────────────────────────

  it('reports the routine grouped by date with no clashes', async () => {
    const res = await server()
      .get(`/api/v1/exams/${examId}/routine`)
      .set(auth(viewerToken))
      .expect(200);
    const routine = dataOf<{
      days: Array<{ date: string; sittings: unknown[] }>;
      unscheduled: unknown[];
      clashes: unknown[];
    }>(res);
    expect(routine.days.map((d) => d.date)).toEqual([D1, D2, D3]);
    expect(routine.days[0].sittings).toHaveLength(2); // both classes on D1
    expect(routine.unscheduled).toHaveLength(0);
    expect(routine.clashes).toHaveLength(0);
  });

  it('streams a routine PDF', async () => {
    const res = await server()
      .get(`/api/v1/exams/${examId}/routine/pdf`)
      .set(auth(adminToken))
      .responseType('blob')
      .expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  // ── candidate resolution (the optional-subject rule) ────────────────

  it('counts every attached class sitting a paper that day', async () => {
    const res = await server()
      .get(`/api/v1/exams/${examId}/seat-plans/candidates?date=${D1}`)
      .set(auth(adminToken))
      .expect(200);
    // 6 in class A + 2 in class B, both of which sit a paper on D1.
    expect(dataOf<unknown[]>(res)).toHaveLength(8);
  });

  it('seats only the students who chose an optional paper', async () => {
    const res = await server()
      .get(`/api/v1/exams/${examId}/seat-plans/candidates?date=${D3}`)
      .set(auth(adminToken))
      .expect(200);
    // D3 is the 4th-subject paper — only the two who picked it.
    expect(dataOf<unknown[]>(res)).toHaveLength(2);
  });

  // ── postponement ────────────────────────────────────────────────────

  it('refuses to postpone a day past the exam window without consent', async () => {
    await server()
      .post(`/api/v1/exams/${examId}/routine/shift-day`)
      .set(auth(adminToken))
      .send({ fromDate: D3, toDate: day(-8) })
      .expect(409);
  });

  it('postpones every sitting of a day in one operation', async () => {
    const res = await server()
      .post(`/api/v1/exams/${examId}/routine/shift-day`)
      .set(auth(adminToken))
      .send({ fromDate: D3, toDate: WINDOW_END, reason: 'E2E strike' })
      .expect(201);
    const result = dataOf<{
      moved: number;
      routine: { days: Array<{ date: string }> };
    }>(res);
    expect(result.moved).toBe(1);
    expect(result.routine.days.map((d) => d.date)).toEqual([
      D1,
      D2,
      WINDOW_END,
    ]);
  });

  // ── seat plans ──────────────────────────────────────────────────────

  it('refuses to seat more candidates than the rooms hold', async () => {
    await server()
      .post(`/api/v1/exams/${examId}/seat-plans/generate`)
      .set(auth(adminToken))
      .send({ date: D1, rooms: [{ room: 'R1', capacity: 3 }] })
      .expect(409);
  });

  it('refuses duplicate room names within a date', async () => {
    await server()
      .post(`/api/v1/exams/${examId}/seat-plans/generate`)
      .set(auth(adminToken))
      .send({
        date: D1,
        rooms: [
          { room: 'R1', capacity: 10 },
          { room: 'r1', capacity: 10 },
        ],
      })
      .expect(400);
  });

  it('generates a serpentine seat plan across two rooms', async () => {
    const res = await server()
      .post(`/api/v1/exams/${examId}/seat-plans/generate`)
      .set(auth(adminToken))
      .send({
        date: D1,
        strategy: 'SERPENTINE',
        rooms: [
          { room: 'R1', capacity: 5 },
          { room: 'R2', capacity: 5 },
        ],
      })
      .expect(201);
    const result = dataOf<{
      rooms: number;
      seated: number;
      candidates: number;
      strategy: string;
    }>(res);
    expect(result).toMatchObject({
      rooms: 2,
      seated: 8,
      candidates: 8,
      strategy: 'SERPENTINE',
    });

    const list = await server()
      .get(`/api/v1/exams/${examId}/seat-plans?date=${D1}`)
      .set(auth(viewerToken))
      .expect(200);
    const plans = dataOf<Array<{ room: string; entries: unknown[] }>>(list);
    expect(plans).toHaveLength(2);
    expect(plans.reduce((n, p) => n + p.entries.length, 0)).toBe(8);
  });

  it('appends a late enrollee without disturbing the existing seats', async () => {
    const before = await prisma.seatPlanEntry.findMany({
      where: { seatPlan: { examId } },
      select: { enrollmentId: true, seatNo: true, seatPlanId: true },
      orderBy: [{ seatPlanId: 'asc' }, { seatNo: 'asc' }],
    });

    const student = await prisma.student.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        studentUid: `E2E-EX-${Date.now()}-late`,
        firstName: NAME,
        lastName: 'PupilLate',
        gender: 'FEMALE',
        dob: new Date('2012-06-06'),
        admissionDate: new Date(day(-20)),
        admissionClassId: classA,
        qrToken: randomUUID(),
      },
    });
    const enrollment = await prisma.enrollment.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        studentId: student.id,
        sessionId,
        classId: classA,
        sectionId: sectionA,
        rollNo: 99,
        enrollmentDate: new Date(day(-15)),
        status: 'ACTIVE',
      },
    });
    lateEnrollmentId = enrollment.id;

    const res = await server()
      .post(`/api/v1/exams/${examId}/seat-plans/append`)
      .set(auth(adminToken))
      .send({ date: D1, enrollmentId: lateEnrollmentId })
      .expect(201);
    const placed = dataOf<{ room: string; seatNo: number }>(res);
    expect(['R1', 'R2']).toContain(placed.room);
    expect(placed.seatNo).toBeGreaterThan(0);

    // Every previously printed admit card is still correct.
    const after = await prisma.seatPlanEntry.findMany({
      where: {
        seatPlan: { examId },
        enrollmentId: { not: lateEnrollmentId },
      },
      select: { enrollmentId: true, seatNo: true, seatPlanId: true },
      orderBy: [{ seatPlanId: 'asc' }, { seatNo: 'asc' }],
    });
    expect(after).toEqual(before);
  });

  it('refuses to seat the same candidate twice on a date', async () => {
    await server()
      .post(`/api/v1/exams/${examId}/seat-plans/append`)
      .set(auth(adminToken))
      .send({ date: D1, enrollmentId: lateEnrollmentId })
      .expect(409);
  });

  it('streams a seat-plan PDF', async () => {
    const res = await server()
      .get(`/api/v1/exams/${examId}/seat-plans/pdf?date=${D1}`)
      .set(auth(adminToken))
      .responseType('blob')
      .expect(200);
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  // ── admit cards ─────────────────────────────────────────────────────

  it('issues admit cards for a class and flags the photoless ones', async () => {
    const res = await server()
      .post(`/api/v1/exams/${examId}/admit-cards`)
      .set(auth(adminToken))
      .send({ classId: classA })
      .responseType('blob')
      .expect(201);
    // 6 original + the late enrollee.
    expect(res.headers['x-admit-cards-issued']).toBe('7');
    // No student has a photo, so every card prints a placeholder and is
    // reported incomplete rather than blocked (the M09 rule).
    expect(res.headers['x-admit-cards-incomplete']).toBe('7');
    expect(res.headers['x-admit-cards-blocked']).toBe('0');
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('reissues a single admit card by enrollment', async () => {
    const res = await server()
      .post(`/api/v1/exams/${examId}/admit-cards`)
      .set(auth(adminToken))
      .send({ enrollmentIds: [enrollmentsA[0]] })
      .responseType('blob')
      .expect(201);
    expect(res.headers['x-admit-cards-issued']).toBe('1');
  });

  it('requires exactly one admit-card selector', async () => {
    await server()
      .post(`/api/v1/exams/${examId}/admit-cards`)
      .set(auth(adminToken))
      .send({ classId: classA, sectionId: sectionA })
      .expect(400);
  });

  it('deletes a seat plan for a date, then reports it gone', async () => {
    await server()
      .delete(`/api/v1/exams/${examId}/seat-plans?date=${D1}`)
      .set(auth(adminToken))
      .expect(204);
    await server()
      .delete(`/api/v1/exams/${examId}/seat-plans?date=${D1}`)
      .set(auth(adminToken))
      .expect(404);
  });

  // ── curriculum sync (roadmap §8) ────────────────────────────────────

  it('diffs the papers against the class curricula and applies the add', async () => {
    await prisma.classSubject.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        classId: classA,
        subjectId: subject4,
        sessionId,
      },
    });

    const preview = await server()
      .get(`/api/v1/exams/${examId}/subjects-sync`)
      .set(auth(adminToken))
      .expect(200);
    const diff = dataOf<{
      missing: Array<{ subjectId: string }>;
      stale: unknown[];
    }>(preview);
    expect(diff.missing.map((m) => m.subjectId)).toEqual([subject4]);
    expect(diff.stale).toHaveLength(0);

    const applied = await server()
      .post(`/api/v1/exams/${examId}/subjects-sync`)
      .set(auth(adminToken))
      .send({ addMissing: true })
      .expect(201);
    expect(dataOf<{ added: number }>(applied).added).toBe(1);
  });

  it('removes a stale paper only when asked (removal is opt-in)', async () => {
    await prisma.classSubject.deleteMany({
      where: { classId: classA, subjectId: subject4, sessionId },
    });

    // The default apply adds but never removes.
    const defaulted = await server()
      .post(`/api/v1/exams/${examId}/subjects-sync`)
      .set(auth(adminToken))
      .send({})
      .expect(201);
    expect(dataOf<{ removed: number }>(defaulted).removed).toBe(0);

    const removed = await server()
      .post(`/api/v1/exams/${examId}/subjects-sync`)
      .set(auth(adminToken))
      .send({ addMissing: false, removeStale: true })
      .expect(201);
    expect(dataOf<{ removed: number }>(removed).removed).toBe(1);
  });

  // ── the rest of the lifecycle ───────────────────────────────────────

  it('walks ONGOING → MARK_ENTRY → PROCESSING', async () => {
    await setStatus('ONGOING').expect(200);
    // The window ends in the past, so mark entry opens without override.
    await setStatus('MARK_ENTRY').expect(200);
    await setStatus('PROCESSING').expect(200);
  });

  it('freezes the exam shape once mark entry has opened', async () => {
    await server()
      .put(`/api/v1/exams/${examId}/classes`)
      .set(auth(adminToken))
      .send({ classIds: [classA] })
      .expect(409);
  });

  /**
   * **Changed by Module 15.** This suite used to walk straight to
   * PUBLISHED, because `EXAM_RESULT_GATE` shipped as a no-op that
   * allowed it — the behaviour M14's own docs flagged as temporary
   * ("M15 must bind it, or results can be published before they are
   * processed"). M15 bound the real gate, so an exam with no processed
   * results is now refused here. Publication end-to-end, and the
   * grade-scale freeze (which M15 moved to first PROCESSING so results
   * are graded through the scale that gets published), are covered by
   * `result.e2e-spec.ts`.
   */
  it('refuses PUBLISHED until Module 15 has processed results', async () => {
    const res = await setStatus('PUBLISHED').expect(409);
    expect(JSON.stringify(res.body)).toMatch(/no results have been processed/i);

    const row = await prisma.exam.findUnique({
      where: { id: examId },
      select: { status: true, resultPublishAt: true },
    });
    expect(row?.status).toBe('PROCESSING');
    expect(row?.resultPublishAt).toBeNull();
  });

  it('refuses a multi-step rewind', async () => {
    // One step back is legal (PROCESSING → MARK_ENTRY); jumping three is
    // not, which is what makes the machine a line rather than a graph.
    await setStatus('SCHEDULED').expect(400);
  });

  it('freezes the papers hard once the exam is ARCHIVED', async () => {
    await setStatus('ARCHIVED').expect(200);
    await putSubjects(canonicalRows()).expect(409);
  });

  it('refuses to delete a non-DRAFT exam', async () => {
    await server()
      .delete(`/api/v1/exams/${examId}`)
      .set(auth(adminToken))
      .expect(409);
  });

  // ── the hand-written DB constraints ─────────────────────────────────
  //
  // These bypass the service on purpose: the migration's CHECK
  // constraints are the last line of defence if a future caller skips
  // the engine, and they can only be proven against a real database.

  describe('migration constraints', () => {
    it('rejects a component split that does not sum to full marks', async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO exam_subjects
             (school_id, exam_id, class_id, subject_id, full_marks, pass_marks, cq_marks, mcq_marks, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 100, 33, 70, 20, now())`,
          DEFAULT_SCHOOL_ID,
          examId,
          classB,
          subject2,
        ),
      ).rejects.toThrow(/chk_exam_subjects_components/);
    });

    it('rejects a component pass threshold without its component', async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO exam_subjects
             (school_id, exam_id, class_id, subject_id, full_marks, pass_marks, practical_pass_marks, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 100, 33, 10, now())`,
          DEFAULT_SCHOOL_ID,
          examId,
          classB,
          subject2,
        ),
      ).rejects.toThrow(/chk_exam_subjects_component_pass/);
    });

    it('rejects an exam whose end date precedes its start date', async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE exams SET end_date = start_date - INTERVAL '5 days' WHERE id = $1::uuid`,
          examId,
        ),
      ).rejects.toThrow(/chk_exams_date_order/);
    });

    it('rejects a seat plan with a non-positive capacity', async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO seat_plans (school_id, exam_id, room, date, capacity, updated_at)
           VALUES ($1::uuid, $2::uuid, 'BAD', $3::date, 0, now())`,
          DEFAULT_SCHOOL_ID,
          examId,
          D1,
        ),
      ).rejects.toThrow(/chk_seat_plans_capacity/);
    });
  });
});
