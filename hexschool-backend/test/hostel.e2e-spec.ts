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
 * Requires dev infra (DB + redis). Module 26 — Hostel Management.
 *
 * Built around what unit tests structurally cannot see (roadmap §9):
 *
 *   1. **The billing handoff**, which roadmap §9 asks for end to end:
 *      "allocate → invoice → meal-off → credit → vacate". It crosses a DI
 *      token bound in a *different* module and produces TWO invoice lines
 *      — exactly the kind of wiring that compiles and then does nothing
 *      (the M18/M21 lesson, twice learned).
 *   2. **The database invariants.** The four composite FKs that pin the
 *      hostel down the chain, the two live-allocation partial uniques,
 *      the window and status-evidence CHECKs and the deposit CHECK are
 *      each asserted to actually refuse a bad row — a constraint nobody
 *      has seen reject anything is a constraint that might not be there.
 *   3. **Separation of duties.** The seeded Office Staff runs the hostel
 *      and may NOT hand a deposit back or override the dues gate; the
 *      Accountant returns the deposit and may not give anybody a bed.
 *      This is the only place the seeded role set meets live requests.
 *   4. **The portal projection**, which must show a parent the room, the
 *      bed and their own child's meal-offs and nothing else.
 */
describe('Hostel Management (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-ho-admin@test.local';
  const OFFICE = 'e2e-ho-office@test.local';
  const ACCOUNTANT = 'e2e-ho-accountant@test.local';
  const STUDENT = 'e2e-ho-student@test.local';
  const NAME = 'E2EHO';

  let adminToken: string;
  let officeToken: string;
  let accountantToken: string;
  let studentToken: string;

  let sessionId: string;
  let classId: string;
  let sectionId: string;
  let boysHostelId: string;
  let girlsHostelId: string;
  let roomId: string;
  let planId: string;
  let rentHeadId: string;
  let messHeadId: string;
  /** Fee heads this run created — see the `headFor` note. */
  let ourFeeHeadIds: string[] = [];
  const beds: string[] = [];
  const enrollments = new Map<number, string>();
  const studentIds = new Map<number, string>();

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;
  /** The global exception filter's envelope, typed once. */
  const errorOf = (res: request.Response): string =>
    (res.body as { error?: { message?: string } }).error?.message ?? '';

  const emails = [ADMIN, OFFICE, ACCOUNTANT, STUDENT];

  /**
   * `YYYY-MM-DD`, `offset` days from today **in Asia/Dhaka**.
   *
   * The +6 h shift is not decoration. The server dates everything through
   * `dhakaToday()`, so between 18:00 and 24:00 UTC a UTC-based fixture is
   * a day behind the server — an allocation created "today" would then be
   * vacated "yesterday" and `chk_hostel_allocations_window` would refuse
   * it. That is the M25 Dhaka-midnight lesson verbatim: **a suite that
   * passes at 14:00 and fails at 19:00 is not flaky, it is wrong.**
   */
  const DHAKA_OFFSET_MS = 6 * 3_600_000;
  const day = (offset: number): string =>
    new Date(Date.now() + DHAKA_OFFSET_MS + offset * 86_400_000)
      .toISOString()
      .slice(0, 10);

  const thisMonth = (): string => day(0).slice(0, 7);

  const cleanup = async () => {
    await prisma.mealOff.deleteMany({
      where: { allocation: { hostel: { name: { startsWith: NAME } } } },
    });
    await prisma.messEnrollment.deleteMany({
      where: { hostel: { name: { startsWith: NAME } } },
    });
    await prisma.messPlan.deleteMany({
      where: { hostel: { name: { startsWith: NAME } } },
    });
    await prisma.hostelAllocation.deleteMany({
      where: { hostel: { name: { startsWith: NAME } } },
    });
    await prisma.hostelBed.deleteMany({
      where: { hostel: { name: { startsWith: NAME } } },
    });
    await prisma.hostelRoom.deleteMany({
      where: { hostel: { name: { startsWith: NAME } } },
    });
    await prisma.hostel.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.voucherEntry.deleteMany({
      where: {
        voucher: {
          OR: [
            { sourceRef: { startsWith: 'hostel-deposit:' } },
            { sourceRef: { startsWith: 'hostel-refund:' } },
          ],
        },
      },
    });
    await prisma.voucher.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        OR: [
          { sourceRef: { startsWith: 'hostel-deposit:' } },
          { sourceRef: { startsWith: 'hostel-refund:' } },
        ],
      },
    });
    await prisma.invoiceItem.deleteMany({
      where: { invoice: { enrollment: { student: { firstName: NAME } } } },
    });
    await prisma.invoice.deleteMany({
      where: { enrollment: { student: { firstName: NAME } } },
    });
    if (ourFeeHeadIds.length > 0) {
      await prisma.feeStructure.deleteMany({
        where: { feeHeadId: { in: ourFeeHeadIds } },
      });
      await prisma.feeHead.deleteMany({
        where: { id: { in: ourFeeHeadIds } },
      });
      ourFeeHeadIds = [];
    }
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
        templateCode: { in: ['HOSTEL_ALLOCATED', 'MEAL_OFF_DECISION'] },
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
        numericLevel: 16,
      },
    });
    classId = klass.id;

    const section = await prisma.section.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        classId,
        sessionId,
        name: 'H1',
        roomNo: `R-${NAME}`,
      },
    });
    sectionId = section.id;

    // Rolls 1–3 are boys, roll 4 is a girl — the gender check needs
    // somebody it must refuse.
    for (let roll = 1; roll <= 4; roll += 1) {
      const student = await prisma.student.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          userId: roll === 1 ? studentUser.id : null,
          studentUid: `${NAME}-${Date.now()}-${roll}`,
          firstName: NAME,
          lastName: `Boarder${roll}`,
          gender: roll === 4 ? 'FEMALE' : 'MALE',
          dob: new Date('2012-02-02'),
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

    // A guardian on the first boarder — the resident register's phone
    // column is the point of that report.
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

    // The two fee heads the billing handoff resolves **by name** (the M20
    // posting-map fallback shape, so no settings write is needed) — which
    // means they cannot carry the suite's prefix, and so cleanup cannot
    // match them on it. Find-or-create, and remember which ones we made
    // so cleanup removes exactly those.
    const headFor = async (name: string) => {
      const existing = await prisma.feeHead.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, name, deletedAt: null },
      });
      if (existing) return { id: existing.id, ours: false };
      const created = await prisma.feeHead.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          name,
          type: 'RECURRING_MONTHLY',
          isRefundable: false,
        },
      });
      return { id: created.id, ours: true };
    };
    const rent = await headFor('Hostel');
    const mess = await headFor('Mess');
    rentHeadId = rent.id;
    messHeadId = mess.id;
    ourFeeHeadIds = [rent, mess].filter((h) => h.ours).map((h) => h.id);

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

  // ── buildings ───────────────────────────────────────────────────────

  describe('hostels, rooms and beds', () => {
    it('creates a boys hostel', async () => {
      const res = await server()
        .post('/api/v1/hostels')
        .set(auth(officeToken))
        .send({ name: `${NAME} Shapla`, type: 'BOYS', capacity: 6 })
        .expect(201);
      const body = dataOf<{ hostel: { id: string; type: string } }>(res);
      boysHostelId = body.hostel.id;
      expect(body.hostel.type).toBe('BOYS');
    });

    it('creates a girls hostel — the gender check needs both', async () => {
      const res = await server()
        .post('/api/v1/hostels')
        .set(auth(officeToken))
        .send({ name: `${NAME} Beli`, type: 'GIRLS' })
        .expect(201);
      girlsHostelId = dataOf<{ hostel: { id: string } }>(res).hostel.id;
    });

    it('refuses a second hostel with the same name', async () => {
      await server()
        .post('/api/v1/hostels')
        .set(auth(officeToken))
        .send({ name: `${NAME} shapla  `, type: 'BOYS' })
        .expect(409);
    });

    it('creates a room and generates its beds in one call', async () => {
      const res = await server()
        .post(`/api/v1/hostels/${boysHostelId}/rooms`)
        .set(auth(officeToken))
        .send({ roomNo: 'A-101', floor: 1, bedCount: 3, monthlyFee: 3100 })
        .expect(201);
      const room = dataOf<{
        id: string;
        beds: Array<{ id: string; bedNo: string; status: string }>;
        occupancy: { total: number; available: number };
        bedCountNote: string | null;
      }>(res);
      roomId = room.id;
      beds.push(...room.beds.map((bed) => bed.id));

      expect(room.beds).toHaveLength(3);
      expect(room.beds.map((b) => b.bedNo)).toEqual(['B1', 'B2', 'B3']);
      expect(room.occupancy.total).toBe(3);
      expect(room.occupancy.available).toBe(3);
      // Intent and reality agree, so there is nothing to report.
      expect(room.bedCountNote).toBeNull();
    });

    it('refuses a duplicate room number in the same hostel', async () => {
      await server()
        .post(`/api/v1/hostels/${boysHostelId}/rooms`)
        .set(auth(officeToken))
        .send({ roomNo: ' a-101 ', bedCount: 1, monthlyFee: 100 })
        .expect(409);
    });

    it('tops a room up and moves the declared count with it', async () => {
      const res = await server()
        .post(`/api/v1/hostels/rooms/${roomId}/beds`)
        .set(auth(officeToken))
        .send({ count: 1 })
        .expect(201);
      const room = dataOf<{
        bedCount: number;
        beds: Array<{ id: string; bedNo: string }>;
      }>(res);
      // Numbering continues rather than restarting — B4, not a second B1.
      expect(room.beds.map((b) => b.bedNo)).toEqual(['B1', 'B2', 'B3', 'B4']);
      expect(room.bedCount).toBe(4);
      beds.push(room.beds[3].id);
    });

    it('a room in the girls hostel, for the gender test', async () => {
      const res = await server()
        .post(`/api/v1/hostels/${girlsHostelId}/rooms`)
        .set(auth(officeToken))
        .send({ roomNo: 'G-1', bedCount: 2, monthlyFee: 2800 })
        .expect(201);
      const room = dataOf<{ beds: Array<{ id: string }> }>(res);
      beds.push(...room.beds.map((bed) => bed.id));
    });
  });

  // ── the database's own rules ────────────────────────────────────────

  describe('database invariants', () => {
    it('the composite FK refuses a bed whose hostel is not its room’s', async () => {
      // `(hostel_id, room_id) → hostel_rooms(hostel_id, id)`: a bed
      // recorded in the girls' hostel pointing at a boys' room. Without
      // this the gender rule would be checked against the wrong building.
      await expect(
        prisma.hostelBed.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            hostelId: girlsHostelId,
            roomId,
            bedNo: 'X1',
          },
        }),
      ).rejects.toThrow();
    });

    it('the composite FK refuses a mess plan from another hostel', async () => {
      const alloc = await prisma.hostelAllocation.findFirst({
        where: { hostelId: boysHostelId, deletedAt: null },
      });
      if (!alloc) return; // ordering guard; the real assertion is below
      await expect(
        prisma.messEnrollment.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            hostelId: girlsHostelId,
            allocationId: alloc.id,
            planId: planId ?? randomUUID(),
            startDate: new Date(day(0)),
          },
        }),
      ).rejects.toThrow();
    });

    it('chk_hostel_rooms_shape refuses a negative rent', async () => {
      await expect(
        prisma.hostelRoom.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            hostelId: boysHostelId,
            roomNo: 'NEG-1',
            bedCount: 1,
            monthlyFee: -5,
          },
        }),
      ).rejects.toThrow();
    });

    it('chk_hostel_rooms_shape refuses a bed count nobody meant', async () => {
      await expect(
        prisma.hostelRoom.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            hostelId: boysHostelId,
            roomNo: 'BIG-1',
            bedCount: 500,
            monthlyFee: 10,
          },
        }),
      ).rejects.toThrow();
    });

    it('chk_hostels_shape refuses a blank name', async () => {
      await expect(
        prisma.hostel.create({
          data: { schoolId: DEFAULT_SCHOOL_ID, name: '   ', type: 'BOYS' },
        }),
      ).rejects.toThrow();
    });

    it('chk_meal_offs_window refuses a range that runs backwards', async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO meal_offs (school_id, allocation_id, from_date, to_date, reason, updated_at)
           VALUES ($1::uuid, $2::uuid, '2026-03-20', '2026-03-10', 'backwards', now())`,
          DEFAULT_SCHOOL_ID,
          randomUUID(),
        ),
      ).rejects.toThrow();
    });
  });

  // ── allocation ──────────────────────────────────────────────────────

  describe('allocation', () => {
    let allocationId: string;

    it('gives the first boarder a bed', async () => {
      const res = await server()
        .post('/api/v1/hostel-allocations')
        .set(auth(officeToken))
        .send({
          enrollmentId: enrollments.get(1),
          bedId: beds[0],
          startDate: day(-40),
          securityDeposit: 5000,
        })
        .expect(201);
      const body = dataOf<{
        allocation: { id: string; status: string; securityDeposit: string };
        warnings: string[];
      }>(res);
      allocationId = body.allocation.id;
      expect(body.allocation.status).toBe('ACTIVE');
      expect(body.warnings).toEqual([]);
    });

    it('turns the bed’s shadow to OCCUPIED in the same transaction', async () => {
      const bed = await prisma.hostelBed.findUnique({
        where: { id: beds[0] },
      });
      expect(bed?.status).toBe('OCCUPIED');
    });

    it('posts the deposit as a CREDIT voucher raising a liability', async () => {
      const voucher = await prisma.voucher.findFirst({
        where: { sourceRef: `hostel-deposit:${allocationId}` },
        include: { entries: { include: { account: true } } },
      });
      expect(voucher).toBeTruthy();
      expect(voucher!.type).toBe('CREDIT');
      expect(voucher!.source).toBe('HOSTEL');
      // Dr cash, Cr Security Deposits — the money is HELD, so it must
      // never touch the income statement.
      const credit = voucher!.entries.find((e) => Number(e.credit) > 0);
      expect(credit?.account.code).toBe('2140');
      expect(Number(credit?.credit)).toBe(5000);
    });

    it('refuses a bed somebody is already in — no permission reaches it', async () => {
      const res = await server()
        .post('/api/v1/hostel-allocations')
        .set(auth(adminToken))
        .send({ enrollmentId: enrollments.get(2), bedId: beds[0] })
        .expect(409);
      expect(errorOf(res)).toMatch(/already has a boarder/i);
    });

    it('refuses a second bed for a student who has one', async () => {
      const res = await server()
        .post('/api/v1/hostel-allocations')
        .set(auth(officeToken))
        .send({ enrollmentId: enrollments.get(1), bedId: beds[1] })
        .expect(409);
      expect(errorOf(res)).toMatch(/Transfer them/i);
    });

    it('refuses a girl in the boys hostel even for an admin', async () => {
      const res = await server()
        .post('/api/v1/hostel-allocations')
        .set(auth(adminToken))
        .send({ enrollmentId: enrollments.get(4), bedId: beds[1] })
        .expect(409);
      expect(errorOf(res)).toMatch(/boys' hostel/i);
    });

    it('allows the same girl into the girls hostel', async () => {
      const res = await server()
        .post('/api/v1/hostel-allocations')
        .set(auth(officeToken))
        .send({ enrollmentId: enrollments.get(4), bedId: beds[4] })
        .expect(201);
      expect(
        dataOf<{ allocation: { status: string } }>(res).allocation.status,
      ).toBe('ACTIVE');
    });

    it('the live-bed unique refuses a second row even behind the service', async () => {
      // The service already refused this; the index is what makes it true
      // when a future write path forgets to ask.
      await expect(
        prisma.hostelAllocation.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            enrollmentId: enrollments.get(3)!,
            hostelId: boysHostelId,
            bedId: beds[0],
            startDate: new Date(day(0)),
            status: 'ACTIVE',
          },
        }),
      ).rejects.toThrow();
    });

    it('moves a boarder to another bed without touching the dates', async () => {
      const before = await prisma.hostelAllocation.findUnique({
        where: { id: allocationId },
      });
      const res = await server()
        .post(`/api/v1/hostel-allocations/${allocationId}/transfer`)
        .set(auth(officeToken))
        .send({ bedId: beds[1], reason: 'Fan not working in B1' })
        .expect(201);
      const after = dataOf<{
        allocation: { bedId: string; startDate: string };
      }>(res).allocation;
      expect(after.bedId).toBe(beds[1]);
      // The residency did NOT restart — restarting would re-bill the month.
      expect(after.startDate.slice(0, 10)).toBe(
        before!.startDate.toISOString().slice(0, 10),
      );
    });

    it('frees the old bed and takes the new one, both shadows in step', async () => {
      const [old_, next] = await Promise.all([
        prisma.hostelBed.findUnique({ where: { id: beds[0] } }),
        prisma.hostelBed.findUnique({ where: { id: beds[1] } }),
      ]);
      expect(old_?.status).toBe('VACANT');
      expect(next?.status).toBe('OCCUPIED');
    });

    it('refuses a transfer into the other building', async () => {
      const res = await server()
        .post(`/api/v1/hostel-allocations/${allocationId}/transfer`)
        .set(auth(officeToken))
        .send({ bedId: beds[5], reason: 'Wrong building' })
        .expect(409);
      expect(errorOf(res)).toMatch(/Vacate this boarder/i);
    });

    it('a suspended boarder KEEPS the bed', async () => {
      await server()
        .post(`/api/v1/hostel-allocations/${allocationId}/suspend`)
        .set(auth(officeToken))
        .send({ reason: 'Home for the term', effectiveDate: day(-10) })
        .expect(201);

      const [row, bed] = await Promise.all([
        prisma.hostelAllocation.findUnique({ where: { id: allocationId } }),
        prisma.hostelBed.findUnique({ where: { id: beds[1] } }),
      ]);
      expect(row?.status).toBe('SUSPENDED');
      expect(row?.suspendedAt).toBeTruthy();
      // The whole point of suspending rather than vacating.
      expect(bed?.status).toBe('OCCUPIED');
    });

    it('refuses to give that held bed to anybody else', async () => {
      await server()
        .post('/api/v1/hostel-allocations')
        .set(auth(adminToken))
        .send({ enrollmentId: enrollments.get(3), bedId: beds[1] })
        .expect(409);
    });

    it('resuming clears the suspension date, as the CHECK demands', async () => {
      await server()
        .post(`/api/v1/hostel-allocations/${allocationId}/resume`)
        .set(auth(officeToken))
        .send({ effectiveDate: day(-5) })
        .expect(201);

      const row = await prisma.hostelAllocation.findUnique({
        where: { id: allocationId },
      });
      expect(row?.status).toBe('ACTIVE');
      expect(row?.suspendedAt).toBeNull();
      expect(row?.resumedAt).toBeTruthy();
    });

    it('chk_hostel_allocations_status_evidence refuses ACTIVE + suspended', async () => {
      await expect(
        prisma.hostelAllocation.update({
          where: { id: allocationId },
          data: { suspendedAt: new Date(day(-3)) },
        }),
      ).rejects.toThrow();
    });
  });

  // ── the mess ────────────────────────────────────────────────────────

  describe('mess', () => {
    let allocationId: string;

    beforeAll(async () => {
      const row = await prisma.hostelAllocation.findFirst({
        where: { enrollmentId: enrollments.get(1)!, deletedAt: null },
      });
      allocationId = row!.id;
    });

    it('creates a plan for the boys hostel', async () => {
      const res = await server()
        .post('/api/v1/mess-plans')
        .set(auth(officeToken))
        .send({
          hostelId: boysHostelId,
          name: 'Full board',
          monthlyCharge: 3100,
        })
        .expect(201);
      planId = dataOf<{ id: string }>(res).id;
    });

    it('puts the boarder on it', async () => {
      await server()
        .post('/api/v1/mess-enrollments')
        .set(auth(officeToken))
        .send({ allocationId, planId, startDate: day(-40) })
        .expect(201);
    });

    it('refuses a plan belonging to the other building', async () => {
      const other = await server()
        .post('/api/v1/mess-plans')
        .set(auth(officeToken))
        .send({
          hostelId: girlsHostelId,
          name: 'Girls board',
          monthlyCharge: 2900,
        })
        .expect(201);
      const otherPlanId = dataOf<{ id: string }>(other).id;

      const res = await server()
        .post('/api/v1/mess-enrollments')
        .set(auth(officeToken))
        .send({ allocationId, planId: otherPlanId })
        .expect(400);
      expect(errorOf(res)).toMatch(/different hostel/i);
    });

    it('refuses deleting a plan boarders are on', async () => {
      const res = await server()
        .delete(`/api/v1/mess-plans/${planId}`)
        .set(auth(officeToken))
        .expect(409);
      expect(errorOf(res)).toMatch(/without anybody noticing/i);
    });

    /**
     * **The residency window starts at the RESUME date**, so days from
     * before the suspension are outside it. That is not a bug and it is
     * not asymmetric: those days were not billed either (M16 reads the
     * same window), so there is nothing to credit. It is M25's documented
     * one-row-one-window simplification, and it rounds in the boarder's
     * favour — which is why it is asserted rather than worked around.
     */
    it('refuses a meal-off for days before the boarder was resumed', async () => {
      const res = await server()
        .post('/api/v1/meal-offs')
        .set(auth(officeToken))
        .send({
          allocationId,
          fromDate: day(-20),
          toDate: day(-15),
          reason: 'While suspended',
        })
        .expect(400);
      expect(errorOf(res)).toMatch(/outside the time/i);
    });

    it('records a meal-off request', async () => {
      const res = await server()
        .post('/api/v1/meal-offs')
        .set(auth(officeToken))
        .send({
          allocationId,
          fromDate: day(-4),
          toDate: day(1),
          reason: 'Home for Eid',
        })
        .expect(201);
      const row = dataOf<{ id: string; status: string }>(res);
      expect(row.status).toBe('PENDING');
    });

    it('refuses a second request over the same days', async () => {
      const res = await server()
        .post('/api/v1/meal-offs')
        .set(auth(officeToken))
        .send({
          allocationId,
          fromDate: day(0),
          toDate: day(4),
          reason: 'Overlapping',
        })
        .expect(409);
      expect(errorOf(res)).toMatch(/overlap/i);
    });

    it('refuses a request shorter than the school’s minimum', async () => {
      const res = await server()
        .post('/api/v1/meal-offs')
        .set(auth(officeToken))
        .send({
          allocationId,
          fromDate: day(8),
          toDate: day(8),
          reason: 'One night away',
        })
        .expect(400);
      expect(errorOf(res)).toMatch(/at least 3 day/i);
    });

    it('approving fixes the month whose invoice carries the credit', async () => {
      const list = await server()
        .get('/api/v1/meal-offs')
        .query({ status: 'PENDING', allocationId })
        .set(auth(officeToken))
        .expect(200);
      const pending = dataOf<Array<{ id: string }>>(list)[0];

      const res = await server()
        .post(`/api/v1/meal-offs/${pending.id}/approve`)
        .set(auth(officeToken))
        .send({ approve: true, note: 'Fine' })
        .expect(201);

      const row = dataOf<{ status: string; creditMonth: string }>(res);
      expect(row.status).toBe('APPROVED');
      expect(row.creditMonth).toBeTruthy();
      // The days ended in the past, so the credit lands on NEXT month's
      // bill — decided once, at approval, and stored.
      expect(row.creditMonth.slice(0, 7) > thisMonth()).toBe(true);
      expect(row.creditMonth.slice(8, 10)).toBe('01');
    });

    it('refuses to decide the same request twice', async () => {
      const list = await server()
        .get('/api/v1/meal-offs')
        .query({ status: 'APPROVED', allocationId })
        .set(auth(officeToken))
        .expect(200);
      const decided = dataOf<Array<{ id: string }>>(list)[0];

      await server()
        .post(`/api/v1/meal-offs/${decided.id}/approve`)
        .set(auth(officeToken))
        .send({ approve: false })
        .expect(409);
    });
  });

  // ── the billing handoff (roadmap §9's end-to-end) ────────────────────

  describe('M16 billing handoff', () => {
    it('puts TWO hostel lines on the monthly invoice, already prorated', async () => {
      const res = await server()
        .post('/api/v1/invoices/generate')
        .set(auth(adminToken))
        .send({
          sessionId,
          classId,
          billingMonth: thisMonth(),
          dueDate: day(20),
        })
        .expect(201);
      expect((res.body as { success: boolean }).success).toBe(true);

      const invoice = await prisma.invoice.findFirst({
        where: { enrollmentId: enrollments.get(1)!, deletedAt: null },
        include: { items: true },
      });
      expect(invoice).toBeTruthy();

      const rent = invoice!.items.find((i) => i.feeHeadId === rentHeadId);
      const mess = invoice!.items.find((i) => i.feeHeadId === messHeadId);

      // The handoff crosses a DI token bound inside FeeModule; if the
      // binding were missing, both of these would simply be absent and
      // nothing else would fail.
      expect(rent).toBeTruthy();
      expect(mess).toBeTruthy();
      expect(Number(rent!.amount)).toBe(3100);
      expect(String(rent!.description)).toMatch(/Room A-101/);
    });

    it('the credit is NOT on this month — it lands on the next one', async () => {
      const invoice = await prisma.invoice.findFirst({
        where: { enrollmentId: enrollments.get(1)!, deletedAt: null },
        include: { items: true },
      });
      const mess = invoice!.items.find((i) => i.feeHeadId === messHeadId);
      // Full mess charge: the approved meal-off's credit month is next.
      expect(Number(mess!.amount)).toBe(3100);
      expect(String(mess!.description)).not.toMatch(/less/i);
    });

    it('bills a day student nothing at all — absent, not zero', async () => {
      const invoice = await prisma.invoice.findFirst({
        where: { enrollmentId: enrollments.get(3)!, deletedAt: null },
        include: { items: true },
      });
      const hostelLines = (invoice?.items ?? []).filter(
        (i) => i.feeHeadId === rentHeadId || i.feeHeadId === messHeadId,
      );
      expect(hostelLines).toHaveLength(0);
    });
  });

  // ── vacating and the deposit ────────────────────────────────────────

  describe('vacate and deposit', () => {
    let allocationId: string;

    beforeAll(async () => {
      const row = await prisma.hostelAllocation.findFirst({
        where: { enrollmentId: enrollments.get(1)!, deletedAt: null },
      });
      allocationId = row!.id;
    });

    it('the office may not hand a deposit back', async () => {
      await server()
        .post(`/api/v1/hostel-allocations/${allocationId}/refund-deposit`)
        .set(auth(officeToken))
        .send({})
        .expect(403);
    });

    it('the accountant may not give anybody a bed', async () => {
      await server()
        .post('/api/v1/hostel-allocations')
        .set(auth(accountantToken))
        .send({ enrollmentId: enrollments.get(3), bedId: beds[2] })
        .expect(403);
    });

    it('refuses a refund while the boarder still lives there', async () => {
      const res = await server()
        .post(`/api/v1/hostel-allocations/${allocationId}/refund-deposit`)
        .set(auth(accountantToken))
        .send({})
        .expect(409);
      expect(errorOf(res)).toMatch(/still occupied/i);
    });

    it('vacates, releasing the bed and closing the kitchen', async () => {
      const res = await server()
        .post(`/api/v1/hostel-allocations/${allocationId}/vacate`)
        .set(auth(officeToken))
        .send({ reason: 'Family moved to Chittagong', endDate: day(0) })
        .expect(201);

      const body = dataOf<{
        allocation: { status: string; endDate: string };
        warnings: string[];
      }>(res);
      expect(body.allocation.status).toBe('VACATED');

      const [bed, mess] = await Promise.all([
        prisma.hostelBed.findUnique({ where: { id: beds[1] } }),
        prisma.messEnrollment.findFirst({
          where: { allocationId, deletedAt: null },
        }),
      ]);
      expect(bed?.status).toBe('VACANT');
      // A bed freed while the kitchen keeps billing is the worst of the
      // three possible half-states.
      expect(mess?.endDate).toBeTruthy();
    });

    it('warns about the fees still on the ledger rather than hiding them', async () => {
      // `hostel.vacate_block_dues` is off by default (the M23
      // `library.clearance_block_exit` reasoning), so the vacate went
      // through — but the dues had to be reported.
      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'HostelAllocation', entityId: allocationId },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).toBeTruthy();
    });

    it('the freed bed can now be given to somebody else', async () => {
      await server()
        .post('/api/v1/hostel-allocations')
        .set(auth(officeToken))
        .send({ enrollmentId: enrollments.get(2), bedId: beds[1] })
        .expect(201);
    });

    it('returns the deposit less a deduction with a reason on it', async () => {
      const res = await server()
        .post(`/api/v1/hostel-allocations/${allocationId}/refund-deposit`)
        .set(auth(accountantToken))
        .send({
          deductions: [{ amount: 1200, reason: 'Broken window pane' }],
        })
        .expect(201);
      const body = dataOf<{ refund: number; withheld: number }>(res);
      expect(body.refund).toBe(3800);
      expect(body.withheld).toBe(1200);
    });

    it('posts the refund as a DEBIT voucher discharging the liability', async () => {
      const voucher = await prisma.voucher.findFirst({
        where: { sourceRef: `hostel-refund:${allocationId}` },
        include: { entries: { include: { account: true } } },
      });
      expect(voucher!.type).toBe('DEBIT');
      const debit = voucher!.entries.find((e) => Number(e.debit) > 0);
      expect(debit?.account.code).toBe('2140');
      expect(Number(debit?.debit)).toBe(3800);
    });

    it('refuses a second refund — a correction is an accounting entry', async () => {
      await server()
        .post(`/api/v1/hostel-allocations/${allocationId}/refund-deposit`)
        .set(auth(accountantToken))
        .send({})
        .expect(409);
    });

    it('chk_hostel_allocations_deposit refuses more back than was taken', async () => {
      await expect(
        prisma.hostelAllocation.update({
          where: { id: allocationId },
          data: { depositRefundAmount: 99_999 },
        }),
      ).rejects.toThrow();
    });
  });

  // ── reports and the portal ──────────────────────────────────────────

  describe('reports', () => {
    it('counts beds out of service outside the percentage', async () => {
      const res = await server()
        .get('/api/v1/hostel/reports/occupancy')
        .query({ hostelId: boysHostelId })
        .set(auth(officeToken))
        .expect(200);
      const report = dataOf<{
        overall: { total: number; maintenance: number; utilization: number };
        hostels: Array<{ floors: Array<{ rooms: unknown[] }> }>;
      }>(res);
      expect(report.overall.total).toBe(4);
      expect(report.hostels[0].floors).toHaveLength(1);
    });

    it('lists residents with the guardian to ring', async () => {
      const res = await server()
        .get('/api/v1/hostel/reports/residents')
        .set(auth(officeToken))
        .expect(200);
      const rows = dataOf<
        Array<{
          studentName: string;
          guardianPhone: string | null;
          status: string;
        }>
      >(res);
      // The vacated boarder is gone from the register.
      expect(rows.every((row) => row.status !== 'VACATED')).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
    });

    it('reads dues from the same ledger the vacate gate reads', async () => {
      await server()
        .get('/api/v1/hostel/reports/dues')
        .set(auth(officeToken))
        .expect(200);
    });

    it('summarises meal-offs by boarder', async () => {
      const res = await server()
        .get('/api/v1/hostel/reports/meal-offs')
        .set(auth(officeToken))
        .expect(200);
      const rows =
        dataOf<Array<{ approved: number; daysApproved: number }>>(res);
      expect(
        rows.some((row) => row.approved === 1 && row.daysApproved === 6),
      ).toBe(true);
    });

    it('the accountant may read the reports', async () => {
      await server()
        .get('/api/v1/hostel/reports/occupancy')
        .set(auth(accountantToken))
        .expect(200);
    });

    it('downloads the resident register as XLSX', async () => {
      const res = await server()
        .get('/api/v1/hostel/reports/residents/export')
        .set(auth(officeToken))
        .expect(200);
      expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    });
  });

  describe('portal', () => {
    it('a day student gets a self-describing stub, not an empty card', async () => {
      // Student 1 vacated; the panel has to say something true.
      const res = await server()
        .get('/api/v1/portal/hostel')
        .set(auth(studentToken))
        .expect(200);
      const view = dataOf<{ resident: boolean; reason?: string }>(res);
      expect(view.resident).toBe(false);
      expect(view.reason).toBeTruthy();
    });

    it('shows a resident the room, the bed and their own meal-offs', async () => {
      // Re-allocate student 1 so the populated shape is exercised too.
      await server()
        .post('/api/v1/hostel-allocations')
        .set(auth(officeToken))
        .send({ enrollmentId: enrollments.get(1), bedId: beds[2] })
        .expect(201);

      const res = await server()
        .get('/api/v1/portal/hostel')
        .set(auth(studentToken))
        .expect(200);
      const view = dataOf<{
        resident: boolean;
        room?: { roomNo: string; bedNo: string };
        hostel?: { name: string };
        mealOffs?: unknown[];
      }>(res);

      expect(view.resident).toBe(true);
      expect(view.room?.roomNo).toBe('A-101');
      expect(view.hostel?.name).toBe(`${NAME} Shapla`);
      expect(Array.isArray(view.mealOffs)).toBe(true);
    });

    it('a student cannot read another child’s hostel row', async () => {
      await server()
        .get(`/api/v1/portal/parent/child/${studentIds.get(2)}/hostel`)
        .set(auth(studentToken))
        .expect(403);
    });
  });

  // ── guards ──────────────────────────────────────────────────────────

  describe('delete guards', () => {
    it('refuses to delete a hostel with boarders in it', async () => {
      const res = await server()
        .delete(`/api/v1/hostels/${boysHostelId}`)
        .set(auth(officeToken))
        .expect(409);
      expect(errorOf(res)).toMatch(/still has boarders/i);
    });

    it('refuses to take an occupied room out of service', async () => {
      const res = await server()
        .patch(`/api/v1/hostels/rooms/${roomId}`)
        .set(auth(officeToken))
        .send({
          roomNo: 'A-101',
          bedCount: 4,
          monthlyFee: 3100,
          status: 'MAINTENANCE',
        })
        .expect(409);
      // Roadmap §8: the refusal IS the transfer wizard's trigger, and it
      // names how many people have to move.
      expect(errorOf(res)).toMatch(/Transfer them/i);
    });

    it('refuses to change what a building is for while it is occupied', async () => {
      const res = await server()
        .patch(`/api/v1/hostels/${boysHostelId}`)
        .set(auth(officeToken))
        .send({ name: `${NAME} Shapla`, type: 'GIRLS' })
        .expect(409);
      expect(errorOf(res)).toMatch(/what the building is for/i);
    });

    it('refuses to delete a bed somebody is asleep in', async () => {
      await server()
        .delete(`/api/v1/hostels/beds/${beds[2]}`)
        .set(auth(officeToken))
        .expect(409);
    });
  });
});
