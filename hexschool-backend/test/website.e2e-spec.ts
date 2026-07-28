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
 * Requires dev infra (DB + redis). Module 19's e2e suite is, per the
 * roadmap's own testing checklist (§9), primarily a **privacy suite**:
 * the public endpoints are the only ones in this system an anonymous
 * stranger can reach, so what matters is that they leak nothing
 * unpublished and nothing personal.
 *
 * It covers, in order: the admin CRUD surface and its permission gating,
 * the publish lifecycle, the public read API (published-only, draft 404s,
 * signed preview), the teacher-directory privacy contract, student
 * verification and its field allow-list, the public writes (contact form,
 * download counter), and the crawler artifacts.
 */
describe('Website CMS (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-web-admin@test.local';
  const EDITOR = 'e2e-web-editor@test.local';
  const PLAIN = 'e2e-web-plain@test.local';
  const TEACHER = 'e2e-web-teacher@test.local';
  const TEACHER_PHONE = '01911112222';
  const NAME = 'E2EWEB';

  let adminToken: string;
  let editorToken: string;
  let plainToken: string;

  let pageId: string;
  let newsId: string;
  let galleryId: string;
  let downloadId: string;
  let careerId: string;
  let studentUid: string;
  let studentQrToken: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;

  const emails = [ADMIN, EDITOR, PLAIN, TEACHER];

  const cleanup = async () => {
    await prisma.contactMessage.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.careerApplication.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.career.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, title: { startsWith: NAME } },
    });
    await prisma.galleryItem.deleteMany({
      where: { gallery: { title: { startsWith: NAME } } },
    });
    await prisma.gallery.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, title: { startsWith: NAME } },
    });
    await prisma.download.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, title: { startsWith: NAME } },
    });
    await prisma.faq.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, question: { startsWith: NAME } },
    });
    await prisma.committeeMember.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.newsPost.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, slug: { startsWith: 'e2eweb-' } },
    });
    await prisma.cmsPage.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, slug: { startsWith: 'e2eweb-' } },
    });
    await prisma.notice.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, title: { startsWith: NAME } },
    });
    await prisma.student.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: NAME },
    });
    await prisma.teacher.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: NAME },
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
    const [adminUser, editorUser] = await Promise.all([
      mk(ADMIN, UserType.ADMIN),
      mk(EDITOR, UserType.STAFF),
      mk(PLAIN, UserType.STAFF),
    ]);

    const [adminRole, officeRole] = await Promise.all([
      prisma.role.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, slug: 'admin', deletedAt: null },
      }),
      prisma.role.findFirst({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          slug: 'office-staff',
          deletedAt: null,
        },
      }),
    ]);
    await prisma.userRole.createMany({
      data: [
        { userId: adminUser.id, roleId: adminRole!.id },
        // Office Staff deliberately lacks `website.page.manage` — the
        // institutional pages are the head's words (system-roles.ts).
        { userId: editorUser.id, roleId: officeRole!.id },
      ],
    });

    // A teacher for the directory, and a student for verification.
    // A teacher's contact details live on their USER row (M08 — a teacher
    // shares the user), which is precisely why the directory query, which
    // never joins `users`, cannot leak one.
    const teacherUser = await prisma.user.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        email: TEACHER,
        phone: TEACHER_PHONE,
        passwordHash,
        userType: UserType.TEACHER,
      },
    });
    await prisma.teacher.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        userId: teacherUser.id,
        employeeId: `E2EWEB-T-${Date.now()}`,
        firstName: NAME,
        lastName: 'Teacher',
        gender: 'FEMALE',
        dob: new Date('1988-05-05'),
        nidNumber: '1990123456789',
        designation: 'SENIOR_TEACHER',
        joiningDate: new Date('2020-01-01'),
        status: 'ACTIVE',
      },
    });

    studentUid = `E2EWEB-S-${Date.now()}`;
    studentQrToken = randomUUID();
    await prisma.student.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        studentUid,
        firstName: NAME,
        lastName: 'Student',
        gender: 'MALE',
        dob: new Date('2013-03-03'),
        admissionDate: new Date('2026-01-02'),
        qrToken: studentQrToken,
        photoUrl: 'https://cdn.example/photo.png',
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
    editorToken = await login(EDITOR);
    plainToken = await login(PLAIN);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  // ── admin CRUD + permissions ────────────────────────────────────────

  describe('CMS pages', () => {
    it('creates a page and derives a kebab-case slug from the title', async () => {
      const res = await server()
        .post('/api/v1/cms/pages')
        .set(auth(adminToken))
        .send({ title: 'E2EWEB About Us', content: '<p>Founded 1972</p>' })
        .expect(201);
      const page = dataOf<{ id: string; slug: string; status: string }>(res);
      pageId = page.id;
      expect(page.slug).toBe('e2eweb-about-us');
      expect(page.status).toBe('DRAFT');
    });

    it('sanitizes authored markup on write', async () => {
      const res = await server()
        .post('/api/v1/cms/pages')
        .set(auth(adminToken))
        .send({
          title: 'E2EWEB XSS',
          slug: 'e2eweb-xss',
          content:
            '<p onclick="steal()">Hi</p><script>alert(1)</script><a href="javascript:x">link</a>',
        })
        .expect(201);
      const page = dataOf<{ content: string }>(res);
      expect(page.content).not.toMatch(/script/i);
      expect(page.content).not.toMatch(/onclick/i);
      expect(page.content).not.toMatch(/javascript:/i);
      expect(page.content).toContain('Hi');
    });

    it('refuses a slug that would shadow an application route', async () => {
      await server()
        .post('/api/v1/cms/pages')
        .set(auth(adminToken))
        .send({ title: 'E2EWEB Admin', slug: 'admin', content: '<p>x</p>' })
        .expect(400);
    });

    it('refuses a slug that is not kebab-case', async () => {
      await server()
        .post('/api/v1/cms/pages')
        .set(auth(adminToken))
        .send({ title: 'E2EWEB Bad', slug: 'Not A Slug', content: '<p>x</p>' })
        .expect(400);
    });

    it('409s on a duplicate slug', async () => {
      await server()
        .post('/api/v1/cms/pages')
        .set(auth(adminToken))
        .send({
          title: 'E2EWEB Duplicate',
          slug: 'e2eweb-about-us',
          content: '<p>x</p>',
        })
        .expect(409);
    });

    it('403s a user without website.page.manage (Office Staff)', async () => {
      await server()
        .post('/api/v1/cms/pages')
        .set(auth(editorToken))
        .send({ title: 'E2EWEB Nope', content: '<p>x</p>' })
        .expect(403);
    });

    it('403s a user with no website permissions at all', async () => {
      await server().get('/api/v1/cms/pages').set(auth(plainToken)).expect(403);
    });

    it('401s an anonymous request to the admin API', async () => {
      await server().get('/api/v1/cms/pages').expect(401);
    });

    it('publishes the page and stamps published_at', async () => {
      const res = await server()
        .put(`/api/v1/cms/pages/${pageId}/publish`)
        .set(auth(adminToken))
        .send({ publish: true })
        .expect(200);
      const page = dataOf<{ status: string; publishedAt: string | null }>(res);
      expect(page.status).toBe('PUBLISHED');
      expect(page.publishedAt).not.toBeNull();
    });

    it('keeps published_at when the page is unpublished and re-published', async () => {
      const first = await prisma.cmsPage.findUnique({ where: { id: pageId } });
      await server()
        .put(`/api/v1/cms/pages/${pageId}/publish`)
        .set(auth(adminToken))
        .send({ publish: false })
        .expect(200);
      const res = await server()
        .put(`/api/v1/cms/pages/${pageId}/publish`)
        .set(auth(adminToken))
        .send({ publish: true })
        .expect(200);
      const page = dataOf<{ publishedAt: string }>(res);
      expect(new Date(page.publishedAt).toISOString()).toBe(
        first!.publishedAt!.toISOString(),
      );
    });
  });

  describe('news, galleries, downloads, careers', () => {
    it('creates and publishes a news post', async () => {
      const res = await server()
        .post('/api/v1/cms/news')
        .set(auth(adminToken))
        .send({
          title: 'E2EWEB Sports Day',
          slug: 'e2eweb-sports-day',
          content: '<p>Held on the school ground</p>',
          category: 'NEWS',
          status: 'PUBLISHED',
        })
        .expect(201);
      const post = dataOf<{ id: string; publishedAt: string | null }>(res);
      newsId = post.id;
      expect(post.publishedAt).not.toBeNull();
    });

    it('lets Office Staff manage news (but not pages)', async () => {
      const res = await server()
        .post('/api/v1/cms/news')
        .set(auth(editorToken))
        .send({
          title: 'E2EWEB Office Post',
          slug: 'e2eweb-office-post',
          content: '<p>from the desk</p>',
        })
        .expect(201);
      expect(dataOf<{ status: string }>(res).status).toBe('DRAFT');
    });

    it('creates a gallery with its items in one call', async () => {
      const res = await server()
        .post('/api/v1/cms/galleries')
        .set(auth(adminToken))
        .send({
          title: 'E2EWEB Annual Day',
          status: 'PUBLISHED',
          items: [
            { type: 'IMAGE', url: 'https://cdn.example/1.jpg', caption: 'One' },
            { type: 'IMAGE', url: 'https://cdn.example/2.jpg' },
            { type: 'VIDEO_URL', url: 'https://youtu.be/abc' },
          ],
        })
        .expect(201);
      galleryId = dataOf<{ id: string }>(res).id;
      const items = await prisma.galleryItem.count({ where: { galleryId } });
      expect(items).toBe(3);
    });

    it('replaces the item set on update rather than appending', async () => {
      await server()
        .put(`/api/v1/cms/galleries/${galleryId}`)
        .set(auth(adminToken))
        .send({
          items: [{ type: 'IMAGE', url: 'https://cdn.example/only.jpg' }],
        })
        .expect(200);
      const items = await prisma.galleryItem.findMany({ where: { galleryId } });
      expect(items).toHaveLength(1);
      expect(items[0].url).toBe('https://cdn.example/only.jpg');
    });

    it('creates a published download', async () => {
      const res = await server()
        .post('/api/v1/cms/downloads')
        .set(auth(adminToken))
        .send({
          title: 'E2EWEB Admission Form',
          fileUrl: 'https://cdn.example/form.pdf',
          sizeBytes: 12345,
          status: 'PUBLISHED',
        })
        .expect(201);
      downloadId = dataOf<{ id: string }>(res).id;
    });

    it('creates a published job opening', async () => {
      const res = await server()
        .post('/api/v1/cms/careers')
        .set(auth(adminToken))
        .send({
          title: 'E2EWEB Physics Teacher',
          description: '<p>MSc in Physics required</p>',
          status: 'PUBLISHED',
        })
        .expect(201);
      careerId = dataOf<{ id: string }>(res).id;
    });

    it('403s Office Staff on the careers pipeline', async () => {
      await server()
        .post('/api/v1/cms/careers')
        .set(auth(editorToken))
        .send({ title: 'E2EWEB Nope', description: '<p>x</p>' })
        .expect(403);
    });
  });

  // ── the public API: published only ──────────────────────────────────

  describe('public reads', () => {
    it('serves the site config anonymously', async () => {
      const res = await server().get('/api/v1/public/config').expect(200);
      const config = dataOf<{
        school: { name: string } | null;
        features: { certificateVerification: boolean };
      }>(res);
      expect(config.school).not.toBeNull();
      // Module 27 turns this on.
      expect(config.features.certificateVerification).toBe(false);
    });

    it('serves the home payload anonymously', async () => {
      const res = await server().get('/api/v1/public/home').expect(200);
      const home = dataOf<{
        stats: { students: number };
        news: Array<{ slug: string }>;
      }>(res);
      expect(home.stats).toBeDefined();
      expect(home.news.some((post) => post.slug === 'e2eweb-sports-day')).toBe(
        true,
      );
    });

    it('serves a published page anonymously', async () => {
      const res = await server()
        .get('/api/v1/public/pages/e2eweb-about-us')
        .expect(200);
      expect(dataOf<{ title: string }>(res).title).toBe('E2EWEB About Us');
    });

    it('404s a DRAFT page for an anonymous visitor', async () => {
      // `e2eweb-office-post` is a draft news post; the XSS page is a draft too.
      await server().get('/api/v1/public/pages/e2eweb-xss').expect(404);
      await server().get('/api/v1/public/news/e2eweb-office-post').expect(404);
    });

    it('returns the same 404 body for a draft as for a missing page', async () => {
      const missing = await server()
        .get('/api/v1/public/pages/e2eweb-does-not-exist')
        .expect(404);
      const draft = await server()
        .get('/api/v1/public/pages/e2eweb-xss')
        .expect(404);
      expect((draft.body as { error: { message: string } }).error.message).toBe(
        (missing.body as { error: { message: string } }).error.message,
      );
    });

    it('serves a draft to a valid preview token, and only that row', async () => {
      const draft = await prisma.cmsPage.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, slug: 'e2eweb-xss' },
      });
      const tokenRes = await server()
        .post('/api/v1/cms/preview-token')
        .set(auth(adminToken))
        .send({ type: 'page', id: draft!.id })
        .expect(201);
      const { token } = dataOf<{ token: string }>(tokenRes);

      const ok = await server()
        .get(`/api/v1/public/pages/e2eweb-xss?preview=${token}`)
        .expect(200);
      expect(dataOf<{ isDraft: boolean }>(ok).isDraft).toBe(true);

      // The same token must not unlock a different draft.
      const otherDraft = await prisma.cmsPage.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          slug: 'e2eweb-other-draft',
          title: 'E2EWEB Other',
          content: '<p>other</p>',
        },
      });
      await server()
        .get(`/api/v1/public/pages/${otherDraft.slug}?preview=${token}`)
        .expect(404);
    });

    it('ignores a forged preview token', async () => {
      await server()
        .get('/api/v1/public/pages/e2eweb-xss?preview=not-a-token')
        .expect(404);
    });

    it('lists only published news', async () => {
      const res = await server().get('/api/v1/public/news').expect(200);
      const feed = dataOf<{ items: Array<{ slug: string }> }>(res);
      const slugs = feed.items.map((post) => post.slug);
      expect(slugs).toContain('e2eweb-sports-day');
      expect(slugs).not.toContain('e2eweb-office-post');
    });

    it('lists only published galleries, downloads and careers', async () => {
      const [galleries, downloads, careers] = await Promise.all([
        server().get('/api/v1/public/galleries').expect(200),
        server().get('/api/v1/public/downloads').expect(200),
        server().get('/api/v1/public/careers').expect(200),
      ]);
      expect(
        dataOf<Array<{ id: string }>>(galleries).some(
          (row) => row.id === galleryId,
        ),
      ).toBe(true);
      expect(
        dataOf<Array<{ id: string }>>(downloads).some(
          (row) => row.id === downloadId,
        ),
      ).toBe(true);
      expect(
        dataOf<Array<{ id: string }>>(careers).some(
          (row) => row.id === careerId,
        ),
      ).toBe(true);
    });

    it('hides a gallery the moment it is unpublished', async () => {
      await server()
        .put(`/api/v1/cms/galleries/${galleryId}/publish`)
        .set(auth(adminToken))
        .send({ publish: false })
        .expect(200);
      const res = await server().get('/api/v1/public/galleries').expect(200);
      expect(
        dataOf<Array<{ id: string }>>(res).some((row) => row.id === galleryId),
      ).toBe(false);
      await server().get(`/api/v1/public/galleries/${galleryId}`).expect(404);
      // restore for the remaining assertions
      await server()
        .put(`/api/v1/cms/galleries/${galleryId}/publish`)
        .set(auth(adminToken))
        .send({ publish: true })
        .expect(200);
    });

    it('serves only website-visible notices', async () => {
      const [visible] = await Promise.all([
        prisma.notice.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            title: `${NAME} Public notice`,
            body: 'Everyone may read this',
            isPublished: true,
            isWebsiteVisible: true,
          },
        }),
        prisma.notice.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            title: `${NAME} Internal notice`,
            body: 'Portal only',
            isPublished: true,
            isWebsiteVisible: false,
          },
        }),
        prisma.notice.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            title: `${NAME} Unpublished notice`,
            body: 'Not out yet',
            isPublished: false,
            isWebsiteVisible: true,
          },
        }),
      ]);

      const res = await server().get('/api/v1/public/notices').expect(200);
      const titles = dataOf<{ items: Array<{ title: string }> }>(res).items.map(
        (notice) => notice.title,
      );
      expect(titles).toContain(`${NAME} Public notice`);
      expect(titles).not.toContain(`${NAME} Internal notice`);
      expect(titles).not.toContain(`${NAME} Unpublished notice`);

      await server().get(`/api/v1/public/notices/${visible.id}`).expect(200);
    });

    it('404s a notice that is published but not website-visible', async () => {
      const internal = await prisma.notice.findFirst({
        where: { title: `${NAME} Internal notice` },
      });
      await server().get(`/api/v1/public/notices/${internal!.id}`).expect(404);
    });
  });

  // ── privacy: the directory and verification ─────────────────────────

  describe('teacher directory privacy', () => {
    it('never exposes a teacher’s phone, email or NID', async () => {
      const res = await server().get('/api/v1/public/teachers').expect(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain(NAME);
      expect(body).not.toContain(TEACHER_PHONE);
      expect(body).not.toContain(TEACHER);
      expect(body).not.toContain('1990123456789');
      expect(body).not.toMatch(/"nidNumber"|"address"|"dob"/);
    });
  });

  describe('student verification', () => {
    it('verifies by student UID and returns only allow-listed fields', async () => {
      const res = await server()
        .post('/api/v1/public/verify/student')
        .send({ identifier: studentUid })
        .expect(201);
      const body = dataOf<Record<string, unknown>>(res);
      expect(body.verified).toBe(true);
      expect(body.name).toContain(NAME);
      // Never, under any setting:
      expect(body).not.toHaveProperty('dob');
      expect(body).not.toHaveProperty('guardians');
      expect(body).not.toHaveProperty('birthCertNo');
      expect(JSON.stringify(body)).not.toContain('2013-03-03');
    });

    it('verifies by QR token too', async () => {
      const res = await server()
        .post('/api/v1/public/verify/student')
        .send({ identifier: studentQrToken })
        .expect(201);
      expect(dataOf<{ studentUid: string }>(res).studentUid).toBe(studentUid);
    });

    it('404s an unknown identifier', async () => {
      await server()
        .post('/api/v1/public/verify/student')
        .send({ identifier: 'NOT-A-REAL-UID' })
        .expect(404);
    });

    it('answers the certificate stub self-describingly (Module 27 fills it)', async () => {
      const res = await server()
        .get('/api/v1/public/verify/certificate?code=TC-26-0001')
        .expect(200);
      const body = dataOf<{ available: boolean; reason: string }>(res);
      expect(body.available).toBe(false);
      expect(body.reason).toMatch(/27/);
    });
  });

  // ── public writes ───────────────────────────────────────────────────

  describe('contact form', () => {
    it('accepts a message and stores it as NEW', async () => {
      await server()
        .post('/api/v1/public/contact')
        .send({
          name: `${NAME} Parent`,
          phone: '01711112222',
          subject: 'Admission query',
          body: 'When does admission open for class six?',
        })
        .expect(201);

      const row = await prisma.contactMessage.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, name: `${NAME} Parent` },
      });
      expect(row).not.toBeNull();
      expect(row!.status).toBe('NEW');
    });

    it('strips markup from a submitted message', async () => {
      await server()
        .post('/api/v1/public/contact')
        .send({
          name: `${NAME} Scripter`,
          email: 'x@test.local',
          body: '<script>alert(1)</script>Hello there',
        })
        .expect(201);
      const row = await prisma.contactMessage.findFirst({
        where: { name: `${NAME} Scripter` },
      });
      expect(row!.body).not.toMatch(/<script/i);
      expect(row!.body).toContain('Hello there');
    });

    it('refuses a message with neither a phone nor an email', async () => {
      await server()
        .post('/api/v1/public/contact')
        .send({ name: `${NAME} Ghost`, body: 'No way to reply to me' })
        .expect(400);
    });

    it('refuses a malformed BD phone number', async () => {
      await server()
        .post('/api/v1/public/contact')
        .send({ name: `${NAME} Bad`, phone: '12345', body: 'Hello there' })
        .expect(400);
    });

    it('lands in the admin inbox, and status changes carry their evidence', async () => {
      const list = await server()
        .get('/api/v1/cms/contact-messages')
        .set(auth(adminToken))
        .expect(200);
      const rows = (list.body as { data: Array<{ id: string; name: string }> })
        .data;
      const message = rows.find((row) => row.name === `${NAME} Parent`);
      expect(message).toBeDefined();

      const replied = await server()
        .put(`/api/v1/cms/contact-messages/${message!.id}/status`)
        .set(auth(adminToken))
        .send({ status: 'REPLIED' })
        .expect(200);
      const updated = dataOf<{
        status: string;
        readAt: string | null;
        repliedAt: string | null;
      }>(replied);
      expect(updated.status).toBe('REPLIED');
      expect(updated.repliedAt).not.toBeNull();
      expect(updated.readAt).not.toBeNull();
    });

    it('403s the inbox for a user without website.message.view', async () => {
      await server()
        .get('/api/v1/cms/contact-messages')
        .set(auth(plainToken))
        .expect(403);
    });
  });

  describe('download counter', () => {
    it('increments in the database and returns the file URL', async () => {
      const before = await prisma.download.findUnique({
        where: { id: downloadId },
      });
      const res = await server()
        .post(`/api/v1/public/downloads/${downloadId}/hit`)
        .expect(201);
      const body = dataOf<{ fileUrl: string; downloadCount: number }>(res);
      expect(body.fileUrl).toBe('https://cdn.example/form.pdf');
      expect(body.downloadCount).toBe(before!.downloadCount + 1);
    });

    it('404s a hit against an unpublished file and counts nothing', async () => {
      await server()
        .put(`/api/v1/cms/downloads/${downloadId}`)
        .set(auth(adminToken))
        .send({ status: 'DRAFT' })
        .expect(200);
      const before = await prisma.download.findUnique({
        where: { id: downloadId },
      });
      await server()
        .post(`/api/v1/public/downloads/${downloadId}/hit`)
        .expect(404);
      const after = await prisma.download.findUnique({
        where: { id: downloadId },
      });
      expect(after!.downloadCount).toBe(before!.downloadCount);
    });
  });

  // ── crawler artifacts ───────────────────────────────────────────────

  describe('sitemap, robots and RSS', () => {
    it('renders a valid sitemap', async () => {
      const res = await server().get('/api/v1/public/sitemap.xml').expect(200);
      expect(res.text).toContain('<urlset');
      expect(res.text).toContain('</urlset>');
    });

    it('renders robots.txt', async () => {
      const res = await server().get('/api/v1/public/robots.txt').expect(200);
      expect(res.text).toContain('User-agent: *');
    });

    it('renders an RSS channel', async () => {
      const res = await server().get('/api/v1/public/rss.xml').expect(200);
      expect(res.text).toContain('<rss version="2.0">');
      expect(res.text).toContain('</channel>');
    });

    it('never lists a draft in the sitemap URL feed', async () => {
      const res = await server().get('/api/v1/public/sitemap-urls').expect(200);
      const paths = dataOf<Array<{ path: string }>>(res).map((row) => row.path);
      expect(paths).toContain('/e2eweb-about-us');
      expect(paths).not.toContain('/e2eweb-xss');
      expect(paths).not.toContain('/news/e2eweb-office-post');
    });
  });

  // ── deletion removes content from the site ──────────────────────────

  describe('deletion', () => {
    it('takes a deleted page off the public site immediately', async () => {
      await server()
        .delete(`/api/v1/cms/pages/${pageId}`)
        .set(auth(adminToken))
        .expect(204);
      await server().get('/api/v1/public/pages/e2eweb-about-us').expect(404);
    });

    it('frees the slug of a deleted page for reuse', async () => {
      // The partial unique index excludes soft-deleted rows, so the slug
      // must be available again (the M06/M16 tombstone rule).
      const res = await server()
        .post('/api/v1/cms/pages')
        .set(auth(adminToken))
        .send({
          title: 'E2EWEB About Us Rewritten',
          slug: 'e2eweb-about-us',
          content: '<p>Take two</p>',
        })
        .expect(201);
      expect(dataOf<{ slug: string }>(res).slug).toBe('e2eweb-about-us');
    });

    it('takes a deleted news post off the feed', async () => {
      await server()
        .delete(`/api/v1/cms/news/${newsId}`)
        .set(auth(adminToken))
        .expect(204);
      const res = await server().get('/api/v1/public/news').expect(200);
      expect(
        dataOf<{ items: Array<{ slug: string }> }>(res).items.some(
          (post) => post.slug === 'e2eweb-sports-day',
        ),
      ).toBe(false);
    });
  });
});
