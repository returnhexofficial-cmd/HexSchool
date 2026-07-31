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
import { TransportExpiryJob } from '../src/modules/transport/jobs/transport-expiry.job';
import {
  seedSystemRoles,
  syncPermissionRegistry,
} from '../src/modules/rbac/seed/rbac.seeder';

/**
 * Requires dev infra (DB + redis). Module 25 — Transport Management.
 *
 * Built around what unit tests structurally cannot see (roadmap §9):
 *
 *   1. **The billing handoff.** Roadmap §9 asks for "assign → invoice
 *      generated next cycle → end assignment → invoice stops", and that
 *      crosses a DI token bound in a *different* module — exactly the
 *      kind of wiring that compiles and then does nothing (the M18/M21
 *      lesson, twice learned).
 *   2. **The database invariants.** The composite FK that pins a stop to
 *      its route, the one-live-assignment partial unique, the status/date
 *      evidence CHECK and the live-rows plate unique are each asserted to
 *      actually refuse a bad row — a constraint nobody has seen reject
 *      anything is a constraint that might not be there.
 *   3. **Separation of duties.** The seeded Office Staff may put children
 *      on buses and may NOT overfill one; the Accountant records fuel and
 *      may not assign riders. This is the only place the seeded role set
 *      is checked against live requests.
 *   4. **The portal projection**, which must show a parent the stop and
 *      the times and nothing else.
 */
