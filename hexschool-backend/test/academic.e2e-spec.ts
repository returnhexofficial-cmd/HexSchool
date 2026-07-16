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
 * Requires dev infra (DB + redis). Test sessions use far-future years
 * (2090+) so they never collide with real dev data; everything created
 * here is removed in afterAll (session FK cascades take holidays/events).
 */
describe('Academic Session & Calendar (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-academic-admin@test.local';
  const PLAIN = 'e2e-academic-plain@test.local';

  let adminToken: string;
  let plainToken: string;
  let originallyCurrentId: string | null = null;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => request(app.getHttpServer());

  const cleanup = async () => {
    // Hard-delete test sessions (cascades holidays/events via FK).
    await prisma.academicSession.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: 'E2E ' } },
    });
    const users = await prisma.user.findMany({
      where: { email: { in: [ADMIN, PLAIN] } },
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

    const current = await prisma.academicSession.findFirst({
      where: { schoolId: DEFAULT_SCHOOL_ID, isCurrent: true, deletedAt: null },
    });
    originallyCurrentId = current?.id ?? null;

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
    // Restore whichever session was current before the run (if any).
    if (originallyCurrentId) {
      await prisma.$transaction([
        prisma.academicSession.updateMany({
          where: { schoolId: DEFAULT_SCHOOL_ID, isCurrent: true },
          data: { isCurrent: false },
        }),
        prisma.academicSession.update({
          where: { id: originallyCurrentId },
          data: { isCurrent: true },
        }),
      ]);
    } else {
      await prisma.academicSession.updateMany({
        where: { schoolId: DEFAULT_SCHOOL_ID, isCurrent: true },
        data: { isCurrent: false },
      });
    }
    await cleanup();
    await app.close();
  });

  let session2090: string;
  let session2091: string;

  describe('sessions', () => {
    it('list is permission-guarded', async () => {
      await server()
        .get('/api/v1/academic-sessions')
        .set(auth(plainToken))
        .expect(403);
    });

    it('creates sessions; duplicate name → 409; overlap → 400', async () => {
      const res = await server()
        .post('/api/v1/academic-sessions')
        .set(auth(adminToken))
        .send({
          name: 'E2E 2090',
          startDate: '2090-01-01',
          endDate: '2090-12-31',
        })
        .expect(201);
      session2090 = (res.body as { data: { id: string } }).data.id;

      const res2 = await server()
        .post('/api/v1/academic-sessions')
        .set(auth(adminToken))
        .send({
          name: 'E2E 2091',
          startDate: '2091-01-01',
          endDate: '2091-12-31',
        })
        .expect(201);
      session2091 = (res2.body as { data: { id: string } }).data.id;

      await server()
        .post('/api/v1/academic-sessions')
        .set(auth(adminToken))
        .send({
          name: 'E2E 2090',
          startDate: '2093-01-01',
          endDate: '2093-12-31',
        })
        .expect(409);

      await server()
        .post('/api/v1/academic-sessions')
        .set(auth(adminToken))
        .send({
          name: 'E2E Overlap',
          startDate: '2090-06-01',
          endDate: '2091-05-31',
        })
        .expect(400);
    });

    it('activate flow: promote, then switch — exactly one current', async () => {
      await server()
        .post(`/api/v1/academic-sessions/${session2090}/activate`)
        .set(auth(adminToken))
        .expect(200);

      await server()
        .post(`/api/v1/academic-sessions/${session2091}/activate`)
        .set(auth(adminToken))
        .expect(200);

      const list = await prisma.academicSession.findMany({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          isCurrent: true,
          deletedAt: null,
        },
      });
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(session2091);
      // Demoted ACTIVE session rolled over to COMPLETED.
      const demoted = await prisma.academicSession.findUnique({
        where: { id: session2090 },
      });
      expect(demoted?.status).toBe('COMPLETED');

      const current = await server()
        .get('/api/v1/academic-sessions/current')
        .set(auth(adminToken))
        .expect(200);
      expect((current.body as { data: { id: string } }).data.id).toBe(
        session2091,
      );
    });

    it('the current session cannot be deleted', async () => {
      await server()
        .delete(`/api/v1/academic-sessions/${session2091}`)
        .set(auth(adminToken))
        .expect(409);
    });
  });

  describe('holidays & events', () => {
    let holidayId: string;

    it('holiday outside its session → 400; inside → 201', async () => {
      await server()
        .post('/api/v1/holidays')
        .set(auth(adminToken))
        .send({
          sessionId: session2090,
          title: 'E2E Out of range',
          startDate: '2091-05-01',
          endDate: '2091-05-01',
        })
        .expect(400);

      const res = await server()
        .post('/api/v1/holidays')
        .set(auth(adminToken))
        .send({
          sessionId: session2090,
          title: 'E2E Victory Day',
          startDate: '2090-12-16',
          endDate: '2090-12-16',
          type: 'GOVERNMENT',
        })
        .expect(201);
      holidayId = (res.body as { data: { id: string } }).data.id;
    });

    it('CSV import: valid rows in, bad rows reported', async () => {
      const csv = [
        'title,start_date,end_date,type,applies_to',
        'E2E Eid,2090-03-20,2090-03-22,RELIGIOUS,ALL',
        'E2E Bad,2090-13-99,2090-03-22,RELIGIOUS,ALL',
      ].join('\n');
      const res = await server()
        .post('/api/v1/holidays/import')
        .set(auth(adminToken))
        .field('sessionId', session2090)
        .attach('file', Buffer.from(csv, 'utf8'), 'holidays.csv')
        .expect(200);
      const report = (
        res.body as {
          data: { imported: number; errors: Array<{ line: number }> };
        }
      ).data;
      expect(report.imported).toBe(1);
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].line).toBe(3);
    });

    it('events: end >= start enforced; create works', async () => {
      await server()
        .post('/api/v1/calendar-events')
        .set(auth(adminToken))
        .send({
          sessionId: session2090,
          title: 'E2E Backwards',
          startDate: '2090-05-10',
          endDate: '2090-05-09',
        })
        .expect(400);

      await server()
        .post('/api/v1/calendar-events')
        .set(auth(adminToken))
        .send({
          sessionId: session2090,
          title: 'E2E Sports Day',
          startDate: '2090-12-05',
          endDate: '2090-12-05',
          type: 'SPORTS',
          isPublic: true,
        })
        .expect(201);
    });

    it('session with holidays cannot be deleted (archive instead)', async () => {
      // 2090 is no longer current but has holidays/events.
      await server()
        .delete(`/api/v1/academic-sessions/${session2090}`)
        .set(auth(adminToken))
        .expect(409);
    });

    it('month aggregate returns holidays, events, and weekly off-days', async () => {
      const res = await server()
        .get('/api/v1/calendar?month=2090-12')
        .set(auth(adminToken))
        .expect(200);
      const data = (
        res.body as {
          data: {
            weeklyHolidays: string[];
            holidays: Array<{ title: string }>;
            events: Array<{ title: string }>;
          };
        }
      ).data;
      expect(data.weeklyHolidays).toContain('FRIDAY');
      expect(data.holidays.some((h) => h.title === 'E2E Victory Day')).toBe(
        true,
      );
      expect(data.events.some((e) => e.title === 'E2E Sports Day')).toBe(true);
    });

    it('iCal export is text/calendar with the seeded entries', async () => {
      const res = await server()
        .get('/api/v1/calendar.ics?month=2090-12')
        .set(auth(adminToken))
        .expect(200);
      expect(res.headers['content-type']).toContain('text/calendar');
      expect(res.text).toContain('BEGIN:VCALENDAR');
      expect(res.text).toContain('SUMMARY:E2E Victory Day');
      expect(res.text).toContain('SUMMARY:E2E Sports Day');
    });

    it('holiday delete is a hard delete', async () => {
      await server()
        .delete(`/api/v1/holidays/${holidayId}`)
        .set(auth(adminToken))
        .expect(200);
      const gone = await prisma.holiday.findUnique({
        where: { id: holidayId },
      });
      expect(gone).toBeNull();
    });
  });
});
