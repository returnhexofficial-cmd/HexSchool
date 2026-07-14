import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Requires the dev infrastructure (postgres + redis) to be up:
 *   docker compose up -d postgres redis
 */
describe('Health & Version (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health → 200 with component statuses', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    const body = res.body as { status: string; details: object };
    expect(body.status).toBe('ok');
    expect(body.details).toMatchObject({
      database: { status: 'up' },
      redis: { status: 'up' },
      // disk probe runs on Linux only (wmic is gone on modern Windows)
      ...(process.platform !== 'win32' && { disk: { status: 'up' } }),
      memory_heap: { status: 'up' },
      memory_rss: { status: 'up' },
    });
  });

  it('GET /api/v1/version → enveloped build metadata', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/version')
      .expect(200);

    const body = res.body as {
      success: boolean;
      data: { sha: string; buildTime: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.sha).toBeDefined();
    expect(body.data.buildTime).toBeDefined();
  });

  it('unknown route → standard error envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .expect(404);

    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});