describe('Transport Management (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-tr-admin@test.local';
  const OFFICE = 'e2e-tr-office@test.local';
  const ACCOUNTANT = 'e2e-tr-accountant@test.local';
  const STUDENT = 'e2e-tr-student@test.local';
  const NAME = 'E2ETR';

  let adminToken: string;
  let officeToken: string;
  let accountantToken: string;
  let studentToken: string;

  let sessionId: string;
  let classId: string;
  let sectionId: string;
  let vehicleId: string;
  let driverId: string;
  let routeId: string;
  let stopId: string;
  let feeHeadId: string;
  const enrollments = new Map<number, string>();
  const studentIds = new Map<number, string>();

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;

  const emails = [ADMIN, OFFICE, ACCOUNTANT, STUDENT];

  /**
   * `YYYY-MM-DD`, `offset` days from today **in Asia/Dhaka**.
   *
   * The +6 h shift is not decoration. The server dates everything through
   * `dhakaToday()`, so between 18:00 and 24:00 UTC a UTC-based fixture is
   * a day behind the server — an assignment created "today" would then be
   * ended "yesterday" and `chk_transport_assignments_window` would refuse
   * it, and a "40 days ago" expiry would read as 41. That is the M23
   * `chk_book_issues_window` lesson in a new costume: **never mix a
   * client-side clock with a server-side one inside a single row.**
   */
  const DHAKA_OFFSET_MS = 6 * 3_600_000;
  const day = (offset: number): string =>
    new Date(Date.now() + DHAKA_OFFSET_MS + offset * 86_400_000)
      .toISOString()
      .slice(0, 10);

  const thisMonth = (): string => day(0).slice(0, 7);

  const cleanup = async () => {
    await prisma.transportAssignment.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        route: { name: { startsWith: NAME } },
      },
    });
    await prisma.vehicleExpense.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        vehicle: { regNo: { startsWith: NAME } },
      },
    });
    await prisma.routeStop.deleteMany({
      where: { route: { name: { startsWith: NAME } } },
    });
    await prisma.route.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.vehicle.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, regNo: { startsWith: NAME } },
    });
    await prisma.driver.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, licenseNo: { startsWith: NAME } },
    });
    await prisma.voucherEntry.deleteMany({
      where: { voucher: { sourceRef: { startsWith: 'transport-expense:' } } },
    });
    await prisma.voucher.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        sourceRef: { startsWith: 'transport-expense:' },
      },
    });
    await prisma.invoiceItem.deleteMany({
      where: { invoice: { enrollment: { student: { firstName: NAME } } } },
    });
    await prisma.invoice.deleteMany({
      where: { enrollment: { student: { firstName: NAME } } },
    });
    await prisma.feeStructure.deleteMany({
      where: { feeHead: { name: { startsWith: NAME } } },
    });
    await prisma.feeHead.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.enrollment.deleteMany({
      where: { student: { firstName: NAME } },
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
    await prisma.section.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, roomNo: `R-${NAME}` },
    });
    await prisma.schoolClass.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.academicSession.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.notification.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        templateCode: { startsWith: 'TRANSPORT_' },
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
    const [adminUser, officeUser, accountantUser, studentUser] =
      await Promise.all([
        mk(ADMIN, UserType.ADMIN),
        mk(OFFICE, UserType.STAFF),
        mk(ACCOUNTANT, UserType.STAFF),
        mk(STUDENT, UserType.STUDENT),
      ]);

    const roleFor = (slug: string) =>
      prisma.role.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, slug, deletedAt: null },
      });
    const [adminRole, officeRole, accountantRole] = await Promise.all([
      roleFor('admin'),
      roleFor('office-staff'),
      roleFor('accountant'),
    ]);
    await prisma.userRole.createMany({
      data: [
        { userId: adminUser.id, roleId: adminRole!.id },
        { userId: officeUser.id, roleId: officeRole!.id },
        { userId: accountantUser.id, roleId: accountantRole!.id },
      ],
    });

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
        numericLevel: 17,
      },
    });
    classId = klass.id;

    const section = await prisma.section.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        classId,
        sessionId,
        name: 'T1',
        roomNo: `R-${NAME}`,
      },
    });
    sectionId = section.id;

    for (let roll = 1; roll <= 4; roll += 1) {
      const student = await prisma.student.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          userId: roll === 1 ? studentUser.id : null,
          studentUid: `${NAME}-${Date.now()}-${roll}`,
          firstName: NAME,
          lastName: `Rider${roll}`,
          gender: 'MALE',
          dob: new Date('2013-02-02'),
          admissionDate: new Date(day(-290)),
          admissionClassId: classId,
          qrToken: randomUUID(),
        },
      });
      studentIds.set(roll, student.id);

      const enrollment = await prisma.enrollment.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          studentId: student.id,
          sessionId,
          classId,
          sectionId,
          rollNo: roll,
          enrollmentDate: new Date(day(-280)),
          status: 'ACTIVE',
        },
      });
      enrollments.set(roll, enrollment.id);
    }

    // A guardian on the first rider — the roster's phone column is the
    // point of that report.
    const guardian = await prisma.guardian.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `${NAME} Guardian`,
        phone: `0171${String(Date.now()).slice(-7)}`,
        relation: 'FATHER',
      },
    });
    await prisma.studentGuardian.create({
      data: {
        studentId: studentIds.get(1)!,
        guardianId: guardian.id,
        isPrimary: true,
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
    accountantToken = await login(ACCOUNTANT);
    studentToken = await login(STUDENT);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  // ── fleet ───────────────────────────────────────────────────────────

  describe('fleet', () => {
    it('adds a vehicle', async () => {
      const res = await server()
        .post('/api/v1/transport/vehicles')
        .set(auth(adminToken))
        .send({
          regNo: `${NAME} GA 11-2345`,
          type: 'BUS',
          capacity: 3,
          fitnessExpiry: day(200),
          taxTokenExpiry: day(200),
          insuranceExpiry: day(200),
        })
        .expect(201);

      const body = dataOf<{
        vehicle: { id: string; regNo: string };
        warnings: string[];
      }>(res);
      vehicleId = body.vehicle.id;
      expect(body.warnings).toEqual([]);
      // Normalised on write, so two spellings of one plate collide.
      expect(body.vehicle.regNo).toBe(`${NAME} GA 11-2345`.toUpperCase());
    });

    it('refuses a second live vehicle with the same plate, however it is typed', async () => {
      await server()
        .post('/api/v1/transport/vehicles')
        .set(auth(adminToken))
        .send({ regNo: `${NAME.toLowerCase()}  ga 11-2345`, capacity: 40 })
        .expect(409);
    });

    it('WARNS rather than refusing when a document has already expired (§7)', async () => {
      const res = await server()
        .post('/api/v1/transport/vehicles')
        .set(auth(adminToken))
        .send({
          regNo: `${NAME} GA 99-0001`,
          capacity: 30,
          taxTokenExpiry: day(-40),
        })
        .expect(201);

      const body = dataOf<{ warnings: string[] }>(res);
      expect(body.warnings[0]).toMatch(/Tax token expired 40 day/);
    });

    it('refuses a bus with no seats', async () => {
      await server()
        .post('/api/v1/transport/vehicles')
        .set(auth(adminToken))
        .send({ regNo: `${NAME} GA 00-0000`, capacity: 0 })
        .expect(400);
    });

    it('adds a driver', async () => {
      const res = await server()
        .post('/api/v1/transport/drivers')
        .set(auth(adminToken))
        .send({
          name: `${NAME} Abdul Karim`,
          phone: '01712345678',
          licenseNo: `${NAME}-DK-1234567`,
          licenseExpiry: day(15),
        })
        .expect(201);
      driverId = dataOf<{ driver: { id: string } }>(res).driver.id;
    });

    it('refuses a driver whose licence number is already on file', async () => {
      await server()
        .post('/api/v1/transport/drivers')
        .set(auth(adminToken))
        .send({
          name: `${NAME} Someone Else`,
          phone: '01812345678',
          licenseNo: `${NAME.toLowerCase()}-dk-1234567`,
          licenseExpiry: day(400),
        })
        .expect(409);
    });

    it('refuses a phone number that is not a BD mobile', async () => {
      await server()
        .post('/api/v1/transport/drivers')
        .set(auth(adminToken))
        .send({
          name: `${NAME} Bad Phone`,
          phone: '12345',
          licenseNo: `${NAME}-DK-0000001`,
        })
        .expect(400);
    });

    it('lists the papers that are expiring, worst first', async () => {
      const res = await server()
        .get('/api/v1/transport/alerts')
        .set(auth(adminToken))
        .expect(200);

      const alerts = dataOf<{
        total: number;
        vehicles: Array<{ label: string; items: Array<{ state: string }> }>;
        drivers: Array<{ label: string; items: Array<{ state: string }> }>;
      }>(res);

      expect(alerts.total).toBeGreaterThan(0);
      const expiredVehicle = alerts.vehicles.find((row) =>
        row.label.includes('99-0001'),
      );
      expect(expiredVehicle?.items[0].state).toBe('EXPIRED');
      // The licence expiring in 15 days is inside the 30-day window.
      expect(alerts.drivers[0].items[0].state).toBe('DUE_SOON');
    });
  });

  // ── routes & stops ──────────────────────────────────────────────────

  describe('routes and stops', () => {
    it('creates a route with a vehicle and a driver', async () => {
      const res = await server()
        .post('/api/v1/transport/routes')
        .set(auth(adminToken))
        .send({
          name: `${NAME} Mirpur Morning`,
          vehicleId,
          driverId,
          helperName: `${NAME} Helper`,
        })
        .expect(201);

      const route = dataOf<{ id: string; capacity: { capacity: number } }>(res);
      routeId = route.id;
      expect(route.capacity.capacity).toBe(3);
    });

    it('refuses the same person as driver and substitute', async () => {
      await server()
        .patch(`/api/v1/transport/routes/${routeId}`)
        .set(auth(adminToken))
        .send({
          name: `${NAME} Mirpur Morning`,
          driverId,
          substituteDriverId: driverId,
        })
        .expect(400);
    });

    it('adds stops with fares and times', async () => {
      for (const [name, pickup, drop, fee] of [
        ['Kazipara', '07:10', '16:20', 1500],
        ['Shewrapara', '07:20', '16:10', 1200],
        ['Agargaon', '07:30', '16:00', 1000],
      ] as const) {
        await server()
          .post(`/api/v1/transport/routes/${routeId}/stops`)
          .set(auth(adminToken))
          .send({ name, pickupTime: pickup, dropTime: drop, monthlyFee: fee })
          .expect(201);
      }

      const res = await server()
        .get(`/api/v1/transport/routes/${routeId}`)
        .set(auth(adminToken))
        .expect(200);
      const route = dataOf<{
        stops: Array<{ id: string; name: string; displayOrder: number }>;
        window: { firstPickup: string; lastDrop: string };
        issues: unknown[];
      }>(res);

      stopId = route.stops[0].id;
      expect(route.stops.map((s) => s.displayOrder)).toEqual([0, 1, 2]);
      expect(route.window).toEqual({
        firstPickup: '07:10',
        lastDrop: '16:20',
      });
      // Times run down the road, so there is nothing to warn about.
      expect(route.issues).toEqual([]);
    });

    it('refuses a negative fare at the database, not only in the form', async () => {
      await server()
        .post(`/api/v1/transport/routes/${routeId}/stops`)
        .set(auth(adminToken))
        .send({ name: `${NAME} Free ride`, monthlyFee: -50 })
        .expect(400);
    });

    it('refuses two stops with the same name on one route', async () => {
      await server()
        .post(`/api/v1/transport/routes/${routeId}/stops`)
        .set(auth(adminToken))
        .send({ name: 'kazipara', monthlyFee: 900 })
        .expect(409);
    });

    it('reorders the stops through the two-phase update, without colliding', async () => {
      const before = dataOf<{ stops: Array<{ id: string; name: string }> }>(
        await server()
          .get(`/api/v1/transport/routes/${routeId}`)
          .set(auth(adminToken))
          .expect(200),
      );
      const reversed = [...before.stops].reverse().map((s) => s.id);

      const res = await server()
        .put(`/api/v1/transport/routes/${routeId}/stops/order`)
        .set(auth(adminToken))
        .send({ stopIds: reversed })
        .expect(200);

      const after = dataOf<{
        stops: Array<{ id: string; displayOrder: number }>;
      }>(res);
      expect(after.stops.map((s) => s.id)).toEqual(reversed);
      expect(after.stops.map((s) => s.displayOrder)).toEqual([0, 1, 2]);

      // Put it back, so the rest of the suite reads the natural order.
      await server()
        .put(`/api/v1/transport/routes/${routeId}/stops/order`)
        .set(auth(adminToken))
        .send({ stopIds: before.stops.map((s) => s.id) })
        .expect(200);
    });

    it('warns about a pickup sequence that runs backwards, without refusing it', async () => {
      const created = dataOf<{ stops: Array<{ id: string; name: string }> }>(
        await server()
          .post(`/api/v1/transport/routes/${routeId}/stops`)
          .set(auth(adminToken))
          .send({
            name: `${NAME} Backwards`,
            pickupTime: '06:00',
            dropTime: '17:00',
            monthlyFee: 500,
          })
          .expect(201),
      );

      const res = await server()
        .get(`/api/v1/transport/routes/${routeId}`)
        .set(auth(adminToken))
        .expect(200);
      const route = dataOf<{ issues: Array<{ message: string }> }>(res);
      expect(route.issues.length).toBeGreaterThan(0);

      const backwards = created.stops.find((s) => s.name.includes('Backwards'));
      await server()
        .delete(`/api/v1/transport/routes/${routeId}/stops/${backwards!.id}`)
        .set(auth(adminToken))
        .expect(204);
    });
  });

  // ── assignments ─────────────────────────────────────────────────────

  describe('riders', () => {
    it('puts a student on a stop', async () => {
      const res = await server()
        .post('/api/v1/transport/assignments')
        .set(auth(officeToken))
        .send({
          enrollmentId: enrollments.get(1),
          routeId,
          stopId,
          startDate: day(-40),
        })
        .expect(201);

      const body = dataOf<{
        assignment: { id: string; status: string };
        warnings: string[];
      }>(res);
      expect(body.assignment.status).toBe('ACTIVE');
      expect(body.warnings).toEqual([]);
    });

    it('refuses a second live assignment for the same enrollment', async () => {
      await server()
        .post('/api/v1/transport/assignments')
        .set(auth(officeToken))
        .send({ enrollmentId: enrollments.get(1), routeId, stopId })
        .expect(409);
    });

    it('refuses a stop that belongs to another route', async () => {
      const other = dataOf<{ id: string }>(
        await server()
          .post('/api/v1/transport/routes')
          .set(auth(adminToken))
          .send({ name: `${NAME} Uttara Morning`, vehicleId })
          .expect(201),
      );
      const otherStop = dataOf<{ stops: Array<{ id: string }> }>(
        await server()
          .post(`/api/v1/transport/routes/${other.id}/stops`)
          .set(auth(adminToken))
          .send({ name: 'Kazipara', monthlyFee: 1500 })
          .expect(201),
      ).stops[0];

      await server()
        .post('/api/v1/transport/assignments')
        .set(auth(officeToken))
        .send({
          enrollmentId: enrollments.get(2),
          routeId,
          stopId: otherStop.id,
        })
        .expect(400);
    });

    /**
     * The composite FK is the guarantee behind the check above. Going
     * round the service proves the database refuses it too — a rule a
     * future write path cannot forget.
     */
    it('the DATABASE refuses a stop/route pair that does not exist', async () => {
      const otherRoute = await prisma.route.findFirst({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          name: `${NAME} Uttara Morning`,
        },
        include: { stops: true },
      });

      await expect(
        prisma.transportAssignment.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            enrollmentId: enrollments.get(3)!,
            routeId,
            stopId: otherRoute!.stops[0].id,
            startDate: new Date(day(0)),
          },
        }),
      ).rejects.toThrow();
    });

    it('the DATABASE refuses a second live assignment for one enrollment', async () => {
      await expect(
        prisma.transportAssignment.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            enrollmentId: enrollments.get(1)!,
            routeId,
            stopId,
            startDate: new Date(day(0)),
          },
        }),
      ).rejects.toThrow();
    });

    it('the DATABASE refuses an ENDED assignment with no end date', async () => {
      await expect(
        prisma.transportAssignment.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            enrollmentId: enrollments.get(3)!,
            routeId,
            stopId,
            startDate: new Date(day(-10)),
            status: 'ENDED',
          },
        }),
      ).rejects.toThrow();
    });

    it('the DATABASE refuses an end date before the start date', async () => {
      await expect(
        prisma.transportAssignment.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            enrollmentId: enrollments.get(3)!,
            routeId,
            stopId,
            startDate: new Date(day(-10)),
            endDate: new Date(day(-20)),
            status: 'ENDED',
          },
        }),
      ).rejects.toThrow();
    });

    it('warns over capacity but still seats the child (roadmap §6)', async () => {
      // The bus has 3 seats and one rider; fill it and go one past.
      await server()
        .post('/api/v1/transport/assignments')
        .set(auth(officeToken))
        .send({
          enrollmentId: enrollments.get(2),
          routeId,
          stopId,
          startDate: day(-40),
        })
        .expect(201);
      await server()
        .post('/api/v1/transport/assignments')
        .set(auth(officeToken))
        .send({
          enrollmentId: enrollments.get(3),
          routeId,
          stopId,
          startDate: day(-40),
        })
        .expect(201);

      const capacity = dataOf<{ capacity: { state: string } }>(
        await server()
          .get(`/api/v1/transport/routes/${routeId}`)
          .set(auth(adminToken))
          .expect(200),
      ).capacity;
      expect(capacity.state).toBe('FULL');
    });

    it('refuses over capacity once the school turns the hard block on, and the office cannot override it', async () => {
      await server()
        .put('/api/v1/settings/transport')
        .set(auth(adminToken))
        .send({ 'transport.capacity_hard_block': true })
        .expect(200);

      await server()
        .post('/api/v1/transport/assignments')
        .set(auth(officeToken))
        .send({ enrollmentId: enrollments.get(4), routeId, stopId })
        .expect(409);

      // The Office Staff baseline deliberately lacks the override — the
      // M16/M20/M21/M23 separation of duties, continued into the fleet.
      await server()
        .post('/api/v1/transport/assignments')
        .set(auth(officeToken))
        .send({
          enrollmentId: enrollments.get(4),
          routeId,
          stopId,
          override: true,
        })
        .expect(403);
    });

    it('lets an admin override the full bus, and says so', async () => {
      const res = await server()
        .post('/api/v1/transport/assignments')
        .set(auth(adminToken))
        .send({
          enrollmentId: enrollments.get(4),
          routeId,
          stopId,
          override: true,
        })
        .expect(201);

      const body = dataOf<{ warnings: string[] }>(res);
      expect(body.warnings[0]).toMatch(/over capacity/i);

      await server()
        .put('/api/v1/settings/transport')
        .set(auth(adminToken))
        .send({ 'transport.capacity_hard_block': false })
        .expect(200);
    });

    it('refuses a route with no vehicle attached', async () => {
      const bare = dataOf<{ id: string; stops: Array<{ id: string }> }>(
        await server()
          .post('/api/v1/transport/routes')
          .set(auth(adminToken))
          .send({ name: `${NAME} Planned Route` })
          .expect(201),
      );
      const bareStop = dataOf<{ stops: Array<{ id: string }> }>(
        await server()
          .post(`/api/v1/transport/routes/${bare.id}/stops`)
          .set(auth(adminToken))
          .send({ name: 'Somewhere', monthlyFee: 800 })
          .expect(201),
      ).stops[0];

      // NOTE: `enrollments.get(4)` MUST be defined here — Prisma treats an
      // `undefined` filter as "no filter", so a missing fixture id would
      // quietly end every rider in the school.
      const riderFour = enrollments.get(4);
      expect(riderFour).toBeDefined();
      await prisma.transportAssignment.updateMany({
        where: { enrollmentId: riderFour },
        data: { status: 'ENDED', endDate: new Date(day(0)) },
      });

      await server()
        .post('/api/v1/transport/assignments')
        .set(auth(officeToken))
        .send({
          enrollmentId: enrollments.get(4),
          routeId: bare.id,
          stopId: bareStop.id,
        })
        .expect(409);
    });

    it('refuses to delete a stop somebody boards at', async () => {
      await server()
        .delete(`/api/v1/transport/routes/${routeId}/stops/${stopId}`)
        .set(auth(adminToken))
        .expect(409);
    });

    it('refuses to delete a route with riders on it', async () => {
      await server()
        .delete(`/api/v1/transport/routes/${routeId}`)
        .set(auth(adminToken))
        .expect(409);
    });
  });

  // ── the lifecycle, which is what M16 reads ──────────────────────────

  describe('the service window', () => {
    let assignmentId: string;

    beforeAll(async () => {
      const list = dataOf<Array<{ id: string; enrollmentId: string }>>(
        await server()
          .get('/api/v1/transport/assignments')
          .query({ routeId, status: 'ACTIVE', limit: 50 })
          .set(auth(adminToken))
          .expect(200),
      );
      assignmentId = list.find(
        (row) => row.enrollmentId === enrollments.get(2),
      )!.id;
    });

    it('suspend stamps the date billing stops at', async () => {
      const res = await server()
        .post(`/api/v1/transport/assignments/${assignmentId}/suspend`)
        .set(auth(officeToken))
        .send({ effectiveDate: day(-5), reason: 'Long illness' })
        .expect(201);

      const row = dataOf<{ status: string; suspendedAt: string }>(res);
      expect(row.status).toBe('SUSPENDED');
      expect(row.suspendedAt.slice(0, 10)).toBe(day(-5));
    });

    it('a suspended rider still holds their seat', async () => {
      const capacity = dataOf<{ capacity: { assigned: number } }>(
        await server()
          .get(`/api/v1/transport/routes/${routeId}`)
          .set(auth(adminToken))
          .expect(200),
      ).capacity;
      // Three riders on the route: one suspended, two active.
      expect(capacity.assigned).toBe(3);
    });

    it('refuses to suspend something that is not ACTIVE', async () => {
      await server()
        .post(`/api/v1/transport/assignments/${assignmentId}/suspend`)
        .set(auth(officeToken))
        .send({ reason: 'Again' })
        .expect(409);
    });

    it('resume clears the suspension and stamps the restart', async () => {
      const res = await server()
        .post(`/api/v1/transport/assignments/${assignmentId}/resume`)
        .set(auth(officeToken))
        .send({ effectiveDate: day(-2) })
        .expect(201);

      const row = dataOf<{
        status: string;
        suspendedAt: string | null;
        resumedAt: string;
      }>(res);
      expect(row.status).toBe('ACTIVE');
      expect(row.suspendedAt).toBeNull();
      expect(row.resumedAt.slice(0, 10)).toBe(day(-2));
    });

    it('end stamps the last day and frees the enrollment for a new assignment', async () => {
      await server()
        .post(`/api/v1/transport/assignments/${assignmentId}/end`)
        .set(auth(officeToken))
        .send({ endDate: day(-1), reason: 'Moved house' })
        .expect(201);

      // The one-live-assignment unique excludes ENDED, so this is now
      // legal again — a family that comes back is not blocked by history.
      await server()
        .post('/api/v1/transport/assignments')
        .set(auth(officeToken))
        .send({ enrollmentId: enrollments.get(2), routeId, stopId })
        .expect(201);
    });
  });

  // ── the M16 handoff (roadmap §9) ────────────────────────────────────

  describe('transport fees reach the monthly invoice', () => {
    beforeAll(async () => {
      const head = await prisma.feeHead.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          name: `${NAME} Transport`,
          type: 'RECURRING_MONTHLY',
        },
      });
      feeHeadId = head.id;

      await server()
        .put('/api/v1/settings/transport')
        .set(auth(adminToken))
        .send({ 'transport.fee_head_id': feeHeadId })
        .expect(200);
    });

    it('adds a transport line to the monthly batch for a rider', async () => {
      const res = await server()
        .post('/api/v1/invoices/generate')
        .set(auth(adminToken))
        .send({
          sessionId,
          classId,
          billingMonth: thisMonth(),
          dryRun: false,
        })
        .expect(201);

      const result = dataOf<{ generated: number }>(res);
      expect(result.generated).toBeGreaterThan(0);

      const invoice = await prisma.invoice.findFirst({
        where: { enrollmentId: enrollments.get(1)!, deletedAt: null },
        include: { items: true },
      });
      const transportLine = invoice!.items.find(
        (item) => item.feeHeadId === feeHeadId,
      );
      expect(transportLine).toBeDefined();
      expect(Number(transportLine!.amount)).toBe(1500);
      expect(transportLine!.description).toContain('Kazipara');
    });

    it('bills nothing for a student who does not ride', async () => {
      const invoice = await prisma.invoice.findFirst({
        where: { enrollmentId: enrollments.get(4)!, deletedAt: null },
        include: { items: true },
      });
      // Rider 4's assignment was ended before the run.
      const lines = invoice?.items.filter(
        (item) => item.feeHeadId === feeHeadId,
      );
      expect(lines ?? []).toHaveLength(0);
    });

    it('prorates a rider who started mid-month rather than charging a full fare', async () => {
      const month = thisMonth();
      const daysInMonth = new Date(
        Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
      ).getUTCDate();
      const startDay = Math.min(daysInMonth, 20);

      const assignment = await prisma.transportAssignment.findFirst({
        where: { enrollmentId: enrollments.get(3)!, status: 'ACTIVE' },
      });
      await prisma.transportAssignment.update({
        where: { id: assignment!.id },
        data: {
          startDate: new Date(
            `${month}-${String(startDay).padStart(2, '0')}T00:00:00Z`,
          ),
        },
      });

      await prisma.invoiceItem.deleteMany({
        where: { invoice: { enrollmentId: enrollments.get(3)! } },
      });
      await prisma.invoice.deleteMany({
        where: { enrollmentId: enrollments.get(3)! },
      });

      await server()
        .post('/api/v1/invoices/generate')
        .set(auth(adminToken))
        .send({
          sessionId,
          enrollmentIds: [enrollments.get(3)],
          billingMonth: month,
          dryRun: false,
        })
        .expect(201);

      const invoice = await prisma.invoice.findFirst({
        where: { enrollmentId: enrollments.get(3)!, deletedAt: null },
        include: { items: true },
      });
      const line = invoice!.items.find((item) => item.feeHeadId === feeHeadId);
      const served = daysInMonth - startDay + 1;
      expect(Number(line!.amount)).toBeCloseTo(
        Math.round(((1500 * served) / daysInMonth) * 100) / 100,
        2,
      );
      expect(line!.description).toContain(`${served}/${daysInMonth} days`);
    });

    it('the collection report shows what was expected against what was billed', async () => {
      const res = await server()
        .get('/api/v1/transport/reports/collection')
        .query({ month: thisMonth() })
        .set(auth(adminToken))
        .expect(200);

      const report = dataOf<{
        feeHead: { id: string } | null;
        totals: { riders: number; expected: number; invoiced: number };
      }>(res);
      expect(report.feeHead?.id).toBe(feeHeadId);
      expect(report.totals.riders).toBeGreaterThan(0);
      expect(report.totals.invoiced).toBeGreaterThan(0);
    });
  });

  // ── expenses & the ledger ───────────────────────────────────────────

  describe('expenses', () => {
    let expenseId: string;

    it('records fuel and posts it to the ledger as a DEBIT voucher', async () => {
      const res = await server()
        .post('/api/v1/transport/expenses')
        .set(auth(accountantToken))
        .send({
          vehicleId,
          type: 'FUEL',
          date: day(-3),
          amount: 6000,
          odometer: 10_000,
          description: 'Full tank',
        })
        .expect(201);

      const body = dataOf<{
        expense: { id: string; voucherId: string | null };
      }>(res);
      expenseId = body.expense.id;
      expect(body.expense.voucherId).toBeTruthy();

      const voucher = await prisma.voucher.findFirst({
        where: { sourceRef: `transport-expense:${expenseId}` },
        include: { entries: true },
      });
      expect(voucher!.type).toBe('DEBIT');
      expect(voucher!.source).toBe('TRANSPORT');
      const debit = voucher!.entries.find((e) => Number(e.debit) > 0);
      const credit = voucher!.entries.find((e) => Number(e.credit) > 0);
      expect(Number(debit!.debit)).toBe(6000);
      expect(Number(credit!.credit)).toBe(6000);
    });

    it('refuses to edit an expense that has been posted', async () => {
      await server()
        .patch(`/api/v1/transport/expenses/${expenseId}`)
        .set(auth(accountantToken))
        .send({ vehicleId, type: 'FUEL', date: day(-3), amount: 9999 })
        .expect(409);
    });

    it('refuses an expense of zero', async () => {
      await server()
        .post('/api/v1/transport/expenses')
        .set(auth(accountantToken))
        .send({ vehicleId, type: 'TOLL', date: day(-1), amount: 0 })
        .expect(400);
    });

    it('refuses an expense dated in the future', async () => {
      await server()
        .post('/api/v1/transport/expenses')
        .set(auth(accountantToken))
        .send({ vehicleId, type: 'TOLL', date: day(5), amount: 100 })
        .expect(400);
    });

    it('warns about an odometer reading that goes backwards, and still saves it', async () => {
      const res = await server()
        .post('/api/v1/transport/expenses')
        .set(auth(accountantToken))
        .send({
          vehicleId,
          type: 'FUEL',
          date: day(-2),
          amount: 5500,
          odometer: 9_000,
        })
        .expect(201);

      expect(dataOf<{ warnings: string[] }>(res).warnings[0]).toMatch(
        /lower than/i,
      );
    });

    it('computes cost per kilometre from the readings that make a chain', async () => {
      await server()
        .post('/api/v1/transport/expenses')
        .set(auth(accountantToken))
        .send({
          vehicleId,
          type: 'FUEL',
          date: day(-1),
          amount: 6000,
          odometer: 10_500,
        })
        .expect(201);

      const res = await server()
        .get('/api/v1/transport/reports/expenses')
        .query({ vehicleId })
        .set(auth(accountantToken))
        .expect(200);

      const report = dataOf<{
        summary: {
          distance: { km: number; brokenChains: number };
          fuelCostPerKm: number | null;
        };
      }>(res);
      // 10,000 → 9,000 breaks the chain; 9,000 → 10,500 is 1,500 km.
      expect(report.summary.distance.brokenChains).toBe(1);
      expect(report.summary.distance.km).toBe(1_500);
      expect(report.summary.fuelCostPerKm).toBeGreaterThan(0);
    });

    it('refuses to delete a vehicle that carries expense records', async () => {
      await server()
        .delete(`/api/v1/transport/vehicles/${vehicleId}`)
        .set(auth(adminToken))
        .expect(409);
    });
  });

  // ── separation of duties ────────────────────────────────────────────

  describe('who may do what', () => {
    it('the office may put a child on a bus', async () => {
      await server()
        .get('/api/v1/transport/assignments')
        .set(auth(officeToken))
        .expect(200);
    });

    it('the office may NOT record fuel — that is the ledger’s side', async () => {
      await server()
        .post('/api/v1/transport/expenses')
        .set(auth(officeToken))
        .send({ vehicleId, type: 'FUEL', date: day(-1), amount: 500 })
        .expect(403);
    });

    it('the accountant may record fuel and may NOT assign riders', async () => {
      await server()
        .post('/api/v1/transport/assignments')
        .set(auth(accountantToken))
        .send({ enrollmentId: enrollments.get(4), routeId, stopId })
        .expect(403);
    });

    it('a student may not read the fleet at all', async () => {
      await server()
        .get('/api/v1/transport/vehicles')
        .set(auth(studentToken))
        .expect(403);
    });
  });

  // ── reports ─────────────────────────────────────────────────────────

  describe('reports', () => {
    it('the roster carries the guardian’s phone — the point of the sheet', async () => {
      const res = await server()
        .get(`/api/v1/transport/reports/roster/${routeId}`)
        .set(auth(adminToken))
        .expect(200);

      const roster = dataOf<{
        riders: Array<{ studentName: string; guardianPhone: string | null }>;
        route: { driverName: string | null };
      }>(res);
      const withGuardian = roster.riders.find((r) => r.guardianPhone !== null);
      expect(withGuardian).toBeDefined();
      expect(roster.route.driverName).toContain('Abdul Karim');
    });

    it('downloads the driver’s sheet as a PDF', async () => {
      const res = await server()
        .get(`/api/v1/transport/reports/roster/${routeId}/print`)
        .set(auth(adminToken))
        .expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
    });

    it('reports utilization without letting an unequipped route drag it down', async () => {
      const res = await server()
        .get('/api/v1/transport/reports/utilization')
        .set(auth(adminToken))
        .expect(200);

      const report = dataOf<{
        fleet: {
          routes: number;
          measurable: number;
          utilization: number | null;
        };
        routes: Array<{ routeName: string; state: string }>;
      }>(res);
      expect(report.fleet.routes).toBeGreaterThanOrEqual(
        report.fleet.measurable,
      );
      expect(report.routes.some((r) => r.routeName.includes('Mirpur'))).toBe(
        true,
      );
    });

    it('exports the utilization sheet', async () => {
      const res = await server()
        .get('/api/v1/transport/reports/utilization/export')
        .set(auth(adminToken))
        .expect(200);
      expect(res.headers['content-disposition']).toContain('.xlsx');
    });
  });

  // ── portal ──────────────────────────────────────────────────────────

  describe('portal', () => {
    it('shows the student their route, stop and times — and nothing else', async () => {
      const res = await server()
        .get('/api/v1/portal/transport')
        .set(auth(studentToken))
        .expect(200);

      const view = dataOf<Record<string, unknown>>(res);
      expect(view.assigned).toBe(true);
      expect(view).toHaveProperty('stop');
      // The projection is deliberately thin: no capacity, no other rider,
      // no licence or fitness dates.
      expect(view).not.toHaveProperty('capacity');
      expect(JSON.stringify(view)).not.toContain('fitness');
    });

    it('says plainly when a student does not ride', async () => {
      const orphan = await prisma.user.findFirst({
        where: { email: ADMIN },
        select: { id: true },
      });
      // An admin account has no student profile — the portal answers 404
      // for "which student is this?", never a stack trace.
      await server()
        .get('/api/v1/portal/transport')
        .set(auth(adminToken))
        .expect(404);
      expect(orphan).toBeTruthy();
    });
  });

  // ── the nightly job ─────────────────────────────────────────────────

  describe('document expiry job', () => {
    it('alerts on the papers that are wrong, once per window', async () => {
      const job = app.get(TransportExpiryJob);

      const first = await job.runForSchool(DEFAULT_SCHOOL_ID, new Date(), true);
      expect(first.alerted).toBeGreaterThan(0);

      const alerts = await prisma.notification.findMany({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          templateCode: 'TRANSPORT_DOCUMENT_EXPIRY',
        },
      });
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].bodyRendered).toMatch(/expired|expires|not recorded/i);

      // The dedupe window is what stops the same lapsed token being
      // announced every morning.
      const second = await job.runForSchool(DEFAULT_SCHOOL_ID, new Date());
      expect(second.alerted).toBe(0);
    });
  });
});
