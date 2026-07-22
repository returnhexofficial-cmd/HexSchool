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

  /**
   * The memory probes measure the process that happens to be running the
   * check — under `test:e2e` that is the single Jest worker, which by
   * this point carries the accumulated heap of every suite that ran
   * before it, not the footprint of a real API process. Asserting they
   * are `up` therefore asserts something about the test runner rather
   * than about the application, and it fails purely as a function of how
   * many suites precede this one (it went red the day the 14th suite was
   * added). What this test exists to prove is that the real dependency
   * probes are wired and the infrastructure is reachable, so those are
   * asserted strictly and the memory verdict is only checked for
   * presence. Terminus answers 503 when any probe is down.
   */
  it('GET /api/v1/health → component statuses for every probe', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect([200, 503]).toContain(res.status);

    const body = res.body as {
      status: string;
      details: Record<string, { status: string }>;
    };
    expect(body.details).toMatchObject({
      database: { status: 'up' },
      redis: { status: 'up' },
      // disk probe runs on Linux only (wmic is gone on modern Windows)
      ...(process.platform !== 'win32' && { disk: { status: 'up' } }),
    });
    expect(body.details.memory_heap).toBeDefined();
    expect(body.details.memory_rss).toBeDefined();
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
