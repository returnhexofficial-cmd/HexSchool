import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEFAULT_SCHOOL_ID, UserType } from '../src/common/constants';
import { PrismaService } from '../src/database/prisma/prisma.service';

/**
 * Requires the dev infrastructure (DATABASE_URL database + redis) to be up
 * and migrated. Scratch users are created and hard-deleted per run.
 */
describe('Auth (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const HAPPY = 'e2e-happy@test.local';
  const LOCKME = 'e2e-lockme@test.local';

  const cleanup = async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [HAPPY, LOCKME] } },
    });
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
    await cleanup();

    const passwordHash = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
    });
    await prisma.user.createMany({
      data: [HAPPY, LOCKME].map((email) => ({
        schoolId: DEFAULT_SCHOOL_ID,
        email,
        passwordHash,
        userType: UserType.ADMIN,
      })),
    });
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const login = (identifier: string, password: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier, password });

  it('guarded route without token → 401 envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .expect(401);
    expect(res.body).toMatchObject({ success: false });
  });

  it('login happy path → user + accessToken + httpOnly refresh cookie', async () => {
    const res = await login(HAPPY, PASSWORD).expect(200);

    const body = res.body as {
      success: boolean;
      data: { user: { email: string }; accessToken: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe(HAPPY);
    expect(body.data.accessToken).toBeTruthy();

    const cookies = res.headers['set-cookie'];
    expect(String(cookies)).toContain('hs_refresh=');
    expect(String(cookies)).toContain('HttpOnly');
  });

  it('login rejects unknown identifier and wrong password identically', async () => {
    const a = await login('nobody@test.local', PASSWORD).expect(401);
    const b = await login(HAPPY, 'WrongPass1').expect(401);
    expect((a.body as { error: { message: string } }).error.message).toBe(
      (b.body as { error: { message: string } }).error.message,
    );
  });

  it('refresh flow: cookie rotates and mints a fresh access token', async () => {
    const loginRes = await login(HAPPY, PASSWORD).expect(200);
    const cookie = loginRes.headers['set-cookie'];

    const refreshRes = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .send({})
      .expect(200);

    const body = refreshRes.body as { data: { accessToken: string } };
    expect(body.data.accessToken).toBeTruthy();
    // Rotated: a new refresh cookie is set.
    expect(String(refreshRes.headers['set-cookie'])).toContain('hs_refresh=');

    // /auth/me works with the new access token.
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.data.accessToken}`)
      .expect(200);
  });

  it('logout-all revokes every session (old cookies stop refreshing)', async () => {
    const first = await login(HAPPY, PASSWORD).expect(200);
    const second = await login(HAPPY, PASSWORD).expect(200);
    const token = (second.body as { data: { accessToken: string } }).data
      .accessToken;

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', second.headers['set-cookie'])
      .send({ allDevices: true })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', first.headers['set-cookie'])
      .send({})
      .expect(401);
  });

  it('5 wrong passwords → 423 Locked (even with the correct password)', async () => {
    for (let i = 0; i < 5; i++) {
      await login(LOCKME, 'WrongPass1').expect(401);
    }
    await login(LOCKME, PASSWORD).expect(423);
  }, 30_000);

  it('sessions endpoint lists active devices; revoke works', async () => {
    const loginRes = await login(HAPPY, PASSWORD).expect(200);
    const token = (loginRes.body as { data: { accessToken: string } }).data
      .accessToken;

    const sessionsRes = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', loginRes.headers['set-cookie'])
      .expect(200);

    const sessions = (
      sessionsRes.body as { data: Array<{ id: string; isCurrent: boolean }> }
    ).data;
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.some((s) => s.isCurrent)).toBe(true);

    const target = sessions.find((s) => !s.isCurrent) ?? sessions[0];
    await request(app.getHttpServer())
      .delete(`/api/v1/auth/sessions/${target.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('validation failure → VALIDATION_ERROR envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: '', password: '', extra: 'nope' })
      .expect(400);
    expect(res.body).toMatchObject({ success: false });
  });
});
