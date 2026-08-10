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
import { TicketSlaJob } from '../src/modules/community/jobs/ticket-sla.job';
import { VisitorAutoCheckoutJob } from '../src/modules/community/jobs/visitor-auto-checkout.job';
import {
  seedSystemRoles,
  syncPermissionRegistry,
} from '../src/modules/rbac/seed/rbac.seeder';

/**
 * Requires dev infra (DB + redis). Module 28 — Complaint, Visitor & Alumni.
 *
 * Built around what unit tests structurally cannot see:
 *
 *   1. **Roadmap §9's three flows end to end**: public complaint → resolve
 *      → rating; visitor in → out; alumni register → approve → directory.
 *      Each crosses a public route, a permission guard and a database
 *      CHECK, which is exactly the wiring that compiles and then does
 *      nothing (the M18/M21 lesson, twice learned).
 *   2. **The anonymity promise, from the outside.** A unit test can assert
 *      that a service does not call the notifier; only a live request can
 *      prove the stored ROW carries no name, no contact and no IP, and
 *      that nothing in the API ever hands one back.
 *   3. **The M18 stub actually closed** — the portal contact form now
 *      opens a ticket the family can read, reply on and rate, and a
 *      guardian may not touch anybody else's.
 *   4. **The database invariants**: the never-reuse ticket number, the
 *      anonymous-raiser CHECK, the status-evidence CHECK, the alumni
 *      claim conflict index, and the donation immutability rule — each
 *      probed through the API.
 *   5. **Separation of duties.** The seeded Office Staff runs the desk and
 *      may NOT read a restricted complaint nor cancel a donation receipt;
 *      the head and the accountant hold those.
 */
