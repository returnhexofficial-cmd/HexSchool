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
 * Requires the dev infrastructure (DATABASE_URL database + redis) to be up
 * and migrated. Registry/system-role seeds are (re-)applied idempotently;
 * scratch users/roles are created and hard-deleted per run.
 */
describe('RBAC + Audit (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-rbac-admin@test.local';
  const PLAIN = 'e2e-rbac-plain@test.local';
  const SUPER = 'e2e-rbac-super@test.local';
  const ROLE_SLUG = 'e2e-exam-controller';

  let adminToken: string;
  let plainToken: string;
  let superToken: string;
  let plainUserId: string;
  const testUserIds: string[] = [];

  const cleanup = async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: [ADMIN, PLAIN, SUPER] } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    if (ids.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.role.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, slug: { startsWith: 'e2e-' } },
    });
  };

  const login = async (identifier: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier, password: PASSWORD })
      .expect(200);
    return (res.body as { data: { accessToken: string } }).data.accessToken;
  };

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Audit writes are fire-and-forget — poll briefly instead of sleeping. */
  const waitForAuditEntry = async (where: {
    entityType: string;
    entityId: string;
    action: string;
  }) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const entry = await prisma.auditLog.findFirst({ where });
      if (entry) return entry;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
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
    const [adminUser, plainUser, superUser] = await Promise.all(
      (
        [
          [ADMIN, UserType.ADMIN],
          [PLAIN, UserType.STAFF],
          [SUPER, UserType.SUPER_ADMIN],
        ] as const
      ).map(([email, userType]) =>
        prisma.user.create({
          data: { schoolId: DEFAULT_SCHOOL_ID, email, passwordHash, userType },
        }),
      ),
    );
    plainUserId = plainUser.id;
    testUserIds.push(adminUser.id, plainUser.id, superUser.id);

    // The admin test user holds the system `admin` role (all M03 codes).
    const adminRole = await prisma.role.findFirst({
      where: { schoolId: DEFAULT_SCHOOL_ID, slug: 'admin', deletedAt: null },
    });
    await prisma.userRole.create({
      data: { userId: adminUser.id, roleId: adminRole!.id },
    });

    adminToken = await login(ADMIN);
    plainToken = await login(PLAIN);
    superToken = await login(SUPER);
  }, 120_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('GET /roles without the permission → 403 envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/roles')
      .set(auth(plainToken))
      .expect(403);
    expect(res.body).toMatchObject({ success: false });
  });

  it('GET /roles with role.view (via admin system role) → 200 + meta', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/roles')
      .set(auth(adminToken))
      .expect(200);
    const body = res.body as {
      success: boolean;
      data: Array<{ slug: string }>;
      meta: { total: number };
    };
    expect(body.success).toBe(true);
    expect(body.meta.total).toBeGreaterThanOrEqual(11); // system roles
    expect(body.data.some((r) => r.slug === 'admin')).toBe(true);
  });

  it('Super Admin bypasses despite holding no roles', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/roles')
      .set(auth(superToken))
      .expect(200);
  });

  it('/auth/me now reports permission codes', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(auth(adminToken))
      .expect(200);
    const perms = (res.body as { data: { permissions: string[] } }).data
      .permissions;
    expect(perms).toEqual(expect.arrayContaining(['role.view', 'audit.view']));
  });

  it('GET /permissions returns the registry catalog', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/permissions')
      .set(auth(adminToken))
      .expect(200);
    const codes = (res.body as { data: Array<{ code: string }> }).data.map(
      (p) => p.code,
    );
    expect(codes).toEqual(
      expect.arrayContaining(['role.view', 'user.role.assign', 'audit.view']),
    );
  });

  describe('role lifecycle + live permission changes', () => {
    let roleId: string;
    let roleUpdatedAt: string;

    it('POST /roles creates a custom role (and audits it)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/roles')
        .set(auth(adminToken))
        .send({ name: 'E2E Exam Controller', slug: ROLE_SLUG })
        .expect(201);
      const role = (res.body as { data: { id: string; updatedAt: string } })
        .data;
      roleId = role.id;
      roleUpdatedAt = role.updatedAt;

      const entry = await waitForAuditEntry({
        entityType: 'Role',
        entityId: roleId,
        action: 'CREATE',
      });
      expect(entry).not.toBeNull();
      expect(entry!.newValues).toMatchObject({ slug: ROLE_SLUG });
    });

    it('duplicate slug → 409', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/roles')
        .set(auth(adminToken))
        .send({ name: 'Dup', slug: ROLE_SLUG })
        .expect(409);
    });

    it('PUT /roles/:id/permissions rejects unknown codes', async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/roles/${roleId}/permissions`)
        .set(auth(adminToken))
        .send({ permissionCodes: ['role.view', 'no.such-code'] })
        .expect(400);
    });

    it('stale expectedUpdatedAt → 409', async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/roles/${roleId}`)
        .set(auth(adminToken))
        .send({
          name: 'Renamed',
          expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
        })
        .expect(409);
    });

    it('granting role.view to the role gives its holder access immediately', async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/roles/${roleId}/permissions`)
        .set(auth(adminToken))
        .send({
          permissionCodes: ['role.view'],
          expectedUpdatedAt: roleUpdatedAt,
        })
        .expect(200);

      await request(app.getHttpServer())
        .put(`/api/v1/users/${plainUserId}/roles`)
        .set(auth(adminToken))
        .send({ roleIds: [roleId] })
        .expect(200);

      // Same access token as the earlier 403 — permissions are read from
      // the invalidated cache/DB, not the JWT.
      await request(app.getHttpServer())
        .get('/api/v1/roles')
        .set(auth(plainToken))
        .expect(200);
    });

    it('revoking the grant locks the holder out again (cache invalidated)', async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/roles/${roleId}/permissions`)
        .set(auth(adminToken))
        .send({ permissionCodes: [] })
        .expect(200);

      await request(app.getHttpServer())
        .get('/api/v1/roles')
        .set(auth(plainToken))
        .expect(403);
    });

    it('PUT /users/:id/roles with an empty set → 400 (≥1 role rule)', async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/users/${plainUserId}/roles`)
        .set(auth(adminToken))
        .send({ roleIds: [] })
        .expect(400);
    });

    it('a role still assigned cannot be deleted; unassigned it can', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/roles/${roleId}`)
        .set(auth(adminToken))
        .expect(409);

      // Move the plain user to a system role to free the custom role.
      const teacherRole = await prisma.role.findFirst({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          slug: 'teacher',
          deletedAt: null,
        },
      });
      await request(app.getHttpServer())
        .put(`/api/v1/users/${plainUserId}/roles`)
        .set(auth(adminToken))
        .send({ roleIds: [teacherRole!.id] })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/v1/roles/${roleId}`)
        .set(auth(adminToken))
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/roles/${roleId}`)
        .set(auth(adminToken))
        .expect(404);
    });
  });

  it('system roles cannot be deleted', async () => {
    const teacherRole = await prisma.role.findFirst({
      where: { schoolId: DEFAULT_SCHOOL_ID, slug: 'teacher', deletedAt: null },
    });
    await request(app.getHttpServer())
      .delete(`/api/v1/roles/${teacherRole!.id}`)
      .set(auth(adminToken))
      .expect(400);
  });

  it('audit log list + detail are permission-guarded and immutable-by-API', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/audit-logs?entityType=Role&action=CREATE')
      .set(auth(adminToken))
      .expect(200);
    const body = res.body as {
      data: Array<{ id: string; entityType: string }>;
      meta: { total: number };
    };
    expect(body.meta.total).toBeGreaterThanOrEqual(1);
    expect(body.data[0].entityType).toBe('Role');

    await request(app.getHttpServer())
      .get(`/api/v1/audit-logs/${body.data[0].id}`)
      .set(auth(adminToken))
      .expect(200);

    // No mutation surface exists on audit logs.
    await request(app.getHttpServer())
      .delete(`/api/v1/audit-logs/${body.data[0].id}`)
      .set(auth(adminToken))
      .expect(404);

    await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set(auth(plainToken))
      .expect(403);
  });

  it('login audit entries redact the password', async () => {
    const adminUser = await prisma.user.findFirst({
      where: { email: ADMIN, deletedAt: null },
      select: { id: true },
    });
    const entry = await prisma.auditLog.findFirst({
      where: { userId: adminUser!.id, action: 'LOGIN' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry).not.toBeNull();
    expect(entry!.newValues).toMatchObject({
      identifier: ADMIN,
      password: '[REDACTED]',
    });
  });
});
