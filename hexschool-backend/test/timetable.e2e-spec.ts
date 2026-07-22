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
 * Requires dev infra (DB + redis). The whole M13 loop: define a bell
 * schedule, build a draft, have the conflict engine refuse a teacher who
 * is already booked, publish, and confirm the portal read only sees
 * PUBLISHED. Everything is created under distinctive names and removed in
 * afterAll (the session FK cascades take sections, timetables and
 * entries).
 */
describe('Timetable (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-tt-admin@test.local';
  const VIEWER = 'e2e-tt-viewer@test.local';
  const PLAIN = 'e2e-tt-plain@test.local';
  const NAME = 'E2ETT';
  const ROLE_SLUG = 'e2e-tt-viewer';

  let adminToken: string;
  let viewerToken: string;
  let plainToken: string;
  let sessionId: string;
  let classId: string;
  let shiftId: string;
  let subjectId: string;
  const sectionIds: string[] = [];
  const teacherIds: string[] = [];
  const slotIds: string[] = [];

  const YEAR = new Date().getUTCFullYear();

  /**
   * The routine grid is keyed by weekday, so a date-based assertion must
   * pin the weekday rather than trust a hard-coded day of the month —
   * `YEAR` moves and Friday is the default weekly holiday (which
   * short-circuits `current-period` before any slot is resolved).
   */
  const FIRST_SATURDAY = (() => {
    const cursor = new Date(Date.UTC(YEAR, 0, 1));
    while (cursor.getUTCDay() !== 6) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return cursor.toISOString().slice(0, 10);
  })();

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;

  const cleanup = async () => {
    await prisma.academicSession.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E-TT ' } },
    });
    await prisma.periodSlot.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, shift: { name: 'E2E TT Shift' } },
    });
    await prisma.shift.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: 'E2E TT Shift' },
    });
    await prisma.subject.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, code: 'E2ETTSUB' },
    });
    await prisma.schoolClass.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: 'E2E TTClass' },
    });
    const teachers = await prisma.teacher.findMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: NAME },
      select: { id: true, userId: true },
    });
    await prisma.teacher.deleteMany({
      where: { id: { in: teachers.map((t) => t.id) } },
    });
    await prisma.role.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, slug: ROLE_SLUG },
    });
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: { in: [ADMIN, VIEWER, PLAIN] } },
          { id: { in: teachers.map((t) => t.userId) } },
        ],
      },
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
    const [adminUser, viewerUser] = await Promise.all(
      (
        [
          [ADMIN, UserType.ADMIN],
          [VIEWER, UserType.STAFF],
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

    // A viewer who may READ routines but may not build, publish or
    // override — the three permission boundaries this module adds.
    const viewerRole = await prisma.role.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: 'E2E Timetable Viewer',
        slug: ROLE_SLUG,
      },
    });
    const codes = await prisma.permission.findMany({
      where: { code: { in: ['timetable.view', 'structure.view'] } },
      select: { id: true },
    });
    await prisma.rolePermission.createMany({
      data: codes.map((p) => ({ roleId: viewerRole.id, permissionId: p.id })),
    });
    await prisma.userRole.create({
      data: { userId: viewerUser.id, roleId: viewerRole.id },
    });

    const shift = await prisma.shift.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: 'E2E TT Shift',
        startTime: new Date('1970-01-01T08:00:00.000Z'),
        endTime: new Date('1970-01-01T13:00:00.000Z'),
      },
    });
    shiftId = shift.id;

    const klass = await prisma.schoolClass.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: 'E2E TTClass',
        numericLevel: 19,
      },
    });
    classId = klass.id;

    const session = await prisma.academicSession.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `E2E-TT ${YEAR}`,
        startDate: new Date(`${YEAR}-01-01`),
        endDate: new Date(`${YEAR}-12-31`),
        status: 'ACTIVE',
      },
    });
    sessionId = session.id;

    // Two sections in the same shift — the pair the conflict engine needs.
    for (const name of ['T1', 'T2']) {
      const section = await prisma.section.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          classId,
          sessionId,
          shiftId,
          name,
          roomNo: `R-${name}`,
        },
      });
      sectionIds.push(section.id);
    }

    const subject = await prisma.subject.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: 'E2E TT Subject',
        code: 'E2ETTSUB',
      },
    });
    subjectId = subject.id;

    // Curriculum mapping — a routine cell may only use a mapped subject.
    await prisma.classSubject.createMany({
      data: sectionIds.map(() => ({
        schoolId: DEFAULT_SCHOOL_ID,
        classId,
        subjectId,
        sessionId,
      })),
      skipDuplicates: true,
    });

    for (let i = 0; i < 2; i += 1) {
      const teacherUser = await prisma.user.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          email: `e2e-tt-teacher-${i}-${Date.now()}@test.local`,
          passwordHash,
          userType: UserType.TEACHER,
        },
      });
      const teacher = await prisma.teacher.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          userId: teacherUser.id,
          employeeId: `E2E-TT-T${i}-${Date.now()}`,
          firstName: NAME,
          lastName: `Teacher${i}`,
          designation: 'ASSISTANT_TEACHER',
          gender: 'MALE',
          dob: new Date('1990-01-01'),
          joiningDate: new Date(`${YEAR}-01-01`),
        },
      });
      teacherIds.push(teacher.id);
      // Both teachers own their section's slot for the subject, so the
      // assignment rule never fires and conflicts are what is under test.
      await prisma.teacherSectionSubject.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          sessionId,
          sectionId: sectionIds[i],
          subjectId,
          teacherId: teacher.id,
        },
      });
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
    plainToken = await login(PLAIN);
  }, 180_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  }, 120_000);

  // ── period slots ────────────────────────────────────────────────────

  it('is permission-guarded', async () => {
    await server()
      .get('/api/v1/period-slots')
      .set(auth(plainToken))
      .expect(403);
    await server()
      .post('/api/v1/period-slots')
      .set(auth(viewerToken))
      .send({
        shiftId,
        name: 'Sneaky',
        startTime: '08:00',
        endTime: '08:45',
      })
      .expect(403);
  });

  it('builds a bell schedule for the shift', async () => {
    const create = (body: object) =>
      server()
        .post('/api/v1/period-slots')
        .set(auth(adminToken))
        .send({ shiftId, ...body });

    for (const body of [
      { name: 'Period 1', startTime: '08:00', endTime: '08:45' },
      { name: 'Tiffin', startTime: '08:45', endTime: '09:05', type: 'BREAK' },
      { name: 'Period 2', startTime: '09:05', endTime: '09:50' },
    ]) {
      const res = await create(body).expect(201);
      slotIds.push(dataOf<{ id: string }>(res).id);
    }

    const listed = await server()
      .get('/api/v1/period-slots')
      .query({ shiftId })
      .set(auth(viewerToken))
      .expect(200);
    const slots = dataOf<Array<{ name: string; displayOrder: number }>>(listed);
    expect(slots.map((s) => s.name)).toEqual(['Period 1', 'Tiffin', 'Period 2']);
    expect(slots.map((s) => s.displayOrder)).toEqual([1, 2, 3]);
  });

  it('rejects a slot overlapping an existing one, and one outside the shift', async () => {
    const create = (body: object) =>
      server()
        .post('/api/v1/period-slots')
        .set(auth(adminToken))
        .send({ shiftId, ...body });

    await create({
      name: 'Overlapping',
      startTime: '08:30',
      endTime: '09:15',
    }).expect(409);
    await create({
      name: 'After hours',
      startTime: '12:45',
      endTime: '13:30',
    }).expect(400);
    await create({
      name: 'Duplicate name',
      startTime: '10:00',
      endTime: '10:45',
    })
      .send({ shiftId, name: 'Period 1', startTime: '10:00', endTime: '10:45' })
      .expect(409);
  });

  // ── build → conflict → publish ──────────────────────────────────────

  let draftA: string;
  let draftB: string;

  it('creates a draft routine per section', async () => {
    for (const sectionId of sectionIds) {
      const res = await server()
        .post('/api/v1/timetables')
        .set(auth(adminToken))
        .send({ sectionId })
        .expect(201);
      const body = dataOf<{ id: string; status: string }>(res);
      expect(body.status).toBe('DRAFT');
      if (sectionId === sectionIds[0]) draftA = body.id;
      else draftB = body.id;
    }
  });

  it('refuses a second draft for the same section', async () => {
    await server()
      .post('/api/v1/timetables')
      .set(auth(adminToken))
      .send({ sectionId: sectionIds[0] })
      .expect(409);
  });

  it('refuses a lesson in a BREAK slot', async () => {
    await server()
      .put(`/api/v1/timetables/${draftA}/entries`)
      .set(auth(adminToken))
      .send({
        entries: [
          {
            day: 'SAT',
            periodSlotId: slotIds[1],
            subjectId,
            teacherId: teacherIds[0],
          },
        ],
      })
      .expect(400);
  });

  it('saves a valid grid and publishes it', async () => {
    await server()
      .put(`/api/v1/timetables/${draftA}/entries`)
      .set(auth(adminToken))
      .send({
        entries: [
          {
            day: 'SAT',
            periodSlotId: slotIds[0],
            subjectId,
            teacherId: teacherIds[0],
          },
          {
            day: 'SUN',
            periodSlotId: slotIds[2],
            subjectId,
            teacherId: teacherIds[0],
          },
        ],
      })
      .expect(200);

    const res = await server()
      .post(`/api/v1/timetables/${draftA}/publish`)
      .set(auth(adminToken))
      .send({})
      .expect(201);
    const body = dataOf<{ status: string; version: number }>(res);
    expect(body.status).toBe('PUBLISHED');
    expect(body.version).toBe(1);
  });

  it('rejects the whole payload when a teacher is already booked', async () => {
    // Section T2 tries to use T1's teacher in the slot he already teaches.
    const res = await server()
      .put(`/api/v1/timetables/${draftB}/entries`)
      .set(auth(adminToken))
      .send({
        entries: [
          {
            day: 'SAT',
            periodSlotId: slotIds[0],
            subjectId,
            teacherId: teacherIds[0],
          },
        ],
        // Needed because T1's teacher does not hold T2's section-subject;
        // the override excuses THAT, never the double-booking.
        override: true,
      })
      .expect(409);
    // The conflict list travels in the envelope's `details` so the
    // builder can paint the offending cells red.
    const conflicts = (
      res.body as { error: { details: { conflicts: Array<{ kind: string }> } } }
    ).error.details.conflicts;
    expect(conflicts.map((c) => c.kind)).toContain('TEACHER');

    // Nothing was written — the draft stays empty.
    const detail = await server()
      .get(`/api/v1/timetables/${draftB}`)
      .set(auth(adminToken))
      .expect(200);
    expect(dataOf<{ entries: unknown[] }>(detail).entries).toHaveLength(0);
  });

  it('accepts the same slot for a DIFFERENT teacher', async () => {
    await server()
      .put(`/api/v1/timetables/${draftB}/entries`)
      .set(auth(adminToken))
      .send({
        entries: [
          {
            day: 'SAT',
            periodSlotId: slotIds[0],
            subjectId,
            teacherId: teacherIds[1],
          },
        ],
      })
      .expect(200);
  });

  it('refuses to publish an empty routine', async () => {
    const res = await server()
      .post('/api/v1/timetables')
      .set(auth(adminToken))
      .send({ sectionId: sectionIds[0] })
      .expect(201);
    const emptyDraft = dataOf<{ id: string }>(res).id;
    await server()
      .post(`/api/v1/timetables/${emptyDraft}/publish`)
      .set(auth(adminToken))
      .send({})
      .expect(400);
    await server()
      .delete(`/api/v1/timetables/${emptyDraft}`)
      .set(auth(adminToken))
      .expect(204);
  });

  // ── read side ───────────────────────────────────────────────────────

  it('serves the published section routine to a plain viewer', async () => {
    const res = await server()
      .get(`/api/v1/sections/${sectionIds[0]}/routine`)
      .set(auth(viewerToken))
      .expect(200);
    const routine = dataOf<{
      timetable: { status: string } | null;
      cells: unknown[];
      slots: unknown[];
    }>(res);
    expect(routine.timetable?.status).toBe('PUBLISHED');
    expect(routine.cells).toHaveLength(2);
    expect(routine.slots).toHaveLength(3);
  });

  it('hides an unpublished routine from the portal read', async () => {
    // T2's routine is still a draft — the viewer must not see its cells.
    const res = await server()
      .get(`/api/v1/sections/${sectionIds[1]}/routine`)
      .query({ includeDraft: 'true' })
      .set(auth(viewerToken))
      .expect(200);
    const routine = dataOf<{ timetable: unknown; cells: unknown[] }>(res);
    expect(routine.timetable).toBeNull();
    expect(routine.cells).toHaveLength(0);
  });

  it('shows the draft to a builder who asks for it', async () => {
    const res = await server()
      .get(`/api/v1/sections/${sectionIds[1]}/routine`)
      .query({ includeDraft: 'true' })
      .set(auth(adminToken))
      .expect(200);
    expect(
      dataOf<{ timetable: { status: string } }>(res).timetable.status,
    ).toBe('DRAFT');
  });

  it("serves a teacher's own week with periods/week", async () => {
    const res = await server()
      .get(`/api/v1/teachers/${teacherIds[0]}/routine`)
      .query({ sessionId })
      .set(auth(viewerToken))
      .expect(200);
    const routine = dataOf<{ periodsPerWeek: number; cells: unknown[] }>(res);
    expect(routine.periodsPerWeek).toBe(2);
    expect(routine.cells).toHaveLength(2);
  });

  it('answers the conflicts probe used by the cell editor', async () => {
    const busy = await server()
      .get('/api/v1/timetables/conflicts')
      .query({
        sessionId,
        teacherId: teacherIds[0],
        day: 'SAT',
        periodSlotId: slotIds[0],
        sectionId: sectionIds[1],
      })
      .set(auth(adminToken))
      .expect(200);
    expect(dataOf<unknown[]>(busy).length).toBeGreaterThan(0);

    const free = await server()
      .get('/api/v1/timetables/conflicts')
      .query({
        sessionId,
        teacherId: teacherIds[0],
        day: 'MON',
        periodSlotId: slotIds[0],
        sectionId: sectionIds[1],
      })
      .set(auth(adminToken))
      .expect(200);
    expect(dataOf<unknown[]>(free)).toHaveLength(0);
  });

  it('serves the master grid with the teacher load heat view', async () => {
    const res = await server()
      .get('/api/v1/timetables/master')
      .query({ sessionId })
      .set(auth(viewerToken))
      .expect(200);
    const master = dataOf<{
      sections: Array<{ filled: number }>;
      teacherLoad: Array<{ periodsPerWeek: number }>;
    }>(res);
    expect(master.sections.length).toBeGreaterThanOrEqual(2);
    expect(master.teacherLoad[0].periodsPerWeek).toBe(2);
  });

  it('renders a printable routine PDF', async () => {
    const res = await server()
      .get(`/api/v1/sections/${sectionIds[0]}/routine/pdf`)
      .set(auth(adminToken))
      .expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.body.length).toBeGreaterThan(500);
  });

  it('reports the current period for a section', async () => {
    const res = await server()
      .get(`/api/v1/sections/${sectionIds[0]}/current-period`)
      .query({ date: FIRST_SATURDAY, at: '08:20' })
      .set(auth(adminToken))
      .expect(200);
    const current = dataOf<{
      slot: { name: string } | null;
      cell: { subject: { code: string } } | null;
      day: string;
    }>(res);
    expect(current.day).toBe('SAT');
    expect(current.slot?.name).toBe('Period 1');
    // SAT Period 1 is the cell published above.
    expect(current.cell?.subject.code).toBe('E2ETTSUB');
  });

  it('reports no period outside the bell schedule', async () => {
    const res = await server()
      .get(`/api/v1/sections/${sectionIds[0]}/current-period`)
      .query({ date: FIRST_SATURDAY, at: '17:30' })
      .set(auth(adminToken))
      .expect(200);
    expect(dataOf<{ slot: unknown }>(res).slot).toBeNull();
  });

  // ── M08 integration ─────────────────────────────────────────────────

  it('finalizes the teacher workload report with periods/week', async () => {
    const res = await server()
      .get('/api/v1/teacher-assignments/workload')
      .query({ sessionId })
      .set(auth(adminToken))
      .expect(200);
    const rows = dataOf<
      Array<{ teacherId: string; assignments: number; periodsPerWeek: number }>
    >(res);
    const first = rows.find((r) => r.teacherId === teacherIds[0]);
    expect(first).toMatchObject({ assignments: 1, periodsPerWeek: 2 });
  });

  it('blocks a reassignment the published routine cannot accommodate', async () => {
    // Handing T1's subject slot to T2's teacher would put him in two
    // sections on SAT Period 1 — the M13 conflict checker refuses.
    await server()
      .post('/api/v1/timetables')
      .set(auth(adminToken))
      .send({ sectionId: sectionIds[1] });
    await server()
      .put(`/api/v1/timetables/${draftB}/entries`)
      .set(auth(adminToken))
      .send({
        entries: [
          {
            day: 'SAT',
            periodSlotId: slotIds[0],
            subjectId,
            teacherId: teacherIds[1],
          },
        ],
      })
      .expect(200);
    await server()
      .post(`/api/v1/timetables/${draftB}/publish`)
      .set(auth(adminToken))
      .send({})
      .expect(201);

    await server()
      .post('/api/v1/teacher-assignments')
      .set(auth(adminToken))
      .send({
        sessionId,
        sectionId: sectionIds[0],
        subjectId,
        teacherId: teacherIds[1],
        override: true,
      })
      .expect(409);
  });

  // ── delete guards ───────────────────────────────────────────────────

  it('refuses to delete a period still holding routine cells', async () => {
    await server()
      .delete(`/api/v1/period-slots/${slotIds[0]}`)
      .set(auth(adminToken))
      .expect(409);
  });

  it('keeps published routines — only drafts can be deleted', async () => {
    await server()
      .delete(`/api/v1/timetables/${draftA}`)
      .set(auth(adminToken))
      .expect(409);
  });
});