describe('Complaint, Visitor & Alumni (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-cm-admin@test.local';
  const OFFICE = 'e2e-cm-office@test.local';
  const PARENT = 'e2e-cm-parent@test.local';
  const NAME = 'E2ECM';

  let adminToken: string;
  let officeToken: string;
  let parentToken: string;

  let sessionId: string;
  let classId: string;
  let sectionId: string;
  let guardianId: string;
  let graduateId: string;
  let staffId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;
  const errorOf = (res: request.Response): string =>
    (res.body as { error?: { message?: string } }).error?.message ?? '';

  const emails = [ADMIN, OFFICE, PARENT];

  /**
   * `YYYY-MM-DD`, `offset` days from today **in Asia/Dhaka** — the M25/M26
   * rule. A suite that passes at 14:00 and fails at 19:00 is not flaky,
   * it is wrong.
   */
  const DHAKA_OFFSET_MS = 6 * 3_600_000;
  const day = (offset: number): string =>
    new Date(Date.now() + DHAKA_OFFSET_MS + offset * 86_400_000)
      .toISOString()
      .slice(0, 10);

  const cleanup = async () => {
    await prisma.ticketComment.deleteMany({
      where: { ticket: { subject: { startsWith: NAME } } },
    });
    await prisma.ticket.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, subject: { startsWith: NAME } },
    });
    await prisma.visitor.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.appointment.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, visitorName: { startsWith: NAME } },
    });
    await prisma.donation.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, donorName: { startsWith: NAME } },
    });
    await prisma.alumniEventRegistration.deleteMany({
      where: { event: { title: { startsWith: NAME } } },
    });
    await prisma.alumniEvent.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, title: { startsWith: NAME } },
    });
    await prisma.alumni.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.voucherEntry.deleteMany({
      where: { voucher: { sourceRef: { startsWith: 'donation:' } } },
    });
    await prisma.voucher.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        sourceRef: { startsWith: 'donation:' },
      },
    });
    await prisma.notification.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        templateCode: {
          in: [
            'TICKET_RAISED',
            'TICKET_UPDATE',
            'TICKET_ESCALATED',
            'APPOINTMENT_DECISION',
            'ALUMNI_APPROVED',
            'DONATION_RECEIVED',
          ],
        },
      },
    });
    // **The document-sequence counters are deliberately NOT reset here**,
    // and the full-suite run is what taught us why. `uq_tickets_no` ignores
    // `deleted_at` (a ticket number is never reused), and the *portal*
    // suite now raises tickets of its own through "Contact School". Wiping
    // the `ticket:` counter rewound it to zero while those rows still held
    // CMP-26-00001, and every write in this suite then died on a unique
    // violation — passing alone and failing in the full run.
    //
    // Nothing here needs the numbers to start at 00001: the assertions
    // check the *shape* and that two numbers differ. This is the M26
    // "a fixture whose key is dictated by the code under test needs its
    // own cleanup key" lesson, inverted — **a counter shared with another
    // suite is not this suite's to reset.**
    await prisma.studentStatusHistory.deleteMany({
      where: { student: { firstName: NAME } },
    });
    await prisma.enrollment.deleteMany({
      where: { student: { firstName: NAME } },
    });
    await prisma.studentGuardian.deleteMany({
      where: { student: { firstName: NAME } },
    });
    await prisma.student.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: NAME },
    });
    await prisma.guardian.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.section.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, roomNo: `R-${NAME}` },
    });
    await prisma.schoolClass.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.academicSession.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    if (ids.length > 0) {
      await prisma.staffProfile.deleteMany({ where: { userId: { in: ids } } });
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
    const [adminUser, officeUser, parentUser] = await Promise.all([
      mk(ADMIN, UserType.ADMIN),
      mk(OFFICE, UserType.STAFF),
      mk(PARENT, UserType.PARENT),
    ]);

    const roleFor = (slug: string) =>
      prisma.role.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, slug, deletedAt: null },
      });
    const [adminRole, officeRole, parentRole] = await Promise.all([
      roleFor('admin'),
      roleFor('office-staff'),
      roleFor('parent'),
    ]);
    await prisma.userRole.createMany({
      data: [
        { userId: adminUser.id, roleId: adminRole!.id },
        { userId: officeUser.id, roleId: officeRole!.id },
        { userId: parentUser.id, roleId: parentRole!.id },
      ],
    });

    // The office employee a visitor comes to see.
    const department = await prisma.department.findFirst({
      where: { schoolId: DEFAULT_SCHOOL_ID, deletedAt: null },
    });
    const staff = await prisma.staffProfile.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        userId: officeUser.id,
        employeeId: `${NAME}-${Date.now()}`,
        firstName: NAME,
        lastName: 'Clerk',
        gender: 'FEMALE',
        dob: new Date('1990-01-01'),
        joiningDate: new Date(day(-800)),
        designation: 'OFFICE_STAFF',
        employmentType: 'PERMANENT',
        ...(department ? { departmentId: department.id } : {}),
      },
    });
    staffId = staff.id;

    const session = await prisma.academicSession.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `${NAME} ${new Date().getUTCFullYear()}`,
        startDate: new Date(day(-300)),
        endDate: new Date(day(120)),
        status: 'ACTIVE',
      },
    });
    sessionId = session.id;

    const klass = await prisma.schoolClass.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `${NAME} Class`,
        numericLevel: 16,
      },
    });
    classId = klass.id;

    const section = await prisma.section.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        classId,
        sessionId,
        name: 'C1',
        roomNo: `R-${NAME}`,
      },
    });
    sectionId = section.id;

    // A graduated student, for the alumni match hints (roadmap §4).
    const graduate = await prisma.student.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        studentUid: `${NAME}-GRAD-${Date.now()}`,
        firstName: NAME,
        lastName: 'Graduate',
        gender: 'FEMALE',
        dob: new Date('2005-05-05'),
        admissionDate: new Date(day(-2900)),
        admissionClassId: classId,
        qrToken: randomUUID(),
        status: 'GRADUATED',
      },
    });
    graduateId = graduate.id;
    await prisma.studentStatusHistory.create({
      data: {
        studentId: graduate.id,
        fromStatus: 'ACTIVE',
        toStatus: 'GRADUATED',
        reason: 'e2e fixture',
      },
    });

    // The parent whose portal ticket this suite follows.
    const guardian = await prisma.guardian.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        userId: parentUser.id,
        name: `${NAME} Parent`,
        phone: `0171${String(Date.now()).slice(-7)}`,
        relation: 'FATHER',
      },
    });
    guardianId = guardian.id;

    const child = await prisma.student.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        studentUid: `${NAME}-${Date.now()}`,
        firstName: NAME,
        lastName: 'Child',
        gender: 'MALE',
        dob: new Date('2012-02-02'),
        admissionDate: new Date(day(-290)),
        admissionClassId: classId,
        qrToken: randomUUID(),
      },
    });
    await prisma.studentGuardian.create({
      data: { studentId: child.id, guardianId: guardian.id, isPrimary: true },
    });
    await prisma.enrollment.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        studentId: child.id,
        sessionId,
        classId,
        sectionId,
        rollNo: 1,
        enrollmentDate: new Date(day(-280)),
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
    officeToken = await login(OFFICE);
    parentToken = await login(PARENT);
  }, 120_000);

  afterAll(async () => {
    await cleanup();
    await app?.close();
  });

  // ══════════════════════════════════════════════════════════════════
  // Roadmap §9: public complaint → resolve → rating
  // ══════════════════════════════════════════════════════════════════

  describe('the public complaint flow', () => {
    let ticketId: string;
    let ticketNo: string;

    it('accepts a named complaint from the website and hands back a reference', async () => {
      const res = await server()
        .post('/api/v1/public/tickets')
        .send({
          type: 'COMPLAINT',
          category: 'TRANSPORT',
          subject: `${NAME} bus is late every morning`,
          description: 'The 7:15 bus has been arriving after 7:40 all week.',
          name: 'A Concerned Parent',
          phone: '01712345678',
        })
        .expect(201);

      const body = dataOf<{ message: string; ticketNo: string }>(res);
      expect(body.ticketNo).toMatch(/^CMP-\d{2}-\d{5}$/);
      ticketNo = body.ticketNo;
    });

    it('refuses a named complaint with no way to reply to it', async () => {
      const res = await server()
        .post('/api/v1/public/tickets')
        .send({
          type: 'COMPLAINT',
          category: 'OTHER',
          subject: `${NAME} unreachable`,
          description: 'Nobody can get back to me about this.',
        })
        .expect(400);
      expect(errorOf(res)).toMatch(/phone number or an email|anonymously/i);
    });

    it('shows the complaint in the office inbox', async () => {
      const res = await server()
        .get('/api/v1/tickets')
        .set(auth(officeToken))
        .query({ search: ticketNo })
        .expect(200);

      const rows = dataOf<Array<{ id: string; status: string }>>(res);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('OPEN');
      ticketId = rows[0].id;
    });

    it('refuses to resolve it with nothing written — the CHECK and the service agree', async () => {
      const res = await server()
        .put(`/api/v1/tickets/${ticketId}/status`)
        .set(auth(adminToken))
        .send({ status: 'RESOLVED' })
        .expect(400);
      expect(errorOf(res)).toMatch(/Say what was done/i);
    });

    it('refuses an illegal jump structurally', async () => {
      const res = await server()
        .put(`/api/v1/tickets/${ticketId}/status`)
        .set(auth(adminToken))
        .send({ status: 'REOPENED' })
        .expect(409);
      expect(errorOf(res)).toMatch(/cannot move to REOPENED/i);
    });

    it('lets the office reply, and stamps the first response', async () => {
      await server()
        .post(`/api/v1/tickets/${ticketId}/comments`)
        .set(auth(officeToken))
        .send({ body: 'Thank you — we are speaking to the driver.' })
        .expect(201);

      const res = await server()
        .get(`/api/v1/tickets/${ticketId}`)
        .set(auth(officeToken))
        .expect(200);
      expect(
        dataOf<{ firstResponseAt: string | null }>(res).firstResponseAt,
      ).not.toBeNull();
    });

    it('keeps an internal note out of the requester-visible thread', async () => {
      await server()
        .post(`/api/v1/tickets/${ticketId}/comments`)
        .set(auth(officeToken))
        .send({
          body: 'Driver has been warned twice already.',
          isInternal: true,
        })
        .expect(201);

      const res = await server()
        .get(`/api/v1/tickets/${ticketId}/comments`)
        .set(auth(officeToken))
        .expect(200);
      const thread = dataOf<Array<{ isInternal: boolean }>>(res);
      // The office sees both; the portal test below proves the family
      // sees only one.
      expect(thread.filter((c) => c.isInternal)).toHaveLength(1);
      expect(thread.filter((c) => !c.isInternal)).toHaveLength(1);
    });

    it('resolves it with a resolution on the record', async () => {
      const res = await server()
        .put(`/api/v1/tickets/${ticketId}/status`)
        .set(auth(adminToken))
        .send({
          status: 'RESOLVED',
          resolution: 'Route timings adjusted from Monday.',
        })
        .expect(200);

      const ticket = dataOf<{ status: string; resolvedAt: string | null }>(res);
      expect(ticket.status).toBe('RESOLVED');
      expect(ticket.resolvedAt).not.toBeNull();
    });

    it('never reuses a ticket number', async () => {
      const res = await server()
        .post('/api/v1/public/tickets')
        .send({
          type: 'FEEDBACK',
          category: 'OTHER',
          subject: `${NAME} second submission`,
          description: 'Just saying thank you to the teachers.',
          phone: '01712345679',
        })
        .expect(201);
      expect(dataOf<{ ticketNo: string }>(res).ticketNo).not.toBe(ticketNo);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // The anonymity promise — the module's central claim
  // ══════════════════════════════════════════════════════════════════

  describe('an anonymous complaint', () => {
    let anonId: string;

    it('is accepted with no contact at all', async () => {
      const res = await server()
        .post('/api/v1/public/tickets')
        .send({
          type: 'COMPLAINT',
          category: 'TEACHER',
          subject: `${NAME} something I cannot put my name to`,
          description: 'A member of staff has been shouting at the children.',
          anonymous: true,
        })
        .expect(201);
      expect(dataOf<{ message: string }>(res).message).toMatch(/no reply/i);
    });

    /**
     * The whole promise, checked at the row rather than at the service.
     * `chk_tickets_raiser` refuses anything else, but a service that
     * quietly wrote an IP would have been caught here first.
     */
    it('stores no raiser, no contact and NO IP', async () => {
      const ticket = await prisma.ticket.findFirst({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          subject: { startsWith: `${NAME} something` },
        },
      });
      expect(ticket).not.toBeNull();
      expect(ticket!.raisedByType).toBe('ANONYMOUS');
      expect(ticket!.raisedById).toBeNull();
      expect(ticket!.contact).toBeNull();
      expect(ticket!.ip).toBeNull();
      anonId = ticket!.id;
    });

    it('is marked sensitive automatically, because its category names staff', async () => {
      const ticket = await prisma.ticket.findUnique({ where: { id: anonId } });
      expect(ticket!.isSensitive).toBe(true);
    });

    it('never hands back a requester name over the API', async () => {
      const res = await server()
        .get(`/api/v1/tickets/${anonId}`)
        .set(auth(adminToken))
        .expect(200);
      const ticket = dataOf<{ requesterName: string | null; contact: unknown }>(
        res,
      );
      expect(ticket.requesterName).toBeNull();
      expect(ticket.contact).toBeNull();
    });

    /**
     * Measured as a **delta**, not as an absolute count: a named complaint
     * earlier in this suite was resolved and correctly did notify, so
     * "no TICKET_UPDATE rows exist" would be asserting the wrong thing and
     * would fail for the right reason. What must be true is that resolving
     * THIS ticket adds none.
     */
    it('sends nothing to anybody when it is resolved', async () => {
      const where = {
        schoolId: DEFAULT_SCHOOL_ID,
        templateCode: 'TICKET_UPDATE',
      };
      const before = await prisma.notification.count({ where });

      await server()
        .put(`/api/v1/tickets/${anonId}/status`)
        .set(auth(adminToken))
        .send({ status: 'RESOLVED', resolution: 'Spoken to and noted.' })
        .expect(200);

      expect(await prisma.notification.count({ where })).toBe(before);

      // And nothing anywhere in the log mentions its number, which is the
      // only handle the complainant was given.
      const ticket = await prisma.ticket.findUnique({ where: { id: anonId } });
      const mentions = await prisma.notification.count({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          bodyRendered: { contains: ticket!.ticketNo },
          templateCode: 'TICKET_UPDATE',
        },
      });
      expect(mentions).toBe(0);
    });

    it('cannot be filed anonymously from the admin counter', async () => {
      const res = await server()
        .post('/api/v1/tickets')
        .set(auth(adminToken))
        .send({
          type: 'COMPLAINT',
          category: 'OTHER',
          subject: `${NAME} counter anonymous`,
          description: 'Typed by the clerk in front of the complainant.',
          raisedByType: 'ANONYMOUS',
        })
        .expect(400);
      expect(errorOf(res)).toMatch(/not anonymous/i);
    });

    it('refuses an anonymous submission when the school has switched it off', async () => {
      await server()
        .put('/api/v1/settings/community')
        .set(auth(adminToken))
        // Through the API, never straight into the table — the M23 lesson
        // about the 60-second settings cache.
        .send({ 'community.ticket_allow_anonymous': false })
        .expect(200);

      const res = await server()
        .post('/api/v1/public/tickets')
        .send({
          type: 'COMPLAINT',
          category: 'OTHER',
          subject: `${NAME} blocked anonymous`,
          description: 'This school does not take these.',
          anonymous: true,
        })
        .expect(400);
      expect(errorOf(res)).toMatch(/does not accept anonymous/i);

      await server()
        .put('/api/v1/settings/community')
        .set(auth(adminToken))
        .send({ 'community.ticket_allow_anonymous': true })
        .expect(200);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Roadmap §8: a restricted complaint is invisible, not forbidden
  // ══════════════════════════════════════════════════════════════════

  describe('a restricted complaint', () => {
    let sensitiveId: string;

    beforeAll(async () => {
      const created = await prisma.ticket.findFirst({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          subject: { startsWith: `${NAME} something` },
        },
      });
      sensitiveId = created!.id;
    });

    it('is readable by the head, who holds ticket.sensitive.view', async () => {
      await server()
        .get(`/api/v1/tickets/${sensitiveId}`)
        .set(auth(adminToken))
        .expect(200);
    });

    /**
     * **404, not 403.** A 403 tells a member of staff that a complaint
     * about somebody exists, which is precisely the disclosure roadmap §8
     * prevents — the M15/M19/M22 rule that a read must not confirm what
     * the caller may not see.
     */
    it('gives the office the same 404 an unknown id gets', async () => {
      const res = await server()
        .get(`/api/v1/tickets/${sensitiveId}`)
        .set(auth(officeToken))
        .expect(404);
      expect(errorOf(res)).toMatch(/not found/i);
    });

    it('is absent from the office inbox listing entirely', async () => {
      const res = await server()
        .get('/api/v1/tickets')
        .set(auth(officeToken))
        .query({ limit: 100 })
        .expect(200);
      const ids = dataOf<Array<{ id: string }>>(res).map((t) => t.id);
      expect(ids).not.toContain(sensitiveId);
    });

    it('is in the head’s listing', async () => {
      const res = await server()
        .get('/api/v1/tickets')
        .set(auth(adminToken))
        .query({ limit: 100 })
        .expect(200);
      const ids = dataOf<Array<{ id: string }>>(res).map((t) => t.id);
      expect(ids).toContain(sensitiveId);
    });

    /**
     * The M27 lesson applied to a report: the shape has to SAY what it
     * could not see, or a "42 complaints" figure quietly omits the ones
     * about staff and means something other than what it says.
     */
    it('is excluded from the office’s report, and the report says so', async () => {
      const officeReport = await server()
        .get('/api/v1/tickets/reports/summary')
        .set(auth(officeToken))
        .expect(200);
      const headReport = await server()
        .get('/api/v1/tickets/reports/summary')
        .set(auth(adminToken))
        .expect(200);

      const office = dataOf<{ total: number; excludesSensitive: boolean }>(
        officeReport,
      );
      const head = dataOf<{ total: number; excludesSensitive: boolean }>(
        headReport,
      );

      expect(office.excludesSensitive).toBe(true);
      expect(head.excludesSensitive).toBe(false);
      expect(head.total).toBeGreaterThan(office.total);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // The M18 stub, closed: the portal contact form is a real thread
  // ══════════════════════════════════════════════════════════════════

  describe('the portal ticket thread', () => {
    let portalTicketId: string;

    it('opens a ticket from "Contact School" and returns a reference', async () => {
      const res = await server()
        .post('/api/v1/portal/contact-school')
        .set(auth(parentToken))
        .send({
          subject: `${NAME} lunch break question`,
          body: 'Is the canteen open during the exam week?',
          type: 'FEEDBACK',
          category: 'ACADEMIC',
        })
        .expect(201);

      const body = dataOf<{ ticketNo: string; id: string }>(res);
      expect(body.ticketNo).toMatch(/^CMP-/);
      portalTicketId = body.id;
    });

    it('files it against the guardian row, never the request body', async () => {
      const ticket = await prisma.ticket.findUnique({
        where: { id: portalTicketId },
      });
      expect(ticket!.raisedByType).toBe('GUARDIAN');
      expect(ticket!.raisedById).toBe(guardianId);
    });

    it('lists it back to the family', async () => {
      const res = await server()
        .get('/api/v1/portal/tickets')
        .set(auth(parentToken))
        .expect(200);
      const rows = dataOf<Array<{ id: string }>>(res);
      expect(rows.map((t) => t.id)).toContain(portalTicketId);
    });

    it('hides internal notes from the family’s copy of the thread', async () => {
      await server()
        .post(`/api/v1/tickets/${portalTicketId}/comments`)
        .set(auth(adminToken))
        .send({ body: 'Ask the canteen manager first.', isInternal: true })
        .expect(201);
      await server()
        .post(`/api/v1/tickets/${portalTicketId}/comments`)
        .set(auth(adminToken))
        .send({ body: 'Yes — 12:30 to 13:15 as usual.' })
        .expect(201);

      const res = await server()
        .get('/api/v1/portal/tickets')
        .set(auth(parentToken))
        .expect(200);
      const mine = dataOf<
        Array<{ id: string; comments: Array<{ body: string }> }>
      >(res).find((t) => t.id === portalTicketId)!;

      expect(mine.comments).toHaveLength(1);
      expect(mine.comments[0].body).toMatch(/12:30/);
      expect(JSON.stringify(mine.comments)).not.toMatch(/canteen manager/);
    });

    it('lets the family reply on their own ticket', async () => {
      await server()
        .post(`/api/v1/portal/tickets/${portalTicketId}/reply`)
        .set(auth(parentToken))
        .send({ body: 'Thank you.' })
        .expect(201);
    });

    it('refuses a reply on somebody else’s ticket with a 404, not a 403', async () => {
      const other = await prisma.ticket.findFirst({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          raisedByType: 'PUBLIC',
          subject: { startsWith: NAME },
        },
      });
      const res = await server()
        .post(`/api/v1/portal/tickets/${other!.id}/reply`)
        .set(auth(parentToken))
        .send({ body: 'Not mine.' })
        .expect(404);
      expect(errorOf(res)).toMatch(/not found/i);
    });

    it('refuses a rating before the school has resolved it', async () => {
      const res = await server()
        .post(`/api/v1/portal/tickets/${portalTicketId}/rating`)
        .set(auth(parentToken))
        .send({ rating: 5 })
        .expect(409);
      expect(errorOf(res)).toMatch(/resolved/i);
    });

    it('takes a rating once it is resolved, and only once', async () => {
      await server()
        .put(`/api/v1/tickets/${portalTicketId}/status`)
        .set(auth(adminToken))
        .send({ status: 'RESOLVED', resolution: 'Answered.' })
        .expect(200);

      await server()
        .post(`/api/v1/portal/tickets/${portalTicketId}/rating`)
        .set(auth(parentToken))
        .send({ rating: 4, comment: 'Quick reply, thanks.' })
        .expect(201);

      const again = await server()
        .post(`/api/v1/portal/tickets/${portalTicketId}/rating`)
        .set(auth(parentToken))
        .send({ rating: 1 })
        .expect(409);
      expect(errorOf(again)).toMatch(/already been rated/i);
    });

    /** Roadmap §6's seven-day window, and its far side. */
    it('reopens a closed ticket inside the window and refuses outside it', async () => {
      await server()
        .put(`/api/v1/tickets/${portalTicketId}/status`)
        .set(auth(adminToken))
        .send({ status: 'CLOSED', resolution: 'Answered.' })
        .expect(200);

      await server()
        .put(`/api/v1/tickets/${portalTicketId}/status`)
        .set(auth(adminToken))
        .send({ status: 'REOPENED' })
        .expect(200);

      // **The rating survives the reopen.** This is the defect this suite
      // found: the CHECK originally allowed a score only on RESOLVED or
      // CLOSED, so reopening a rated ticket 500'd. Clearing the score
      // instead would have let a school lift its average satisfaction by
      // reopening the tickets people scored badly.
      const reopened = await prisma.ticket.findUnique({
        where: { id: portalTicketId },
      });
      expect(reopened!.satisfactionRating).toBe(4);
      expect(reopened!.resolution).toBeNull();

      // Close it again, then age the closure past the window.
      await server()
        .put(`/api/v1/tickets/${portalTicketId}/status`)
        .set(auth(adminToken))
        .send({ status: 'CLOSED', resolution: 'Answered again.' })
        .expect(200);
      await prisma.ticket.update({
        where: { id: portalTicketId },
        data: { closedAt: new Date(Date.now() - 30 * 86_400_000) },
      });

      const res = await server()
        .put(`/api/v1/tickets/${portalTicketId}/status`)
        .set(auth(adminToken))
        .send({ status: 'REOPENED' })
        .expect(403);
      expect(errorOf(res)).toMatch(/reopen window closed/i);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Roadmap §9: visitor in → out
  // ══════════════════════════════════════════════════════════════════

  describe('the gate register', () => {
    let visitorId: string;

    it('checks a visitor in against a named host', async () => {
      const hostsRes = await server()
        .get('/api/v1/visitors/hosts')
        .set(auth(officeToken))
        .expect(200);
      const hosts =
        dataOf<Array<{ hostType: string; hostId: string }>>(hostsRes);
      expect(hosts.length).toBeGreaterThan(0);

      const res = await server()
        .post('/api/v1/visitors')
        .set(auth(officeToken))
        .send({
          name: `${NAME} Visitor`,
          phone: '01798765432',
          purpose: 'MEETING',
          hostType: 'STAFF',
          hostId: staffId,
        })
        .expect(201);

      const visitor = dataOf<{ id: string; inside: boolean }>(res);
      expect(visitor.inside).toBe(true);
      visitorId = visitor.id;
    });

    it('puts them on the in-building list', async () => {
      const res = await server()
        .get('/api/v1/visitors/inside')
        .set(auth(officeToken))
        .expect(200);
      expect(dataOf<Array<{ id: string }>>(res).map((v) => v.id)).toContain(
        visitorId,
      );
    });

    it('refuses a multi-day pass for an ordinary meeting (roadmap §8)', async () => {
      const res = await server()
        .post('/api/v1/visitors')
        .set(auth(officeToken))
        .send({
          name: `${NAME} Vendor`,
          phone: '01798765433',
          purpose: 'VENDOR',
          validUntil: day(5),
        })
        .expect(400);
      expect(errorOf(res)).toMatch(/OFFICIAL/i);
    });

    it('allows one for an external invigilator, bounded by the school’s cap', async () => {
      await server()
        .post('/api/v1/visitors')
        .set(auth(officeToken))
        .send({
          name: `${NAME} Invigilator`,
          phone: '01798765434',
          purpose: 'OFFICIAL',
          validUntil: day(2),
        })
        .expect(201);

      const tooLong = await server()
        .post('/api/v1/visitors')
        .set(auth(officeToken))
        .send({
          name: `${NAME} Contractor`,
          phone: '01798765435',
          purpose: 'OFFICIAL',
          validUntil: day(90),
        })
        .expect(400);
      expect(errorOf(tooLong)).toMatch(/at most/i);
    });

    it('checks them out, and refuses a second checkout', async () => {
      const res = await server()
        .post(`/api/v1/visitors/${visitorId}/checkout`)
        .set(auth(officeToken))
        .send({})
        .expect(201);
      expect(dataOf<{ inside: boolean }>(res).inside).toBe(false);

      const again = await server()
        .post(`/api/v1/visitors/${visitorId}/checkout`)
        .set(auth(officeToken))
        .send({})
        .expect(409);
      expect(errorOf(again)).toMatch(/already signed out/i);
    });

    /**
     * The flag is the point: "left at 16:40" and "was still signed in when
     * we locked up" are different facts, and the register has to say which.
     */
    it('records a human checkout as NOT auto — the sweep’s flag stays false', async () => {
      const visitor = await prisma.visitor.findUnique({
        where: { id: visitorId },
      });
      expect(visitor!.checkOut).not.toBeNull();
      expect(visitor!.autoCheckedOut).toBe(false);
    });

    it('prints a gate pass when the school requires one, with a number that is never reused', async () => {
      await server()
        .put('/api/v1/settings/community')
        .set(auth(adminToken))
        .send({ 'community.visitor_gate_pass_required': true })
        .expect(200);

      const first = await server()
        .post('/api/v1/visitors')
        .set(auth(officeToken))
        .send({
          name: `${NAME} Passholder A`,
          phone: '01798765436',
          purpose: 'MEETING',
        })
        .expect(201);
      const second = await server()
        .post('/api/v1/visitors')
        .set(auth(officeToken))
        .send({
          name: `${NAME} Passholder B`,
          phone: '01798765437',
          purpose: 'MEETING',
        })
        .expect(201);

      const a = dataOf<{ gatePassNo: string | null }>(first).gatePassNo;
      const b = dataOf<{ gatePassNo: string | null }>(second).gatePassNo;
      expect(a).toMatch(/^GP-/);
      expect(b).not.toBe(a);

      await server()
        .put('/api/v1/settings/community')
        .set(auth(adminToken))
        .send({ 'community.visitor_gate_pass_required': false })
        .expect(200);
    });

    it('reports the day’s register with the sweep column on it', async () => {
      const res = await server()
        .get('/api/v1/visitors/reports/register')
        .set(auth(officeToken))
        .expect(200);
      const report = dataOf<{
        stats: { total: number; inside: number; autoCheckedOut: number };
      }>(res);
      expect(report.stats.total).toBeGreaterThan(0);
      expect(report.stats).toHaveProperty('autoCheckedOut');
    });
  });

  describe('appointments', () => {
    let appointmentId: string;

    it('records a request', async () => {
      const res = await server()
        .post('/api/v1/appointments')
        .set(auth(officeToken))
        .send({
          visitorName: `${NAME} Appointment`,
          phone: '01711112222',
          purpose: 'MEETING',
          hostType: 'STAFF',
          hostId: staffId,
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        })
        .expect(201);
      appointmentId = dataOf<{ id: string; status: string }>(res).id;
    });

    it('refuses a refusal with no reason on it', async () => {
      const res = await server()
        .put(`/api/v1/appointments/${appointmentId}/decision`)
        .set(auth(adminToken))
        .send({ status: 'REJECTED' })
        .expect(400);
      expect(errorOf(res)).toMatch(/Say why/i);
    });

    it('approves it, and only an approved one admits a visitor', async () => {
      await server()
        .put(`/api/v1/appointments/${appointmentId}/decision`)
        .set(auth(adminToken))
        .send({ status: 'APPROVED', note: 'Come to the front office.' })
        .expect(200);

      const res = await server()
        .post('/api/v1/visitors')
        .set(auth(officeToken))
        .send({
          name: `${NAME} Appointment`,
          phone: '01711112222',
          purpose: 'MEETING',
          hostType: 'STAFF',
          hostId: staffId,
          appointmentId,
        })
        .expect(201);
      expect(dataOf<{ appointmentId: string | null }>(res).appointmentId).toBe(
        appointmentId,
      );
    });

    /** Keeping the kept and the unkept apart is the register's whole value. */
    it('marks the appointment COMPLETED once they actually arrive', async () => {
      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
      });
      expect(appointment!.status).toBe('COMPLETED');
    });

    it('refuses to move a completed appointment onwards', async () => {
      const res = await server()
        .put(`/api/v1/appointments/${appointmentId}/decision`)
        .set(auth(adminToken))
        .send({ status: 'NO_SHOW' })
        .expect(409);
      expect(errorOf(res)).toMatch(/cannot become NO_SHOW/i);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Roadmap §9: alumni register → approve → directory
  // ══════════════════════════════════════════════════════════════════

  describe('the alumni flow', () => {
    let alumniId: string;
    let rivalId: string;

    it('takes a public registration and holds it PENDING', async () => {
      const res = await server()
        .post('/api/v1/public/alumni/register')
        .send({
          name: `${NAME} Graduate`,
          batchYear: new Date().getUTCFullYear() - 3,
          lastClass: 'Class 10',
          phone: '01755556666',
          profession: 'Doctor',
          isPublicProfile: true,
        })
        .expect(201);
      expect(dataOf<{ status: string }>(res).status).toBe('PENDING');
    });

    it('refuses a future batch year — that person is still a student', async () => {
      const res = await server()
        .post('/api/v1/public/alumni/register')
        .send({
          name: `${NAME} Too Soon`,
          batchYear: new Date().getUTCFullYear() + 1,
          phone: '01755556667',
        })
        .expect(400);
      expect(errorOf(res)).toMatch(/future/i);
    });

    it('refuses a registration nobody can reach', async () => {
      const res = await server()
        .post('/api/v1/public/alumni/register')
        .send({ name: `${NAME} Unreachable`, batchYear: 2010 })
        .expect(400);
      expect(errorOf(res)).toMatch(/phone number or an email/i);
    });

    it('keeps a pending profile out of the public directory', async () => {
      const res = await server().get('/api/v1/public/alumni').expect(200);
      const names = dataOf<Array<{ name: string }>>(res).map((p) => p.name);
      expect(names).not.toContain(`${NAME} Graduate`);
    });

    it('shows the approver which graduate this might be (roadmap §4)', async () => {
      const listRes = await server()
        .get('/api/v1/alumni')
        .set(auth(adminToken))
        .query({ status: 'PENDING', limit: 50 })
        .expect(200);
      const pending = dataOf<Array<{ id: string; name: string }>>(listRes).find(
        (a) => a.name === `${NAME} Graduate`,
      )!;
      alumniId = pending.id;

      const hintsRes = await server()
        .get(`/api/v1/alumni/${alumniId}/match-hints`)
        .set(auth(adminToken))
        .expect(200);
      const hints =
        dataOf<Array<{ studentId: string; score: number; reasons: string[] }>>(
          hintsRes,
        );
      expect(hints.map((h) => h.studentId)).toContain(graduateId);
      expect(hints[0].score).toBeGreaterThan(0);
      expect(hints[0].reasons.length).toBeGreaterThan(0);
    });

    it('approves it against the matched student record', async () => {
      const res = await server()
        .put(`/api/v1/alumni/${alumniId}/decision`)
        .set(auth(adminToken))
        .send({ status: 'APPROVED', studentId: graduateId })
        .expect(200);
      expect(dataOf<{ status: string }>(res).status).toBe('APPROVED');
    });

    it('publishes it — with no contact details on it, ever', async () => {
      const res = await server().get('/api/v1/public/alumni').expect(200);
      const profiles =
        dataOf<Array<{ name: string; profession: string | null }>>(res);
      const mine = profiles.find((p) => p.name === `${NAME} Graduate`);

      expect(mine).toBeDefined();
      expect(mine!.profession).toBe('Doctor');
      // The privacy rule, asserted on the wire rather than on the object:
      // the number is on the row and must not be in the response.
      expect(JSON.stringify(profiles)).not.toContain('01755556666');
      expect(mine).not.toHaveProperty('phone');
      expect(mine).not.toHaveProperty('email');
      expect(mine).not.toHaveProperty('address');
    });

    /**
     * Roadmap §8's conflict queue, and it needs no queue table: the second
     * claimant registers and waits; what is refused is the APPROVAL.
     */
    it('lets a rival claim register, and refuses to approve it onto the same student', async () => {
      await server()
        .post('/api/v1/public/alumni/register')
        .send({
          name: `${NAME} Rival Claim`,
          batchYear: new Date().getUTCFullYear() - 3,
          phone: '01755556668',
        })
        .expect(201);

      const listRes = await server()
        .get('/api/v1/alumni')
        .set(auth(adminToken))
        .query({ status: 'PENDING', limit: 50 })
        .expect(200);
      rivalId = dataOf<Array<{ id: string; name: string }>>(listRes).find(
        (a) => a.name === `${NAME} Rival Claim`,
      )!.id;

      const res = await server()
        .put(`/api/v1/alumni/${rivalId}/decision`)
        .set(auth(adminToken))
        .send({ status: 'APPROVED', studentId: graduateId })
        .expect(409);
      expect(errorOf(res)).toMatch(/already been approved/i);
    });

    it('approves the rival without a link, which is a legitimate outcome', async () => {
      await server()
        .put(`/api/v1/alumni/${rivalId}/decision`)
        .set(auth(adminToken))
        .send({ status: 'APPROVED' })
        .expect(200);
    });

    it('hides a profile that did not opt in, even once approved', async () => {
      const created = await server()
        .post('/api/v1/alumni')
        .set(auth(officeToken))
        .send({
          name: `${NAME} Private Alumnus`,
          batchYear: 2001,
          phone: '01755556669',
        })
        .expect(201);
      expect(
        dataOf<{ isPublicProfile: boolean }>(created).isPublicProfile,
      ).toBe(false);

      const res = await server().get('/api/v1/public/alumni').expect(200);
      const names = dataOf<Array<{ name: string }>>(res).map((p) => p.name);
      expect(names).not.toContain(`${NAME} Private Alumnus`);
    });
  });

  describe('alumni events', () => {
    let eventId: string;
    let alumniId: string;

    beforeAll(async () => {
      const alumnus = await prisma.alumni.findFirst({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          name: `${NAME} Graduate`,
          status: 'APPROVED',
        },
      });
      alumniId = alumnus!.id;
    });

    it('refuses a deadline after the event', async () => {
      const res = await server()
        .post('/api/v1/alumni-events')
        .set(auth(adminToken))
        .send({
          title: `${NAME} Bad Deadline`,
          eventDate: day(20),
          registrationDeadline: day(25),
        })
        .expect(400);
      expect(errorOf(res)).toMatch(/after the event/i);
    });

    it('creates a capped reunion', async () => {
      const res = await server()
        .post('/api/v1/alumni-events')
        .set(auth(adminToken))
        .send({
          title: `${NAME} Reunion`,
          eventDate: day(30),
          venue: 'School hall',
          fee: 500,
          capacity: 2,
          isPublished: true,
        })
        .expect(201);
      eventId = dataOf<{ id: string }>(res).id;
    });

    /** Over capacity WARNS — the M25 bus rule, seventh application. */
    it('warns over capacity rather than refusing the registration', async () => {
      const res = await server()
        .post(`/api/v1/alumni-events/${eventId}/registrations`)
        .set(auth(officeToken))
        .send({ alumniId, guests: 4 })
        .expect(201);
      const body = dataOf<{ warning: string | null }>(res);
      expect(body.warning).toMatch(/5 of 2/);
    });

    it('refuses a second live registration for the same person', async () => {
      const res = await server()
        .post(`/api/v1/alumni-events/${eventId}/registrations`)
        .set(auth(officeToken))
        .send({ alumniId })
        .expect(409);
      expect(errorOf(res)).toMatch(/already registered/i);
    });

    it('refuses to delete an event people have signed up for', async () => {
      const res = await server()
        .delete(`/api/v1/alumni-events/${eventId}`)
        .set(auth(adminToken))
        .expect(409);
      expect(errorOf(res)).toMatch(/have registered/i);
    });

    it('shows a published, upcoming event on the public site', async () => {
      const res = await server()
        .get('/api/v1/public/alumni/events')
        .expect(200);
      const titles = dataOf<Array<{ title: string }>>(res).map((e) => e.title);
      expect(titles).toContain(`${NAME} Reunion`);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Donations: a receipt is immutable, and it posts to the ledger
  // ══════════════════════════════════════════════════════════════════

  describe('the donation register', () => {
    let donationId: string;
    let receiptNo: string;

    it('refuses a donation of nothing (roadmap §7)', async () => {
      await server()
        .post('/api/v1/donations')
        .set(auth(officeToken))
        .send({ donorName: `${NAME} Nobody`, amount: 0, method: 'CASH' })
        .expect(400);
    });

    it('records a gift and issues a gap-free receipt', async () => {
      const res = await server()
        .post('/api/v1/donations')
        .set(auth(officeToken))
        .send({
          donorName: `${NAME} Karim Traders`,
          donorPhone: '01766667777',
          amount: 25000,
          purpose: 'Library fund',
          method: 'CASH',
        })
        .expect(201);

      const donation = dataOf<{ id: string; receiptNo: string }>(res);
      expect(donation.receiptNo).toMatch(/^DON-\d{2}-\d{5}$/);
      donationId = donation.id;
      receiptNo = donation.receiptNo;
    });

    /** M20's `postAuto` door, sixth consumer, idempotent on `source_ref`. */
    it('posts it to the ledger as a balanced CREDIT voucher', async () => {
      const voucher = await prisma.voucher.findFirst({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          sourceRef: `donation:${donationId}`,
        },
        include: { entries: true },
      });

      expect(voucher).not.toBeNull();
      expect(voucher!.source).toBe('DONATION');
      expect(voucher!.type).toBe('CREDIT');
      expect(voucher!.postedAt).not.toBeNull();

      const debit = voucher!.entries.reduce((s, e) => s + Number(e.debit), 0);
      const credit = voucher!.entries.reduce((s, e) => s + Number(e.credit), 0);
      expect(debit).toBe(25000);
      expect(credit).toBe(25000);
    });

    /**
     * Twenty donated benches are worth twenty thousand taka on the receipt
     * and are NOT twenty thousand taka in the cash box.
     */
    it('receipts a gift in kind but never posts it to cash', async () => {
      const res = await server()
        .post('/api/v1/donations')
        .set(auth(officeToken))
        .send({
          donorName: `${NAME} Furniture Donor`,
          amount: 20000,
          purpose: 'Benches',
          method: 'IN_KIND',
        })
        .expect(201);
      const inKind = dataOf<{ id: string; receiptNo: string }>(res);
      expect(inKind.receiptNo).toMatch(/^DON-/);

      const voucher = await prisma.voucher.findFirst({
        where: { sourceRef: `donation:${inKind.id}` },
      });
      expect(voucher).toBeNull();
    });

    /** Roadmap §6: "donations receipts immutable". */
    it('offers no way to edit a receipt', async () => {
      await server()
        .put(`/api/v1/donations/${donationId}`)
        .set(auth(adminToken))
        .send({ amount: 1 })
        .expect(404);
      await server()
        .patch(`/api/v1/donations/${donationId}`)
        .set(auth(adminToken))
        .send({ amount: 1 })
        .expect(404);
    });

    /**
     * The M16/M20/M21/M23/M24/M25/M26/M27 separation, continued: the
     * office takes the money, somebody else can make a receipt disappear.
     */
    it('refuses the office staff the cancellation', async () => {
      await server()
        .post(`/api/v1/donations/${donationId}/cancel`)
        .set(auth(officeToken))
        .send({ reason: 'Entered twice by mistake' })
        .expect(403);
    });

    it('refuses a cancellation with no reason', async () => {
      await server()
        .post(`/api/v1/donations/${donationId}/cancel`)
        .set(auth(adminToken))
        .send({ reason: '' })
        .expect(400);
    });

    it('cancels with a reason, and the receipt STAYS in the register', async () => {
      await server()
        .post(`/api/v1/donations/${donationId}/cancel`)
        .set(auth(adminToken))
        .send({ reason: 'Entered twice by mistake' })
        .expect(201);

      const res = await server()
        .get('/api/v1/donations')
        .set(auth(adminToken))
        .query({ limit: 100 })
        .expect(200);
      const rows = dataOf<
        Array<{
          id: string;
          receiptNo: string;
          cancelledReason: string | null;
        }>
      >(res);
      const cancelled = rows.find((d) => d.id === donationId);

      expect(cancelled).toBeDefined();
      expect(cancelled!.receiptNo).toBe(receiptNo);
      expect(cancelled!.cancelledReason).toMatch(/twice/);
    });

    /**
     * The M24/M25 precedent, verbatim: reversing a posted entry is the
     * accountant's act, and `voucher.cancel` is not this module's code.
     */
    it('leaves the ledger voucher standing — reversal is the accountant’s call', async () => {
      const voucher = await prisma.voucher.findFirst({
        where: { sourceRef: `donation:${donationId}` },
      });
      expect(voucher).not.toBeNull();
      expect(voucher!.status).toBe('POSTED');
    });

    it('refuses to cancel the same receipt twice', async () => {
      const res = await server()
        .post(`/api/v1/donations/${donationId}/cancel`)
        .set(auth(adminToken))
        .send({ reason: 'Again' })
        .expect(409);
      expect(errorOf(res)).toMatch(/already cancelled/i);
    });

    it('drops a cancelled receipt out of the money and keeps it in the count', async () => {
      const res = await server()
        .get('/api/v1/donations/reports/summary')
        .set(auth(adminToken))
        .query({ from: day(-1), to: day(1) })
        .expect(200);
      const totals = dataOf<{
        totals: { total: number; cancelled: number; cancelledAmount: number };
      }>(res).totals;

      expect(totals.cancelled).toBeGreaterThanOrEqual(1);
      expect(totals.cancelledAmount).toBeGreaterThanOrEqual(25000);
      // The 25,000 that was cancelled is not in the raised figure; the
      // 20,000 in-kind gift still is.
      expect(totals.total).toBe(20000);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // The SLA sweep
  // ══════════════════════════════════════════════════════════════════

  describe('the SLA escalation sweep', () => {
    it('chases a breached ticket exactly once', async () => {
      const created = await server()
        .post('/api/v1/tickets')
        .set(auth(adminToken))
        .send({
          type: 'COMPLAINT',
          category: 'FACILITY',
          subject: `${NAME} lingering complaint`,
          description: 'Nobody has looked at this.',
          raisedByType: 'PUBLIC',
          contactPhone: '01700001111',
          priority: 'URGENT',
        })
        .expect(201);
      const id = dataOf<{ id: string }>(created).id;

      // Age it past the URGENT SLA (24 h by default).
      await prisma.ticket.update({
        where: { id },
        data: { createdAt: new Date(Date.now() - 40 * 3_600_000) },
      });

      const job = app.get(TicketSlaJob);

      const first = await job.runForSchool(DEFAULT_SCHOOL_ID);
      expect(first.escalated).toBeGreaterThanOrEqual(1);

      // `escalated_at` is the dedupe — the M12 column-as-dedupe pattern.
      // Without it an hourly sweep pages the head hourly.
      const second = await job.runForSchool(DEFAULT_SCHOOL_ID);
      expect(second.escalated).toBe(0);

      const ticket = await prisma.ticket.findUnique({ where: { id } });
      expect(ticket!.escalatedAt).not.toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // The day-end sweep
  // ══════════════════════════════════════════════════════════════════

  describe('the visitor day-end sweep', () => {
    it('signs out everybody still inside and FLAGS that a machine did it', async () => {
      const res = await server()
        .post('/api/v1/visitors')
        .set(auth(officeToken))
        .send({
          name: `${NAME} Forgot To Leave`,
          phone: '01700002222',
          purpose: 'MEETING',
        })
        .expect(201);
      const id = dataOf<{ id: string }>(res).id;

      const job = app.get(VisitorAutoCheckoutJob);
      const result = await job.runForSchool(
        DEFAULT_SCHOOL_ID,
        new Date(),
        true,
      );
      expect(result.checkedOut).toBeGreaterThanOrEqual(1);

      const visitor = await prisma.visitor.findUnique({ where: { id } });
      expect(visitor!.checkOut).not.toBeNull();
      expect(visitor!.autoCheckedOut).toBe(true);
    });

    /** A multi-day pass is legitimately still admitted tomorrow. */
    it('leaves a live multi-day pass alone', async () => {
      const res = await server()
        .post('/api/v1/visitors')
        .set(auth(officeToken))
        .send({
          name: `${NAME} Multi Day`,
          phone: '01700003333',
          purpose: 'OFFICIAL',
          validUntil: day(3),
        })
        .expect(201);
      const id = dataOf<{ id: string }>(res).id;

      const job = app.get(VisitorAutoCheckoutJob);
      await job.runForSchool(DEFAULT_SCHOOL_ID, new Date(), true);

      const visitor = await prisma.visitor.findUnique({ where: { id } });
      expect(visitor!.checkOut).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Separation of duties — the seeded roles meeting live requests
  // ══════════════════════════════════════════════════════════════════

  describe('separation of duties', () => {
    it('lets the office run the desk', async () => {
      await server().get('/api/v1/tickets').set(auth(officeToken)).expect(200);
      await server()
        .get('/api/v1/visitors/inside')
        .set(auth(officeToken))
        .expect(200);
      await server().get('/api/v1/alumni').set(auth(officeToken)).expect(200);
      await server()
        .get('/api/v1/donations')
        .set(auth(officeToken))
        .expect(200);
    });

    it('refuses the office the three codes it deliberately lacks', async () => {
      // `ticket.delete` — deciding a complaint never happened.
      const anyTicket = await prisma.ticket.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, subject: { startsWith: NAME } },
      });
      await server()
        .delete(`/api/v1/tickets/${anyTicket!.id}`)
        .set(auth(officeToken))
        .expect(403);

      // `alumni.approve` — deciding who a former student is.
      const pending = await prisma.alumni.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
      });
      await server()
        .put(`/api/v1/alumni/${pending!.id}/decision`)
        .set(auth(officeToken))
        .send({ status: 'APPROVED' })
        .expect(403);

      // `alumni.donation.cancel` is already asserted in the donation block.
    });

    it('gives a parent no admin surface at all', async () => {
      await server().get('/api/v1/tickets').set(auth(parentToken)).expect(403);
      await server()
        .get('/api/v1/visitors/inside')
        .set(auth(parentToken))
        .expect(403);
      await server()
        .get('/api/v1/donations')
        .set(auth(parentToken))
        .expect(403);
    });
  });
});
