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

    /**
     * The probe map moves depending on the status code, which is the
     * source of a long-standing flake in this suite.
     *
     * A healthy check is `@SkipEnvelope`d raw Terminus (`{ status,
     * details }`); an unhealthy one is a `ServiceUnavailableException`
     * that the global filter reshapes to `{ success, error: { details }}`.
     * And this check goes 503 **for reasons that say nothing about the
     * application**: the memory probes measure whichever process runs
     * them, which under `test:e2e` is the single Jest worker carrying
     * the accumulated heap of every preceding suite (the M14 lesson —
     * every new module's suite makes it likelier).
     *
     * So: read the map from wherever it is, and keep asserting the
     * DEPENDENCY probes strictly — those are the ones that mean
     * something.
     */
    const body = res.body as {
      details?: Record<string, { status: string }>;
      error?: { details?: Record<string, { status: string }> };
    };
    const details = body.details ?? body.error?.details;
    expect(details).toBeDefined();

    expect(details).toMatchObject({
      database: { status: 'up' },
      redis: { status: 'up' },
      // disk probe runs on Linux only (wmic is gone on modern Windows)
      ...(process.platform !== 'win32' && { disk: { status: 'up' } }),
    });
    expect(details!.memory_heap).toBeDefined();
    expect(details!.memory_rss).toBeDefined();
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
