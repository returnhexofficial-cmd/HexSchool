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
import { AssignmentRemindersJob } from '../src/modules/assignment/jobs/assignment-reminders.job';
import {
  seedSystemRoles,
  syncPermissionRegistry,
} from '../src/modules/rbac/seed/rbac.seeder';

/**
 * Requires dev infra (DB + redis). Module 22 — Assignments & Homework.
 *
 * The suite is built around the two things unit tests structurally cannot
 * see (roadmap §9):
 *
 *   1. **The publish → notify → submit → evaluate cycle** end to end,
 *      through the real DI graph, the real CHECK constraints and the real
 *      notification pipeline.
 *   2. **IDOR on submissions.** The module has two independent
 *      authorization models meeting in one place — teacher scoping by
 *      `teacher_section_subjects`, and portal scoping by ownership — so
 *      the matrix is: teacher B may not read teacher A's section, a
 *      student may not read or submit for another student, and a **parent
 *      may not submit at all**.
 */
describe('Assignments & Homework (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-asg-admin@test.local';
  const TEACHER_A = 'e2e-asg-teacherA@test.local';
  const TEACHER_B = 'e2e-asg-teacherB@test.local';
  const STUDENT_A = 'e2e-asg-studentA@test.local';
  const STUDENT_B = 'e2e-asg-studentB@test.local';
  const PARENT = 'e2e-asg-parent@test.local';
  const NAME = 'E2EASG';

  let adminToken: string;
  let teacherAToken: string;
  let teacherBToken: string;
  let studentAToken: string;
  let studentBToken: string;
  let parentToken: string;

  let sessionId: string;
  let classId: string;
  let sectionId: string;
  let otherSectionId: string;
  let subjectId: string;
  let otherSubjectId: string;
  let teacherAId: string;
  let enrollmentAId: string;
  let previousCurrentSessionId: string | null = null;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;

  const emails = [ADMIN, TEACHER_A, TEACHER_B, STUDENT_A, STUDENT_B, PARENT];

  const future = (hours: number) =>
    new Date(Date.now() + hours * 3_600_000).toISOString();

  /** Creates a DRAFT assignment as teacher A and returns its id. */
  const draft = async (
    over: Record<string, unknown> = {},
  ): Promise<{ id: string }> => {
    const res = await server()
      .post('/api/v1/assignments')
      .set(auth(teacherAToken))
      .send({
        sessionId,
        sectionId,
        subjectId,
        title: `${NAME} Newton's laws`,
        instructions: '<p>Read chapter 4.</p>',
        dueAt: future(48),
        fullMarks: 20,
        ...over,
      })
      .expect(201);
    return dataOf<{ id: string }>(res);
  };

  const cleanup = async () => {
    await prisma.assignmentSubmission.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        assignment: { title: { contains: NAME } },
      },
    });
    await prisma.assignment.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, title: { contains: NAME } },
    });
    await prisma.learningMaterial.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, title: { contains: NAME } },
    });
    await prisma.notification.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        templateCode: { startsWith: 'ASSIGNMENT_' },
      },
    });
    await prisma.teacherSectionSubject.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, teacher: { firstName: NAME } },
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
    await prisma.section.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        class: { name: { startsWith: `${NAME}Class` } },
      },
    });
    await prisma.academicSession.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: { startsWith: `${NAME}-SESSION` },
      },
    });
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
        name: { startsWith: `${NAME}Class` },
      },
    });
    await prisma.subject.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: { startsWith: `${NAME}Subject` },
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
    const [
      adminUser,
      teacherAUser,
      teacherBUser,
      studentAUser,
      studentBUser,
      parentUser,
    ] = await Promise.all([
      mk(ADMIN, UserType.ADMIN),
      mk(TEACHER_A, UserType.TEACHER),
      mk(TEACHER_B, UserType.TEACHER),
      mk(STUDENT_A, UserType.STUDENT),
      mk(STUDENT_B, UserType.STUDENT),
      mk(PARENT, UserType.PARENT),
    ]);

    const roleFor = async (slug: string) =>
      prisma.role.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, slug, deletedAt: null },
      });
    const adminRole = await roleFor('admin');
    const teacherRole = await roleFor('teacher');
    await prisma.userRole.createMany({
      data: [
        { userId: adminUser.id, roleId: adminRole!.id },
        { userId: teacherAUser.id, roleId: teacherRole!.id },
        { userId: teacherBUser.id, roleId: teacherRole!.id },
      ],
    });

    // A current session — the portal reads resolve through `getCurrent`.
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
        name: `${NAME}-SESSION ${new Date().getUTCFullYear()}`,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        status: 'ACTIVE',
        isCurrent: true,
      },
    });
    sessionId = session.id;

    const klass = await prisma.schoolClass.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `${NAME}ClassEight`,
        numericLevel: 8,
      },
    });
    classId = klass.id;

    const [section, otherSection] = await Promise.all([
      prisma.section.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          classId: klass.id,
          sessionId: session.id,
          name: 'A',
        },
      }),
      prisma.section.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          classId: klass.id,
          sessionId: session.id,
          name: 'B',
        },
      }),
    ]);
    sectionId = section.id;
    otherSectionId = otherSection.id;

    const [subject, otherSubject] = await Promise.all([
      prisma.subject.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          name: `${NAME}SubjectPhysics`,
          code: `${NAME}-PHY`,
        },
      }),
      prisma.subject.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          name: `${NAME}SubjectBangla`,
          code: `${NAME}-BAN`,
        },
      }),
    ]);
    subjectId = subject.id;
    otherSubjectId = otherSubject.id;

    const [teacherA, teacherB] = await Promise.all([
      prisma.teacher.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          userId: teacherAUser.id,
          employeeId: `${NAME}-TA-${Date.now()}`,
          firstName: NAME,
          lastName: 'TeacherA',
          gender: 'MALE',
          dob: new Date('1990-01-01'),
          designation: 'ASSISTANT_TEACHER',
          joiningDate: new Date('2026-01-01'),
          status: 'ACTIVE',
        },
      }),
      prisma.teacher.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          userId: teacherBUser.id,
          employeeId: `${NAME}-TB-${Date.now()}`,
          firstName: NAME,
          lastName: 'TeacherB',
          gender: 'FEMALE',
          dob: new Date('1991-01-01'),
          designation: 'ASSISTANT_TEACHER',
          joiningDate: new Date('2026-01-01'),
          status: 'ACTIVE',
        },
      }),
    ]);
    teacherAId = teacherA.id;

    // Teacher A holds section A × physics. Teacher B holds section B ×
    // physics — same subject, different section, which is precisely the
    // pair the IDOR cases turn on.
    await prisma.teacherSectionSubject.createMany({
      data: [
        {
          schoolId: DEFAULT_SCHOOL_ID,
          sessionId: session.id,
          sectionId: section.id,
          subjectId: subject.id,
          teacherId: teacherA.id,
        },
        {
          schoolId: DEFAULT_SCHOOL_ID,
          sessionId: session.id,
          sectionId: otherSection.id,
          subjectId: subject.id,
          teacherId: teacherB.id,
        },
      ],
    });

    const mkStudent = async (
      last: string,
      userId: string | null,
      roll: number,
      targetSectionId: string,
    ) => {
      const student = await prisma.student.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          userId,
          studentUid: `${NAME}-${last}-${Date.now()}`,
          firstName: NAME,
          lastName: last,
          gender: 'MALE',
          dob: new Date('2013-01-01'),
          admissionDate: new Date('2026-01-02'),
          admissionClassId: klass.id,
          qrToken: randomUUID(),
        },
      });
      const enrollment = await prisma.enrollment.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          studentId: student.id,
          sessionId: session.id,
          classId: klass.id,
          sectionId: targetSectionId,
          rollNo: roll,
          enrollmentDate: new Date('2026-01-02'),
          status: 'ACTIVE',
        },
      });
      return { student, enrollment };
    };

    const alpha = await mkStudent('Alpha', studentAUser.id, 1, section.id);
    const bravo = await mkStudent('Bravo', studentBUser.id, 2, otherSection.id);
    enrollmentAId = alpha.enrollment.id;

    // A guardian for Alpha, so the parent cases have somebody to be.
    const guardian = await prisma.guardian.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        userId: parentUser.id,
        name: `${NAME} Parent`,
        phone: '01990002222',
      },
    });
    await prisma.studentGuardian.create({
      data: {
        studentId: alpha.student.id,
        guardianId: guardian.id,
        isPrimary: true,
      },
    });
    void bravo;

    const login = async (identifier: string) => {
      const res = await server()
        .post('/api/v1/auth/login')
        .send({ identifier, password: PASSWORD })
        .expect(200);
      return dataOf<{ accessToken: string }>(res).accessToken;
    };
    adminToken = await login(ADMIN);
    teacherAToken = await login(TEACHER_A);
    teacherBToken = await login(TEACHER_B);
    studentAToken = await login(STUDENT_A);
    studentBToken = await login(STUDENT_B);
    parentToken = await login(PARENT);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  // ── teacher scoping (roadmap §6) ──────────────────────────────────────

  describe('teacher scoping', () => {
    it('lets a teacher create work for a section-subject they hold', async () => {
      const created = await draft();
      expect(created).toMatchObject({ status: 'DRAFT' });
    });

    it('refuses a section the teacher does not teach', async () => {
      await server()
        .post('/api/v1/assignments')
        .set(auth(teacherAToken))
        .send({
          sessionId,
          sectionId: otherSectionId,
          subjectId,
          title: `${NAME} not mine`,
          dueAt: future(24),
        })
        .expect(403);
    });

    it('refuses a subject the teacher does not teach in their own section', async () => {
      await server()
        .post('/api/v1/assignments')
        .set(auth(teacherAToken))
        .send({
          sessionId,
          sectionId,
          subjectId: otherSubjectId,
          title: `${NAME} wrong subject`,
          dueAt: future(24),
        })
        .expect(403);
    });

    it('refuses a teacher naming a colleague as the author', async () => {
      await server()
        .post('/api/v1/assignments')
        .set(auth(teacherAToken))
        .send({
          sessionId,
          sectionId,
          subjectId,
          teacherId: randomUUID(),
          title: `${NAME} impersonation`,
          dueAt: future(24),
        })
        .expect(403);
    });

    it('lets an admin (assignment.all) file on a teacher’s behalf', async () => {
      const res = await server()
        .post('/api/v1/assignments')
        .set(auth(adminToken))
        .send({
          sessionId,
          sectionId,
          subjectId,
          teacherId: teacherAId,
          title: `${NAME} filed by office`,
          dueAt: future(24),
        })
        .expect(201);
      expect(dataOf<{ teacherId: string }>(res).teacherId).toBe(teacherAId);
    });

    it('keeps teacher B out of teacher A’s assignment', async () => {
      const created = await draft();
      await server()
        .get(`/api/v1/assignments/${created.id}`)
        .set(auth(teacherBToken))
        .expect(403);
    });

    it('excludes other sections from a teacher’s own list', async () => {
      const res = await server()
        .get('/api/v1/assignments')
        .set(auth(teacherBToken))
        .expect(200);
      const rows = (res.body as { data: Array<{ sectionId: string }> }).data;
      expect(rows.every((r) => r.sectionId === otherSectionId)).toBe(true);
    });

    it('refuses a student the assignments API entirely', async () => {
      await server()
        .get('/api/v1/assignments')
        .set(auth(studentAToken))
        .expect(403);
    });
  });

  // ── validation (roadmap §7) ───────────────────────────────────────────

  describe('validation', () => {
    it('refuses a due date before the work is set', async () => {
      await server()
        .post('/api/v1/assignments')
        .set(auth(teacherAToken))
        .send({
          sessionId,
          sectionId,
          subjectId,
          title: `${NAME} backwards`,
          assignedAt: future(48),
          dueAt: future(24),
        })
        .expect(400);
    });

    it('refuses a title over 200 characters', async () => {
      await server()
        .post('/api/v1/assignments')
        .set(auth(teacherAToken))
        .send({
          sessionId,
          sectionId,
          subjectId,
          title: `${NAME}${'x'.repeat(220)}`,
          dueAt: future(24),
        })
        .expect(400);
    });

    it('refuses full marks of zero', async () => {
      await server()
        .post('/api/v1/assignments')
        .set(auth(teacherAToken))
        .send({
          sessionId,
          sectionId,
          subjectId,
          title: `${NAME} zero marks`,
          dueAt: future(24),
          fullMarks: 0,
        })
        .expect(400);
    });

    it('sanitizes author markup on WRITE, so the stored row is safe', async () => {
      const created = await server()
        .post('/api/v1/assignments')
        .set(auth(teacherAToken))
        .send({
          sessionId,
          sectionId,
          subjectId,
          title: `${NAME} xss`,
          instructions:
            '<p>Read this</p><script>alert(1)</script><a href="javascript:alert(2)">x</a>',
          dueAt: future(24),
        })
        .expect(201);

      const row = await prisma.assignment.findUnique({
        where: { id: dataOf<{ id: string }>(created).id },
        select: { instructions: true },
      });
      expect(row!.instructions).not.toContain('script');
      expect(row!.instructions).not.toContain('javascript:');
      expect(row!.instructions).toContain('Read this');
    });
  });

  // ── the lifecycle ─────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('refuses publishing work that is already overdue', async () => {
      const created = await draft({ dueAt: future(1) });
      // `chk_assignments_window` refuses due <= assigned, so the whole
      // window moves into the past — which is what an overdue draft is.
      await prisma.assignment.update({
        where: { id: created.id },
        data: {
          assignedAt: new Date(Date.now() - 2 * 3_600_000),
          dueAt: new Date(Date.now() - 3_600_000),
        },
      });
      await server()
        .post(`/api/v1/assignments/${created.id}/publish`)
        .set(auth(teacherAToken))
        .expect(409);
    });

    it('publishes, stamps published_at, and refuses a second publish', async () => {
      const created = await draft();
      const published = await server()
        .post(`/api/v1/assignments/${created.id}/publish`)
        .set(auth(teacherAToken))
        .expect(201);
      expect(
        dataOf<{ status: string; publishedAt: string }>(published),
      ).toMatchObject({ status: 'PUBLISHED' });
      expect(
        dataOf<{ publishedAt: string | null }>(published).publishedAt,
      ).not.toBeNull();

      await server()
        .post(`/api/v1/assignments/${created.id}/publish`)
        .set(auth(teacherAToken))
        .expect(409);
    });

    it('notifies the section’s student and guardian on publish', async () => {
      const created = await draft({ title: `${NAME} notify me` });
      await server()
        .post(`/api/v1/assignments/${created.id}/publish`)
        .set(auth(teacherAToken))
        .expect(201);

      const notes = await prisma.notification.findMany({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          templateCode: 'ASSIGNMENT_NEW',
          bodyRendered: { contains: 'notify me' },
        },
        select: { recipientType: true, channel: true },
      });
      // Alpha's own account + Alpha's primary guardian. Bravo is in the
      // other section and must not be reached.
      expect(notes).toHaveLength(2);
      expect(notes.every((n) => n.channel === 'IN_APP')).toBe(true);
      expect(notes.map((n) => n.recipientType).sort()).toEqual([
        'GUARDIAN',
        'STUDENT',
      ]);
    });

    it('closes, refuses editing while closed, then reopens (one step back)', async () => {
      const created = await draft();
      await server()
        .post(`/api/v1/assignments/${created.id}/publish`)
        .set(auth(teacherAToken))
        .expect(201);
      await server()
        .post(`/api/v1/assignments/${created.id}/close`)
        .set(auth(teacherAToken))
        .expect(201);
      await server()
        .patch(`/api/v1/assignments/${created.id}`)
        .set(auth(teacherAToken))
        .send({ title: `${NAME} renamed` })
        .expect(409);

      const reopened = await server()
        .post(`/api/v1/assignments/${created.id}/reopen`)
        .set(auth(teacherAToken))
        .expect(201);
      expect(
        dataOf<{ status: string; closedAt: string | null }>(reopened),
      ).toMatchObject({ status: 'PUBLISHED', closedAt: null });
    });

    it('refuses closing something that was never published', async () => {
      const created = await draft();
      await server()
        .post(`/api/v1/assignments/${created.id}/close`)
        .set(auth(teacherAToken))
        .expect(409);
    });

    it('deletes a draft nobody has submitted to', async () => {
      const created = await draft();
      await server()
        .delete(`/api/v1/assignments/${created.id}`)
        .set(auth(teacherAToken))
        .expect(204);
    });
  });

  // ── the full cycle: publish → submit → evaluate ───────────────────────

  describe('publish → submit → evaluate', () => {
    let assignmentId: string;

    beforeAll(async () => {
      const created = await draft({ title: `${NAME} cycle` });
      assignmentId = created.id;
      await server()
        .post(`/api/v1/assignments/${assignmentId}/publish`)
        .set(auth(teacherAToken))
        .expect(201);
    });

    it('shows the published work in the student’s portal', async () => {
      const res = await server()
        .get('/api/v1/portal/assignments')
        .set(auth(studentAToken))
        .expect(200);
      const body = dataOf<{
        assignments: Array<{ id: string; canSubmit: boolean }>;
        summary: { pending: number };
      }>(res);
      const mine = body.assignments.find((a) => a.id === assignmentId);
      expect(mine).toMatchObject({ canSubmit: true });
      expect(body.summary.pending).toBeGreaterThan(0);
    });

    it('hides a DRAFT from the student portal entirely', async () => {
      const hidden = await draft({ title: `${NAME} secret draft` });
      const res = await server()
        .get('/api/v1/portal/assignments')
        .set(auth(studentAToken))
        .expect(200);
      const ids = dataOf<{ assignments: Array<{ id: string }> }>(
        res,
      ).assignments.map((a) => a.id);
      expect(ids).not.toContain(hidden.id);

      // And a direct read is the same 404 a non-existent id gets.
      await server()
        .get(`/api/v1/portal/assignments/${hidden.id}`)
        .set(auth(studentAToken))
        .expect(404);
    });

    it('refuses an empty submission', async () => {
      await server()
        .post(`/api/v1/portal/assignments/${assignmentId}/submit`)
        .set(auth(studentAToken))
        .send({})
        .expect(400);
    });

    it('accepts a text submission, on time and not late', async () => {
      const res = await server()
        .post(`/api/v1/portal/assignments/${assignmentId}/submit`)
        .set(auth(studentAToken))
        .send({ textAnswer: 'F equals m a' })
        .expect(201);
      expect(
        dataOf<{ isLate: boolean; attempt: number; status: string }>(res),
      ).toMatchObject({ isLate: false, attempt: 1, status: 'SUBMITTED' });
    });

    it('replaces the row on resubmission and bumps the attempt', async () => {
      const res = await server()
        .post(`/api/v1/portal/assignments/${assignmentId}/submit`)
        .set(auth(studentAToken))
        .send({ textAnswer: 'F = ma, corrected' })
        .expect(201);
      expect(dataOf<{ attempt: number; status: string }>(res)).toMatchObject({
        attempt: 2,
        status: 'RESUBMITTED',
      });

      const rows = await prisma.assignmentSubmission.count({
        where: { assignmentId },
      });
      expect(rows).toBe(1);
    });

    it('reports the submission percentage over the section roster', async () => {
      const res = await server()
        .get(`/api/v1/assignments/${assignmentId}/stats`)
        .set(auth(teacherAToken))
        .expect(200);
      expect(
        dataOf<{ expected: number; submitted: number; submissionRate: number }>(
          res,
        ),
      ).toMatchObject({ expected: 1, submitted: 1, submissionRate: 100 });
    });

    it('refuses a mark above full marks, naming the cell', async () => {
      const grid = await server()
        .get(`/api/v1/assignments/${assignmentId}/submissions`)
        .set(auth(teacherAToken))
        .expect(200);
      const submissionId = dataOf<{
        rows: Array<{ submission: { id: string } | null }>;
      }>(grid).rows.find((r) => r.submission)!.submission!.id;

      const res = await server()
        .put(`/api/v1/submissions/${submissionId}/evaluate`)
        .set(auth(teacherAToken))
        .send({ marks: 99 })
        .expect(400);
      expect(JSON.stringify(res.body)).toMatch(/exceed the full marks/i);
    });

    it('records a mark and feedback', async () => {
      const grid = await server()
        .get(`/api/v1/assignments/${assignmentId}/submissions`)
        .set(auth(teacherAToken))
        .expect(200);
      const submissionId = dataOf<{
        rows: Array<{ submission: { id: string } | null }>;
      }>(grid).rows.find((r) => r.submission)!.submission!.id;

      const res = await server()
        .put(`/api/v1/submissions/${submissionId}/evaluate`)
        .set(auth(teacherAToken))
        .send({ marks: 17.5, feedback: 'Good, watch the units.' })
        .expect(200);
      expect(dataOf<{ status: string; marks: string }>(res)).toMatchObject({
        status: 'EVALUATED',
      });
      expect(Number(dataOf<{ marks: string }>(res).marks)).toBe(17.5);
    });

    it('refuses a student overwriting an evaluated submission', async () => {
      await server()
        .post(`/api/v1/portal/assignments/${assignmentId}/submit`)
        .set(auth(studentAToken))
        .send({ textAnswer: 'let me try again' })
        .expect(409);
    });

    it('refuses lowering full marks below a mark already given', async () => {
      await server()
        .patch(`/api/v1/assignments/${assignmentId}`)
        .set(auth(teacherAToken))
        .send({ fullMarks: 10 })
        .expect(409);
    });

    it('returns the work for revision, clearing the mark, and lets the student resubmit', async () => {
      const grid = await server()
        .get(`/api/v1/assignments/${assignmentId}/submissions`)
        .set(auth(teacherAToken))
        .expect(200);
      const submissionId = dataOf<{
        rows: Array<{ submission: { id: string } | null }>;
      }>(grid).rows.find((r) => r.submission)!.submission!.id;

      // Feedback is mandatory on a return.
      await server()
        .put(`/api/v1/submissions/${submissionId}/return`)
        .set(auth(teacherAToken))
        .send({ feedback: '' })
        .expect(400);

      const returned = await server()
        .put(`/api/v1/submissions/${submissionId}/return`)
        .set(auth(teacherAToken))
        .send({ feedback: 'Show your working for part (b).' })
        .expect(200);
      expect(
        dataOf<{ status: string; marks: string | null }>(returned),
      ).toMatchObject({ status: 'RETURNED', marks: null });

      // A RETURNED submission is pending again for the student.
      await server()
        .post(`/api/v1/portal/assignments/${assignmentId}/submit`)
        .set(auth(studentAToken))
        .send({ textAnswer: 'With working shown.' })
        .expect(201);
    });

    it('refuses submissions once the assignment is closed', async () => {
      await server()
        .post(`/api/v1/assignments/${assignmentId}/close`)
        .set(auth(teacherAToken))
        .expect(201);
      await server()
        .post(`/api/v1/portal/assignments/${assignmentId}/submit`)
        .set(auth(studentAToken))
        .send({ textAnswer: 'too late' })
        .expect(409);
    });

    it('locks evaluation once closed, and the override unlocks it', async () => {
      const grid = await server()
        .get(`/api/v1/assignments/${assignmentId}/submissions`)
        .set(auth(teacherAToken))
        .expect(200);
      const submissionId = dataOf<{
        rows: Array<{ submission: { id: string } | null }>;
      }>(grid).rows.find((r) => r.submission)!.submission!.id;

      // The Teacher baseline deliberately excludes
      // `assignment.evaluate.override`.
      const refused = await server()
        .put(`/api/v1/submissions/${submissionId}/evaluate`)
        .set(auth(teacherAToken))
        .send({ marks: 15 })
        .expect(400);
      expect(JSON.stringify(refused.body)).toMatch(/closed/i);

      // The admin holds it.
      await server()
        .put(`/api/v1/submissions/${submissionId}/evaluate`)
        .set(auth(adminToken))
        .send({ marks: 15 })
        .expect(200);
    });

    it('refuses deleting an assignment once work has been handed in', async () => {
      await server()
        .delete(`/api/v1/assignments/${assignmentId}`)
        .set(auth(teacherAToken))
        .expect(409);
    });
  });

  // ── the bulk grid ─────────────────────────────────────────────────────

  describe('bulk evaluation', () => {
    it('writes nothing when one cell in the batch is invalid', async () => {
      const created = await draft({ title: `${NAME} bulk` });
      await server()
        .post(`/api/v1/assignments/${created.id}/publish`)
        .set(auth(teacherAToken))
        .expect(201);
      await server()
        .post(`/api/v1/portal/assignments/${created.id}/submit`)
        .set(auth(studentAToken))
        .send({ textAnswer: 'bulk answer' })
        .expect(201);

      const grid = await server()
        .get(`/api/v1/assignments/${created.id}/submissions`)
        .set(auth(teacherAToken))
        .expect(200);
      const submissionId = dataOf<{
        rows: Array<{ submission: { id: string } | null }>;
      }>(grid).rows.find((r) => r.submission)!.submission!.id;

      await server()
        .put(`/api/v1/assignments/${created.id}/evaluate`)
        .set(auth(teacherAToken))
        .send({ rows: [{ submissionId, marks: 999 }] })
        .expect(400);

      const row = await prisma.assignmentSubmission.findUnique({
        where: { id: submissionId },
        select: { marks: true, status: true },
      });
      expect(row).toMatchObject({ marks: null, status: 'SUBMITTED' });

      const ok = await server()
        .put(`/api/v1/assignments/${created.id}/evaluate`)
        .set(auth(teacherAToken))
        .send({ rows: [{ submissionId, marks: 12 }] })
        .expect(200);
      expect(dataOf<{ updated: number }>(ok)).toEqual({ updated: 1 });
    });

    it('refuses a submission id from another assignment in the payload', async () => {
      const [one, two] = await Promise.all([
        draft({ title: `${NAME} bulkA` }),
        draft({ title: `${NAME} bulkB` }),
      ]);
      for (const a of [one, two]) {
        await server()
          .post(`/api/v1/assignments/${a.id}/publish`)
          .set(auth(teacherAToken))
          .expect(201);
      }
      await server()
        .post(`/api/v1/portal/assignments/${two.id}/submit`)
        .set(auth(studentAToken))
        .send({ textAnswer: 'in B' })
        .expect(201);

      const grid = await server()
        .get(`/api/v1/assignments/${two.id}/submissions`)
        .set(auth(teacherAToken))
        .expect(200);
      const foreignId = dataOf<{
        rows: Array<{ submission: { id: string } | null }>;
      }>(grid).rows.find((r) => r.submission)!.submission!.id;

      const res = await server()
        .put(`/api/v1/assignments/${one.id}/evaluate`)
        .set(auth(teacherAToken))
        .send({ rows: [{ submissionId: foreignId, marks: 5 }] })
        .expect(400);
      expect(JSON.stringify(res.body)).toMatch(/does not belong/i);
    });
  });

  // ── IDOR (roadmap §9) ────────────────────────────────────────────────

  describe('IDOR', () => {
    let assignmentId: string;
    let submissionId: string;

    beforeAll(async () => {
      const created = await draft({ title: `${NAME} idor` });
      assignmentId = created.id;
      await server()
        .post(`/api/v1/assignments/${assignmentId}/publish`)
        .set(auth(teacherAToken))
        .expect(201);
      const submitted = await server()
        .post(`/api/v1/portal/assignments/${assignmentId}/submit`)
        .set(auth(studentAToken))
        .send({ textAnswer: 'mine' })
        .expect(201);
      submissionId = dataOf<{ id: string }>(submitted).id;
    });

    it('refuses teacher B reading a submission in teacher A’s section', async () => {
      await server()
        .get(`/api/v1/submissions/${submissionId}`)
        .set(auth(teacherBToken))
        .expect(403);
    });

    it('refuses teacher B evaluating a submission in teacher A’s section', async () => {
      await server()
        .put(`/api/v1/submissions/${submissionId}/evaluate`)
        .set(auth(teacherBToken))
        .send({ marks: 20 })
        .expect(403);
    });

    it('refuses teacher B the submission grid of teacher A’s assignment', async () => {
      await server()
        .get(`/api/v1/assignments/${assignmentId}/submissions`)
        .set(auth(teacherBToken))
        .expect(403);
    });

    it('refuses a student submitting to another section’s assignment', async () => {
      // Student B is in section B; this assignment belongs to section A,
      // so it is not even visible to them.
      await server()
        .post(`/api/v1/portal/assignments/${assignmentId}/submit`)
        .set(auth(studentBToken))
        .send({ textAnswer: 'not mine' })
        .expect(403);
    });

    it('refuses a student reading another section’s assignment', async () => {
      await server()
        .get(`/api/v1/portal/assignments/${assignmentId}`)
        .set(auth(studentBToken))
        .expect(404);
    });

    it('refuses a PARENT submitting on their own child’s behalf', async () => {
      // The record of who did the work has to mean what it says. A parent
      // resolves to no student profile of their own, so the route 404s
      // before it can even reach the ownership check.
      const res = await server()
        .post(`/api/v1/portal/assignments/${assignmentId}/submit`)
        .set(auth(parentToken))
        .send({ textAnswer: 'I did my child’s homework' });
      expect([403, 404]).toContain(res.status);

      const rows = await prisma.assignmentSubmission.count({
        where: { assignmentId },
      });
      expect(rows).toBe(1);
    });

    it('lets a parent READ their own child’s pending overview', async () => {
      const alpha = await prisma.student.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, lastName: 'Alpha' },
        select: { id: true },
      });
      const res = await server()
        .get(`/api/v1/portal/parent/child/${alpha!.id}/assignments`)
        .set(auth(parentToken))
        .expect(200);
      expect(
        dataOf<{ assignments: unknown[] }>(res).assignments.length,
      ).toBeGreaterThan(0);
    });

    it('refuses a parent reading a stranger’s child', async () => {
      const bravo = await prisma.student.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, lastName: 'Bravo' },
        select: { id: true },
      });
      await server()
        .get(`/api/v1/portal/parent/child/${bravo!.id}/assignments`)
        .set(auth(parentToken))
        .expect(403);
    });
  });

  // ── DB invariants ─────────────────────────────────────────────────────

  describe('database invariants', () => {
    it('chk_assignment_submissions_content refuses an empty submission row', async () => {
      const created = await draft({ title: `${NAME} chk content` });
      await expect(
        prisma.assignmentSubmission.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            assignmentId: created.id,
            enrollmentId: enrollmentAId,
            textAnswer: null,
          },
        }),
      ).rejects.toThrow(/chk_assignment_submissions_content/);
    });

    it('uq_assignment_submissions_identity refuses a second row per candidate', async () => {
      const created = await draft({ title: `${NAME} chk identity` });
      await prisma.assignmentSubmission.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          assignmentId: created.id,
          enrollmentId: enrollmentAId,
          textAnswer: 'first',
        },
      });
      await expect(
        prisma.assignmentSubmission.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            assignmentId: created.id,
            enrollmentId: enrollmentAId,
            textAnswer: 'second',
          },
        }),
      ).rejects.toThrow();
    });

    it('chk_assignment_submissions_evaluation refuses RETURNED with no feedback', async () => {
      const created = await draft({ title: `${NAME} chk return` });
      await expect(
        prisma.assignmentSubmission.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            assignmentId: created.id,
            enrollmentId: enrollmentAId,
            textAnswer: 'x',
            status: 'RETURNED',
            evaluatedAt: new Date(),
            evaluatedBy: randomUUID(),
          },
        }),
      ).rejects.toThrow(/chk_assignment_submissions_evaluation/);
    });

    it('chk_assignments_status_evidence refuses PUBLISHED with no published_at', async () => {
      await expect(
        prisma.assignment.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            sessionId,
            sectionId,
            subjectId,
            teacherId: teacherAId,
            title: `${NAME} chk evidence`,
            dueAt: new Date(Date.now() + 86_400_000),
            status: 'PUBLISHED',
          },
        }),
      ).rejects.toThrow(/chk_assignments_status_evidence/);
    });

    it('chk_assignments_window refuses a due date before the assigned date', async () => {
      await expect(
        prisma.assignment.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            sessionId,
            sectionId,
            subjectId,
            teacherId: teacherAId,
            title: `${NAME} chk window`,
            assignedAt: new Date(Date.now() + 86_400_000),
            dueAt: new Date(),
          },
        }),
      ).rejects.toThrow(/chk_assignments_window/);
    });

    it('chk_learning_materials_link_scheme refuses a non-https link', async () => {
      await expect(
        prisma.learningMaterial.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            sessionId,
            classId,
            subjectId,
            teacherId: teacherAId,
            type: 'LINK',
            title: `${NAME} chk scheme`,
            linkUrl: 'http://youtube.com/watch?v=x',
          },
        }),
      ).rejects.toThrow(/chk_learning_materials_link_scheme/);
    });

    it('chk_learning_materials_payload refuses a material carrying nothing', async () => {
      await expect(
        prisma.learningMaterial.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            sessionId,
            classId,
            subjectId,
            teacherId: teacherAId,
            type: 'NOTE',
            title: `${NAME} chk empty`,
          },
        }),
      ).rejects.toThrow(/chk_learning_materials_payload/);
    });
  });

  // ── learning materials ────────────────────────────────────────────────

  describe('learning materials', () => {
    it('creates a class-wide link material and shows it to the student', async () => {
      const created = await server()
        .post('/api/v1/learning-materials')
        .set(auth(teacherAToken))
        .send({
          sessionId,
          classId,
          subjectId,
          type: 'VIDEO_URL',
          title: `${NAME} class-wide video`,
          linkUrl: 'https://www.youtube.com/watch?v=abc',
        })
        .expect(201);
      expect(
        dataOf<{ sectionId: string | null }>(created).sectionId,
      ).toBeNull();

      const res = await server()
        .get('/api/v1/portal/materials')
        .set(auth(studentAToken))
        .expect(200);
      const titles = dataOf<Array<{ title: string }>>(res).map((m) => m.title);
      expect(titles).toContain(`${NAME} class-wide video`);
    });

    it('refuses a link host outside the allow-list', async () => {
      const res = await server()
        .post('/api/v1/learning-materials')
        .set(auth(teacherAToken))
        .send({
          sessionId,
          classId,
          subjectId,
          type: 'LINK',
          title: `${NAME} bad host`,
          linkUrl: 'https://youtube.com.evil.test/x',
        })
        .expect(400);
      expect(JSON.stringify(res.body)).toMatch(/not an allowed link host/i);
    });

    it('refuses http even for an allow-listed host', async () => {
      await server()
        .post('/api/v1/learning-materials')
        .set(auth(teacherAToken))
        .send({
          sessionId,
          classId,
          subjectId,
          type: 'LINK',
          title: `${NAME} insecure`,
          linkUrl: 'http://youtube.com/x',
        })
        .expect(400);
    });

    it('refuses a NOTE with neither a file nor a link', async () => {
      await server()
        .post('/api/v1/learning-materials')
        .set(auth(teacherAToken))
        .send({
          sessionId,
          classId,
          subjectId,
          type: 'NOTE',
          title: `${NAME} nothing at all`,
        })
        .expect(400);
    });

    it('keeps a section-specific material out of another section’s library', async () => {
      await server()
        .post('/api/v1/learning-materials')
        .set(auth(teacherAToken))
        .send({
          sessionId,
          classId,
          sectionId,
          subjectId,
          type: 'LINK',
          title: `${NAME} section A only`,
          linkUrl: 'https://drive.google.com/file/abc',
        })
        .expect(201);

      const mine = await server()
        .get('/api/v1/portal/materials')
        .set(auth(studentAToken))
        .expect(200);
      expect(
        dataOf<Array<{ title: string }>>(mine).map((m) => m.title),
      ).toContain(`${NAME} section A only`);

      const theirs = await server()
        .get('/api/v1/portal/materials')
        .set(auth(studentBToken))
        .expect(200);
      expect(
        dataOf<Array<{ title: string }>>(theirs).map((m) => m.title),
      ).not.toContain(`${NAME} section A only`);
    });

    it('refuses a teacher filing a material for a subject they do not teach', async () => {
      await server()
        .post('/api/v1/learning-materials')
        .set(auth(teacherAToken))
        .send({
          sessionId,
          classId,
          sectionId,
          subjectId: otherSubjectId,
          type: 'LINK',
          title: `${NAME} wrong subject material`,
          linkUrl: 'https://drive.google.com/file/xyz',
        })
        .expect(403);
    });

    it('refuses a student the admin materials API', async () => {
      await server()
        .get('/api/v1/learning-materials')
        .set(auth(studentAToken))
        .expect(403);
    });
  });

  // ── exports ──────────────────────────────────────────────────────────

  describe('exports', () => {
    it('builds a real zip of the text submissions', async () => {
      const created = await draft({ title: `${NAME} zip me` });
      await server()
        .post(`/api/v1/assignments/${created.id}/publish`)
        .set(auth(teacherAToken))
        .expect(201);
      await server()
        .post(`/api/v1/portal/assignments/${created.id}/submit`)
        .set(auth(studentAToken))
        .send({ textAnswer: 'zipped answer' })
        .expect(201);

      const res = await server()
        .get(`/api/v1/assignments/${created.id}/export/submissions.zip`)
        .set(auth(teacherAToken))
        .buffer()
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (c: Buffer) => chunks.push(c));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      const zip = res.body as Buffer;
      // Local file header signature, and the payload is really in there.
      expect(zip.readUInt32LE(0)).toBe(0x04034b50);
      expect(zip.toString('utf8')).toContain('zipped answer');
      expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    });

    it('emits the marks sheet as XLSX', async () => {
      const created = await draft({ title: `${NAME} xlsx me` });
      const res = await server()
        .get(`/api/v1/assignments/${created.id}/export/marks.xlsx`)
        .set(auth(teacherAToken))
        .expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
    });

    it('refuses the export to a caller without assignment.export', async () => {
      const created = await draft({ title: `${NAME} no export` });
      await server()
        .get(`/api/v1/assignments/${created.id}/export/marks.xlsx`)
        .set(auth(studentAToken))
        .expect(403);
    });
  });

  // ── the reminder jobs ────────────────────────────────────────────────

  describe('reminder jobs', () => {
    it('reminds only the candidates who have NOT submitted, once', async () => {
      const job = app.get(AssignmentRemindersJob);

      const created = await draft({
        title: `${NAME} remind me`,
        dueAt: future(12),
      });
      await server()
        .post(`/api/v1/assignments/${created.id}/publish`)
        .set(auth(teacherAToken))
        .expect(201);

      const first = await job.runForSchool(DEFAULT_SCHOOL_ID);
      expect(first.reminded).toBeGreaterThan(0);

      const notes = await prisma.notification.count({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          templateCode: 'ASSIGNMENT_DUE_SOON',
          bodyRendered: { contains: 'remind me' },
        },
      });
      expect(notes).toBe(2); // student + guardian

      // Idempotent: the second run sends nothing for the same assignment.
      await job.runForSchool(DEFAULT_SCHOOL_ID);
      const after = await prisma.notification.count({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          templateCode: 'ASSIGNMENT_DUE_SOON',
          bodyRendered: { contains: 'remind me' },
        },
      });
      expect(after).toBe(2);

      const row = await prisma.assignment.findUnique({
        where: { id: created.id },
        select: { dueReminderSentAt: true },
      });
      expect(row!.dueReminderSentAt).not.toBeNull();
    });

    it('nudges the teacher about an overdue assignment with zero submissions', async () => {
      const job = app.get(AssignmentRemindersJob);

      const created = await draft({ title: `${NAME} nobody submitted` });
      await server()
        .post(`/api/v1/assignments/${created.id}/publish`)
        .set(auth(teacherAToken))
        .expect(201);
      // Back-date the whole window past the nudge cutoff (see above:
      // `chk_assignments_window` will not let due_at cross assigned_at).
      await prisma.assignment.update({
        where: { id: created.id },
        data: {
          assignedAt: new Date(Date.now() - 6 * 86_400_000),
          dueAt: new Date(Date.now() - 5 * 86_400_000),
        },
      });

      const result = await job.runForSchool(DEFAULT_SCHOOL_ID);
      expect(result.nudged).toBeGreaterThan(0);

      const nudge = await prisma.notification.findFirst({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          templateCode: 'ASSIGNMENT_NO_SUBMISSIONS',
          bodyRendered: { contains: 'nobody submitted' },
        },
      });
      expect(nudge).not.toBeNull();

      // It does NOT close the assignment — that is the school's call.
      const row = await prisma.assignment.findUnique({
        where: { id: created.id },
        select: { status: true, noSubmissionAlertAt: true },
      });
      expect(row).toMatchObject({ status: 'PUBLISHED' });
      expect(row!.noSubmissionAlertAt).not.toBeNull();
    });
  });
});
