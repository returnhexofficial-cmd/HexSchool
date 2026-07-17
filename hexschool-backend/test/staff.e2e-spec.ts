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
 * Requires dev infra (DB + redis). Test users/staff use e2e-staff prefixes
 * and the 01799xxxx phone block; afterAll removes everything. Employee IDs
 * claimed during the run stay burned in document_sequences — by design.
 */
describe('Staff & User Management (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-staff-admin@test.local';
  const PLAIN = 'e2e-staff-plain@test.local';
  const PHONES = Array.from(
    { length: 12 },
    (_, i) => `017990055${String(i).padStart(2, '0')}`,
  );

  let adminToken: string;
  let adminUserId: string;
  let plainToken: string;
  let loginFn: (identifier: string, password?: string) => Promise<string>;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => request(app.getHttpServer());

  const staffPayload = (i: number, extra: object = {}) => ({
    phone: PHONES[i],
    firstName: 'E2EStaff',
    lastName: `Member${i}`,
    designation: 'ACCOUNTANT',
    gender: 'FEMALE',
    dob: '1992-03-04',
    joiningDate: '2021-02-01',
    ...extra,
  });

  const cleanup = async () => {
    await prisma.staffProfile.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: 'E2EStaff' },
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
    adminUserId = adminUser.id;
    const adminRole = await prisma.role.findFirst({
      where: { schoolId: DEFAULT_SCHOOL_ID, slug: 'admin', deletedAt: null },
    });
    await prisma.userRole.create({
      data: { userId: adminUser.id, roleId: adminRole!.id },
    });

    const login = async (identifier: string, password = PASSWORD) => {
      const res = await server()
        .post('/api/v1/auth/login')
        .send({ identifier, password })
        .expect(200);
      return (res.body as { data: { accessToken: string } }).data.accessToken;
    };
    adminToken = await login(ADMIN);
    plainToken = await login(PLAIN);
    loginFn = login;
  }, 120_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  }, 120_000);

  /** The status cascade runs out-of-band — poll briefly. */
  const waitForUserStatus = async (
    userId: string,
    status: string,
    attempts = 20,
  ): Promise<string> => {
    for (let i = 0; i < attempts; i += 1) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user?.status === status) return user.status;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return (await prisma.user.findUnique({ where: { id: userId } }))!.status;
  };

  let staffId: string;
  let staffUserId: string;

  it('staff endpoints are permission-guarded', async () => {
    await server().get('/api/v1/staff').set(auth(plainToken)).expect(403);
    await server()
      .post('/api/v1/staff')
      .set(auth(plainToken))
      .send(staffPayload(0))
      .expect(403);
    await server().get('/api/v1/users').set(auth(plainToken)).expect(403);
  });

  it('creating staff creates the linked user transactionally', async () => {
    const res = await server()
      .post('/api/v1/staff')
      .set(auth(adminToken))
      .send(staffPayload(0, { email: 'e2e-staff-m0@test.local' }))
      .expect(201);

    const data = (
      res.body as {
        data: {
          id: string;
          userId: string;
          employeeId: string;
          user: { phone: string; mustChangePassword: boolean };
        };
      }
    ).data;
    staffId = data.id;
    staffUserId = data.userId;

    // Employee ID follows the settings pattern for joining year 2021.
    expect(data.employeeId).toMatch(/-S-21\d{4}$/);
    expect(data.user.phone).toBe(PHONES[0]);
    expect(data.user.mustChangePassword).toBe(true);

    // Designation ACCOUNTANT → accountant system role assigned.
    const roles = await prisma.userRole.findMany({
      where: { userId: data.userId },
      include: { role: true },
    });
    expect(roles.map((r) => r.role.slug)).toContain('accountant');
  });

  it('duplicate phone → 409; underage → 400; future joining → 400', async () => {
    await server()
      .post('/api/v1/staff')
      .set(auth(adminToken))
      .send(staffPayload(0))
      .expect(409);
    await server()
      .post('/api/v1/staff')
      .set(auth(adminToken))
      .send(staffPayload(1, { dob: '2015-01-01' }))
      .expect(400);
    await server()
      .post('/api/v1/staff')
      .set(auth(adminToken))
      .send(staffPayload(1, { joiningDate: '2093-01-01' }))
      .expect(400);
  });

  it('parallel creates never duplicate employee IDs (gap-free generator)', async () => {
    const responses = await Promise.all(
      [2, 3, 4, 5, 6].map((i) =>
        server()
          .post('/api/v1/staff')
          .set(auth(adminToken))
          .send(staffPayload(i)),
      ),
    );
    for (const res of responses) expect(res.status).toBe(201);
    const ids = responses.map(
      (res) => (res.body as { data: { employeeId: string } }).data.employeeId,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('list filters by designation and searches by employee id', async () => {
    const res = await server()
      .get('/api/v1/staff?designation=ACCOUNTANT&search=E2EStaff')
      .set(auth(adminToken))
      .expect(200);
    const body = res.body as {
      data: Array<{ designation: string }>;
      meta: { total: number };
    };
    expect(body.meta.total).toBeGreaterThanOrEqual(6);
    expect(body.data.every((s) => s.designation === 'ACCOUNTANT')).toBe(true);
  });

  it('NID soft check warns without blocking', async () => {
    await server()
      .put(`/api/v1/staff/${staffId}`)
      .set(auth(adminToken))
      .send({ nidNumber: '1234567890123' })
      .expect(200);

    const res = await server()
      .get('/api/v1/staff/check-nid?nid=1234567890123')
      .set(auth(adminToken))
      .expect(200);
    expect((res.body as { data: { exists: boolean } }).data.exists).toBe(true);

    // Same NID on another staff member is allowed (soft check only).
    await server()
      .post('/api/v1/staff')
      .set(auth(adminToken))
      .send(staffPayload(7, { nidNumber: '1234567890123' }))
      .expect(201);
  });

  it('document upload validates type and presence', async () => {
    await server()
      .post(`/api/v1/staff/${staffId}/documents`)
      .set(auth(adminToken))
      .field('title', 'NID copy')
      .expect(400); // no file
    await server()
      .post(`/api/v1/staff/${staffId}/documents`)
      .set(auth(adminToken))
      .field('title', 'NID copy')
      .attach('file', Buffer.from('plain text'), {
        filename: 'x.txt',
        contentType: 'text/plain',
      })
      .expect(400); // wrong mime
  });

  it('admin reset-password issues a working temp password', async () => {
    const res = await server()
      .post(`/api/v1/users/${staffUserId}/reset-password`)
      .set(auth(adminToken))
      .expect(201);
    const { tempPassword } = (res.body as { data: { tempPassword: string } })
      .data;
    expect(tempPassword.length).toBeGreaterThanOrEqual(8);

    // The temp password signs in (forced change is a frontend interstitial).
    await loginFn(PHONES[0], tempPassword);
  });

  it('RESIGNED cascades: linked user deactivated, sessions revoked', async () => {
    await server()
      .put(`/api/v1/staff/${staffId}/status`)
      .set(auth(adminToken))
      .send({ status: 'RESIGNED', reason: 'E2E resignation' })
      .expect(200);

    expect(await waitForUserStatus(staffUserId, 'INACTIVE')).toBe('INACTIVE');
    const live = await prisma.refreshToken.count({
      where: { userId: staffUserId, revokedAt: null },
    });
    expect(live).toBe(0);
  });

  it('back to ACTIVE reactivates the linked user', async () => {
    await server()
      .put(`/api/v1/staff/${staffId}/status`)
      .set(auth(adminToken))
      .send({ status: 'ACTIVE', reason: 'E2E rehire' })
      .expect(200);
    expect(await waitForUserStatus(staffUserId, 'ACTIVE')).toBe('ACTIVE');
  });

  describe('user admin endpoints', () => {
    it('lists users with roles and staff profile', async () => {
      const res = await server()
        .get(`/api/v1/users?userType=STAFF&search=E2EStaff`)
        .set(auth(adminToken))
        .expect(200);
      const rows = (
        res.body as {
          data: Array<{
            staffProfile: { firstName: string } | null;
            roles: Array<{ slug: string }>;
          }>;
        }
      ).data;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].staffProfile?.firstName).toBe('E2EStaff');
    });

    it('you cannot change your own status', async () => {
      await server()
        .put(`/api/v1/users/${adminUserId}/status`)
        .set(auth(adminToken))
        .send({ status: 'INACTIVE', reason: 'self-harm' })
        .expect(400);
    });

    it('suspend then reactivate another user', async () => {
      await server()
        .put(`/api/v1/users/${staffUserId}/status`)
        .set(auth(adminToken))
        .send({ status: 'SUSPENDED', reason: 'E2E suspension' })
        .expect(200);
      await server()
        .put(`/api/v1/users/${staffUserId}/status`)
        .set(auth(adminToken))
        .send({ status: 'ACTIVE' })
        .expect(200);
    });
  });

  it('deleting staff frees the contact but burns the employee ID', async () => {
    const created = await server()
      .post('/api/v1/staff')
      .set(auth(adminToken))
      .send(staffPayload(8))
      .expect(201);
    const firstEmployeeId = (
      created.body as { data: { id: string; employeeId: string } }
    ).data.employeeId;
    const firstId = (created.body as { data: { id: string } }).data.id;

    await server()
      .delete(`/api/v1/staff/${firstId}`)
      .set(auth(adminToken))
      .expect(200);

    // Same phone can be registered again…
    const recreated = await server()
      .post('/api/v1/staff')
      .set(auth(adminToken))
      .send(staffPayload(8))
      .expect(201);
    // …but the employee ID sequence moved on (never reused).
    expect(
      (recreated.body as { data: { employeeId: string } }).data.employeeId,
    ).not.toBe(firstEmployeeId);
  });
});
