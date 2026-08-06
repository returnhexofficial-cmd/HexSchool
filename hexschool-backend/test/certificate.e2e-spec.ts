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
 * Requires dev infra (DB + redis). Module 27 — Documents & Certificates.
 *
 * Built around what unit tests structurally cannot see:
 *
 *   1. **Roadmap §9's flow, end to end**: "issue TC → student status
 *      change → public verify VALID → revoke → verify shows REVOKED". It
 *      crosses the M09 status machine, a DI token bound in a *different*
 *      module (`CERTIFICATE_VERIFIER`, inside WebsiteModule) and an
 *      `@Public()` route — exactly the kind of wiring that compiles and
 *      then does nothing (the M18/M21 lesson, twice learned).
 *   2. **The clearance aggregate**, which is the thing three earlier
 *      modules have been pointing at. Only a live request proves that
 *      M16's dues, M23's library and M26's hostel arrive in ONE verdict.
 *   3. **The database invariants** — the never-reuse number index, the
 *      status-evidence CHECK, the issue-kind CHECK and the folder
 *      identity index — each asserted to refuse a bad row through the API.
 *   4. **Separation of duties.** The seeded Office Staff issues and may
 *      NOT revoke, waive clearance or backfill; the head holds all three.
 *      This is the only place the seeded role set meets live requests.
 */
describe('Documents & Certificates (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-ce-admin@test.local';
  const OFFICE = 'e2e-ce-office@test.local';
  const STUDENT = 'e2e-ce-student@test.local';
  const NAME = 'E2ECE';

  let adminToken: string;
  let officeToken: string;
  let studentToken: string;

  let sessionId: string;
  let classId: string;
  let sectionId: string;
  let templateId: string;
  let folderId: string;
  const enrollments = new Map<number, string>();
  const studentIds = new Map<number, string>();

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;
  const errorOf = (res: request.Response): string =>
    (res.body as { error?: { message?: string } }).error?.message ?? '';

  const emails = [ADMIN, OFFICE, STUDENT];

  /**
   * `YYYY-MM-DD`, `offset` days from today **in Asia/Dhaka** — the M25/M26
   * Dhaka-midnight rule. A suite that passes at 14:00 and fails at 19:00
   * is not flaky, it is wrong.
   */
  const DHAKA_OFFSET_MS = 6 * 3_600_000;
  const day = (offset: number): string =>
    new Date(Date.now() + DHAKA_OFFSET_MS + offset * 86_400_000)
      .toISOString()
      .slice(0, 10);

  const cleanup = async () => {
    // Certificates first: the self-FK on `original_certificate_id` is
    // RESTRICT, so a duplicate has to go before the original it points at.
    await prisma.certificate.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        issueKind: { in: ['DUPLICATE', 'CORRECTION'] },
        student: { firstName: NAME },
      },
    });
    await prisma.certificate.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, student: { firstName: NAME } },
    });
    await prisma.certificateTemplate.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.archiveFile.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, title: { startsWith: NAME } },
    });
    // Children before parents — `fk_archive_folders_parent` is RESTRICT.
    await prisma.archiveFolder.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: { startsWith: NAME },
        parentId: { not: null },
      },
    });
    await prisma.archiveFolder.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.invoiceItem.deleteMany({
      where: { invoice: { enrollment: { student: { firstName: NAME } } } },
    });
    await prisma.invoice.deleteMany({
      where: { enrollment: { student: { firstName: NAME } } },
    });
    await prisma.studentStatusHistory.deleteMany({
      where: { student: { firstName: NAME } },
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
        templateCode: { in: ['CERTIFICATE_ISSUED', 'CERTIFICATE_REVOKED'] },
      },
    });
    // The per-type, per-year counters this run burned, so a re-run starts
    // at 0001 again and the number assertions stay exact.
    await prisma.documentSequence.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        prefix: { startsWith: 'certificate:' },
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
    const [adminUser, officeUser, studentUser] = await Promise.all([
      mk(ADMIN, UserType.ADMIN),
      mk(OFFICE, UserType.STAFF),
      mk(STUDENT, UserType.STUDENT),
    ]);

    const roleFor = (slug: string) =>
      prisma.role.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, slug, deletedAt: null },
      });
    const [adminRole, officeRole] = await Promise.all([
      roleFor('admin'),
      roleFor('office-staff'),
    ]);
    await prisma.userRole.createMany({
      data: [
        { userId: adminUser.id, roleId: adminRole!.id },
        { userId: officeUser.id, roleId: officeRole!.id },
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
        name: 'C1',
        roomNo: `R-${NAME}`,
      },
    });
    sectionId = section.id;

    // Roll 1 is the clean leaver, roll 2 owes money (the clearance gate),
    // roll 3 is the spare for duplicates and drafts.
    for (let roll = 1; roll <= 3; roll += 1) {
      const student = await prisma.student.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          userId: roll === 1 ? studentUser.id : null,
          studentUid: `${NAME}-${Date.now()}-${roll}`,
          firstName: NAME,
          lastName: `Leaver${roll}`,
          gender: 'MALE',
          dob: new Date('2011-03-03'),
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

    // The father whose name a transfer certificate has to print.
    const guardian = await prisma.guardian.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `${NAME} Father`,
        phone: `0171${String(Date.now()).slice(-7)}`,
        relation: 'FATHER',
      },
    });
    await prisma.studentGuardian.createMany({
      data: [1, 2, 3].map((roll) => ({
        studentId: studentIds.get(roll)!,
        guardianId: guardian.id,
        isPrimary: true,
      })),
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
    studentToken = await login(STUDENT);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  // ── templates ───────────────────────────────────────────────────────

  describe('templates', () => {
    it('publishes the variable palette a designer clicks', async () => {
      const res = await server()
        .get('/api/v1/certificate-templates/variables')
        .set(auth(officeToken))
        .expect(200);
      const body = dataOf<{ variables: string[] }>(res);
      expect(body.variables).toContain('student_name');
      expect(body.variables).toContain('certificate_no');
      expect(body.variables).toContain('verify_code');
    });

    it('creates a transfer-certificate layout', async () => {
      const res = await server()
        .post('/api/v1/certificate-templates')
        .set(auth(officeToken))
        .send({
          type: 'TRANSFER',
          name: `${NAME} Standard TC`,
          bodyHtml:
            '<p>This certifies that {{student_name}}, son of {{father_name}}, of {{class}} ({{session}}) left this school. Conduct: {{conduct}}.</p>',
          signatories: [{ name: 'Head Teacher', designation: 'Principal' }],
        })
        .expect(201);
      templateId = dataOf<{ id: string }>(res).id;
    });

    it('refuses a variable that is not in the palette', async () => {
      // M17's renderer blanks an unknown variable, which is right for an
      // SMS that must still send and wrong for a certificate the school
      // hands over with a hole in it.
      const res = await server()
        .post('/api/v1/certificate-templates')
        .set(auth(officeToken))
        .send({
          type: 'CHARACTER',
          name: `${NAME} Broken`,
          bodyHtml: '<p>{{studnet_name}} is of good character.</p>',
        })
        .expect(400);
      expect(errorOf(res)).toContain('studnet_name');
    });

    it('sanitizes author markup on WRITE', async () => {
      const res = await server()
        .post('/api/v1/certificate-templates')
        .set(auth(officeToken))
        .send({
          type: 'CHARACTER',
          name: `${NAME} Sanitized`,
          bodyHtml:
            '<p>Good character.</p><script>alert(1)</script><p onclick="evil()">x</p>',
        })
        .expect(201);
      const body = dataOf<{ id: string; bodyHtml: string }>(res);
      expect(body.bodyHtml).not.toContain('<script');
      expect(body.bodyHtml).not.toContain('onclick');
      await server()
        .delete(`/api/v1/certificate-templates/${body.id}`)
        .set(auth(officeToken))
        .expect(204);
    });

    it('refuses a second live layout of the same type and name', async () => {
      await server()
        .post('/api/v1/certificate-templates')
        .set(auth(officeToken))
        .send({
          type: 'TRANSFER',
          name: `  ${NAME} standard tc  `,
          bodyHtml: '<p>x</p>',
        })
        .expect(409);
    });

    it('allows the same name for a DIFFERENT type', async () => {
      const res = await server()
        .post('/api/v1/certificate-templates')
        .set(auth(officeToken))
        .send({
          type: 'CHARACTER',
          name: `${NAME} Standard TC`,
          bodyHtml: '<p>{{student_name}} is of {{conduct}} character.</p>',
        })
        .expect(201);
      await server()
        .delete(`/api/v1/certificate-templates/${dataOf<{ id: string }>(res).id}`)
        .set(auth(officeToken))
        .expect(204);
    });

    it('previews against a specimen when no student is named', async () => {
      const res = await server()
        .post(`/api/v1/certificate-templates/${templateId}/preview`)
        .set(auth(officeToken))
        .send({})
        .expect(201);
      const body = dataOf<{ html: string; sample: boolean }>(res);
      expect(body.sample).toBe(true);
      expect(body.html).toContain('Specimen Student');
    });

    it('previews against a real student when one is named', async () => {
      const res = await server()
        .post(`/api/v1/certificate-templates/${templateId}/preview`)
        .set(auth(officeToken))
        .send({ studentId: studentIds.get(1) })
        .expect(201);
      const body = dataOf<{ html: string; sample: boolean }>(res);
      expect(body.sample).toBe(false);
      expect(body.html).toContain(`${NAME} Leaver1`);
      expect(body.html).toContain(`${NAME} Father`);
      // The placeholder is gone — the bag really was substituted.
      expect(body.html).not.toContain('{{student_name}}');
    });
  });

  // ── clearance ───────────────────────────────────────────────────────

  describe('the clearance aggregate', () => {
    it('clears a student who owes nothing anywhere', async () => {
      const res = await server()
        .get('/api/v1/certificates/clearance')
        .query({ studentId: studentIds.get(1), type: 'TRANSFER' })
        .set(auth(officeToken))
        .expect(200);
      const verdict = dataOf<{
        cleared: boolean;
        allowed: boolean;
        complete: boolean;
        required: boolean;
      }>(res);
      expect(verdict).toMatchObject({
        cleared: true,
        allowed: true,
        complete: true,
        required: true,
      });
    });

    it('reports fee dues, read through the single dues source', async () => {
      // Roll 2 owes money. The invoice is raised directly so the suite
      // does not depend on M16's batch, but the READ goes through
      // `LedgerService.outstandingFor` like every other gate.
      const head = await prisma.feeHead.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, deletedAt: null },
      });
      const invoice = await prisma.invoice.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          enrollmentId: enrollments.get(2)!,
          sessionId,
          invoiceNo: `${NAME}-INV-${Date.now()}`,
          issueDate: new Date(day(-10)),
          dueDate: new Date(day(-3)),
          subtotal: 1500,
          discountTotal: 0,
          fineTotal: 0,
          payable: 1500,
          paidTotal: 0,
          status: 'OVERDUE',
        },
      });
      if (head) {
        await prisma.invoiceItem.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            invoiceId: invoice.id,
            feeHeadId: head.id,
            description: 'Tuition',
            amount: 1500,
          },
        });
      }

      const res = await server()
        .get('/api/v1/certificates/clearance')
        .query({ studentId: studentIds.get(2), type: 'TRANSFER' })
        .set(auth(officeToken))
        .expect(200);
      const verdict = dataOf<{
        cleared: boolean;
        allowed: boolean;
        totalOutstanding: number;
        blockers: Array<{ source: string; amount: number }>;
        reason: string | null;
      }>(res);

      expect(verdict.cleared).toBe(false);
      expect(verdict.allowed).toBe(false);
      expect(verdict.totalOutstanding).toBe(1500);
      expect(verdict.blockers).toContainEqual(
        expect.objectContaining({ source: 'FEES', amount: 1500 }),
      );
      expect(verdict.reason).toContain('certificate.clearance.override');
    });

    /**
     * Roadmap §6 gates the TC and only the TC. A character certificate is
     * a reference; refusing to say a child is of good character over two
     * months' unpaid tuition is a different and meaner act.
     */
    it('does not gate a CHARACTER certificate, but still reports the dues', async () => {
      const res = await server()
        .get('/api/v1/certificates/clearance')
        .query({ studentId: studentIds.get(2), type: 'CHARACTER' })
        .set(auth(officeToken))
        .expect(200);
      const verdict = dataOf<{
        cleared: boolean;
        allowed: boolean;
        required: boolean;
        blockers: unknown[];
      }>(res);
      expect(verdict.required).toBe(false);
      expect(verdict.cleared).toBe(false);
      expect(verdict.allowed).toBe(true);
      expect(verdict.blockers).toHaveLength(1);
    });
  });

  // ── roadmap §9's flow, end to end ───────────────────────────────────

  describe('issue → status change → verify VALID → revoke → verify REVOKED', () => {
    let certificateId: string;
    let certificateNo: string;
    let verifyCode: string;

    it('issues a transfer certificate and freezes the snapshot', async () => {
      const res = await server()
        .post('/api/v1/certificates')
        .set(auth(officeToken))
        .send({
          studentId: studentIds.get(1),
          type: 'TRANSFER',
          templateId,
          issue: true,
          confirmTransfer: true,
        })
        .expect(201);

      const body = dataOf<{
        certificate: {
          id: string;
          certificateNo: string;
          verifyCode: string;
          status: string;
          issueKind: string;
          bodyHtml: string | null;
          dataSnapshot: Record<string, string>;
        };
        warnings: string[];
      }>(res);

      certificateId = body.certificate.id;
      certificateNo = body.certificate.certificateNo;
      verifyCode = body.certificate.verifyCode;

      expect(body.certificate.status).toBe('ISSUED');
      expect(body.certificate.issueKind).toBe('ORIGINAL');
      // Per-type, per-year numbering (PROJECT_CONTEXT §3).
      expect(certificateNo).toMatch(/^TC-\d{2}-0001$/);
      expect(verifyCode).toHaveLength(10);

      // The snapshot carries what the page prints, and the layout is
      // frozen beside it — re-printing years later must reproduce the
      // page even after the template is redesigned.
      expect(body.certificate.dataSnapshot.student_name).toBe(
        `${NAME} Leaver1`,
      );
      expect(body.certificate.dataSnapshot.father_name).toBe(`${NAME} Father`);
      expect(body.certificate.dataSnapshot.class).toBe(`${NAME} Class`);
      expect(body.certificate.bodyHtml).toContain('{{student_name}}');
    });

    it('marked the student TRANSFERRED — roadmap §4', async () => {
      const student = await prisma.student.findUnique({
        where: { id: studentIds.get(1)! },
        select: { status: true },
      });
      expect(student?.status).toBe('TRANSFERRED');

      const history = await prisma.studentStatusHistory.findFirst({
        where: { studentId: studentIds.get(1)!, toStatus: 'TRANSFERRED' },
      });
      expect(history?.reason).toContain(certificateNo);
    });

    it('renders the certificate as a PDF from its own frozen columns', async () => {
      const res = await server()
        .get(`/api/v1/certificates/${certificateId}/pdf`)
        .set(auth(officeToken))
        .buffer(true)
        .expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(Number(res.headers['content-length'])).toBeGreaterThan(1000);
    });

    it('verifies VALID on the PUBLIC endpoint, with no token at all', async () => {
      // The M19 stub answered `{available:false}` here. This is the whole
      // point of the DI token bound inside WebsiteModule.
      const res = await server()
        .get('/api/v1/public/verify/certificate')
        .query({ code: verifyCode })
        .expect(200);

      const body = dataOf<{
        available: boolean;
        outcome: string;
        certificate?: { certificateNo: string; studentName: string };
      }>(res);

      expect(body.available).toBe(true);
      expect(body.outcome).toBe('VALID');
      expect(body.certificate?.certificateNo).toBe(certificateNo);
      expect(body.certificate?.studentName).toBe(`${NAME} Leaver1`);
    });

    it('accepts the code as a person would retype it off the page', async () => {
      const messy = `${verifyCode.slice(0, 4)}-${verifyCode.slice(4)}`
        .toLowerCase()
        .replace(/0/g, 'o')
        .replace(/1/g, 'l');
      const res = await server()
        .get('/api/v1/public/verify/certificate')
        .query({ code: ` ${messy} ` })
        .expect(200);
      expect(dataOf<{ outcome: string }>(res).outcome).toBe('VALID');
    });

    it('reveals nothing beyond the name, class and session', async () => {
      const res = await server()
        .get('/api/v1/public/verify/certificate')
        .query({ code: verifyCode })
        .expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(
        /phone|email|address|gpa|dob|nid/i,
      );
    });

    it('answers NOT_FOUND for an unknown code, without confirming anything', async () => {
      const res = await server()
        .get('/api/v1/public/verify/certificate')
        .query({ code: 'ZZZZZZZZZZ' })
        .expect(200);
      const body = dataOf<{ outcome: string; certificate?: unknown }>(res);
      expect(body.outcome).toBe('NOT_FOUND');
      expect(body.certificate).toBeUndefined();
    });

    it('refuses to revoke as the Office Staff — separation of duties', async () => {
      await server()
        .post(`/api/v1/certificates/${certificateId}/revoke`)
        .set(auth(officeToken))
        .send({ reason: 'Name spelt wrongly on the printed document' })
        .expect(403);
    });

    it('revokes as the head, with a reason', async () => {
      const res = await server()
        .post(`/api/v1/certificates/${certificateId}/revoke`)
        .set(auth(adminToken))
        .send({ reason: 'Name spelt wrongly on the printed document' })
        .expect(201);
      expect(dataOf<{ certificate: { status: string } }>(res).certificate.status)
        .toBe('REVOKED');
    });

    it('now verifies REVOKED — not NOT_FOUND — and gives the reason', async () => {
      // A cancelled document and a forgery must not look identical to
      // whoever is checking.
      const res = await server()
        .get('/api/v1/public/verify/certificate')
        .query({ code: verifyCode })
        .expect(200);
      const body = dataOf<{ outcome: string; message: string }>(res);
      expect(body.outcome).toBe('REVOKED');
      expect(body.message).toContain('Name spelt wrongly');
    });

    it('keeps the file and the register entry', async () => {
      const row = await prisma.certificate.findUnique({
        where: { id: certificateId },
        select: { bodyHtml: true, dataSnapshot: true, deletedAt: true },
      });
      expect(row?.deletedAt).toBeNull();
      expect(row?.bodyHtml).not.toBeNull();
    });

    it('reissues a CORRECTION against the revoked one, linked', async () => {
      const res = await server()
        .post(`/api/v1/certificates/${certificateId}/reissue`)
        .set(auth(officeToken))
        .send({ kind: 'CORRECTION', remarks: 'Spelling corrected' })
        .expect(201);
      const body = dataOf<{
        certificate: {
          certificateNo: string;
          issueKind: string;
          originalCertificateId: string;
        };
      }>(res);
      expect(body.certificate.issueKind).toBe('CORRECTION');
      expect(body.certificate.originalCertificateId).toBe(certificateId);
      // The next number in the same per-type sequence.
      expect(body.certificate.certificateNo).toMatch(/^TC-\d{2}-0002$/);
    });

    it('refuses a DUPLICATE of a revoked certificate', async () => {
      const res = await server()
        .post(`/api/v1/certificates/${certificateId}/reissue`)
        .set(auth(officeToken))
        .send({ kind: 'DUPLICATE' })
        .expect(409);
      expect(errorOf(res)).toContain('still valid');
    });

    it('refuses to revoke the same certificate twice', async () => {
      await server()
        .post(`/api/v1/certificates/${certificateId}/revoke`)
        .set(auth(adminToken))
        .send({ reason: 'Trying to revoke it a second time' })
        .expect(409);
    });
  });

  // ── the clearance gate on a real issue ──────────────────────────────

  describe('the clearance gate', () => {
    it('refuses a TC for the student who owes money', async () => {
      const res = await server()
        .post('/api/v1/certificates')
        .set(auth(officeToken))
        .send({
          studentId: studentIds.get(2),
          type: 'TRANSFER',
          templateId,
          issue: true,
        })
        .expect(409);
      expect(errorOf(res)).toContain('1500.00 BDT owed to fees');
    });

    it('refuses the override to somebody who does not hold it', async () => {
      const res = await server()
        .post('/api/v1/certificates')
        .set(auth(officeToken))
        .send({
          studentId: studentIds.get(2),
          type: 'TRANSFER',
          templateId,
          issue: true,
          clearanceOverrideReason: 'Family paid in cash at the desk, rcpt 4471',
        })
        .expect(403);
      expect(errorOf(res)).toContain('certificate.clearance.override');
    });

    it('lets the head through, and records the waiver against their name', async () => {
      const res = await server()
        .post('/api/v1/certificates')
        .set(auth(adminToken))
        .send({
          studentId: studentIds.get(2),
          type: 'TRANSFER',
          templateId,
          issue: true,
          confirmTransfer: false,
          clearanceOverrideReason: 'Family paid in cash at the desk, rcpt 4471',
        })
        .expect(201);

      const body = dataOf<{
        certificate: { id: string; clearanceOverrideNote: string | null };
        clearance: { cleared: boolean; allowed: boolean };
        warnings: string[];
      }>(res);

      // The waiver never claims the student was clear.
      expect(body.clearance.cleared).toBe(false);
      expect(body.clearance.allowed).toBe(true);
      expect(body.certificate.clearanceOverrideNote).toContain('rcpt 4471');
      expect(body.warnings.join(' ')).toContain(
        'certificate.clearance.override',
      );

      const row = await prisma.certificate.findUnique({
        where: { id: body.certificate.id },
        select: { clearanceOverrideBy: true, clearanceSnapshot: true },
      });
      expect(row?.clearanceOverrideBy).not.toBeNull();
      expect(row?.clearanceSnapshot).not.toBeNull();
    });

    it('did NOT mark that student TRANSFERRED — confirmTransfer was false', async () => {
      const student = await prisma.student.findUnique({
        where: { id: studentIds.get(2)! },
        select: { status: true },
      });
      expect(student?.status).toBe('ACTIVE');
    });

    it('does not record a waiver where none was needed', async () => {
      // `chk_certificates_provenance` reads the presence of
      // `clearance_override_by` as "a waiver was granted here"; recording
      // one against a student who owed nothing would make the audit trail
      // claim something that did not happen.
      const res = await server()
        .post('/api/v1/certificates')
        .set(auth(adminToken))
        .send({
          studentId: studentIds.get(3),
          type: 'CHARACTER',
          issue: true,
          clearanceOverrideReason: 'Offered but not actually needed here',
        })
        .expect(201);
      const id = dataOf<{ certificate: { id: string } }>(res).certificate.id;
      const row = await prisma.certificate.findUnique({
        where: { id },
        select: { clearanceOverrideBy: true, clearanceOverrideNote: true },
      });
      expect(row?.clearanceOverrideBy).toBeNull();
      expect(row?.clearanceOverrideNote).toBeNull();
    });
  });

  // ── drafts and duplicates ───────────────────────────────────────────

  describe('drafts, duplicates and the register', () => {
    let draftId: string;
    let liveCertificateId: string;

    it('saves a draft with no number and no verify code', async () => {
      const res = await server()
        .post('/api/v1/certificates')
        .set(auth(officeToken))
        .send({ studentId: studentIds.get(3), type: 'TESTIMONIAL' })
        .expect(201);
      const body = dataOf<{
        certificate: {
          id: string;
          status: string;
          certificateNo: string | null;
          verifyCode: string | null;
        };
      }>(res);
      draftId = body.certificate.id;
      expect(body.certificate.status).toBe('DRAFT');
      expect(body.certificate.certificateNo).toBeNull();
      expect(body.certificate.verifyCode).toBeNull();
    });

    it('a draft has no public existence', async () => {
      // It has no verify code at all, so there is nothing to look up —
      // which is the point: a draft cannot be one URL away from VALID.
      const rows = await prisma.certificate.count({
        where: { id: draftId, verifyCode: { not: null } },
      });
      expect(rows).toBe(0);
    });

    it('issues the draft in place, keeping its id', async () => {
      const res = await server()
        .post(`/api/v1/certificates/${draftId}/issue`)
        .set(auth(officeToken))
        .send({ studentId: studentIds.get(3), type: 'TESTIMONIAL' })
        .expect(201);
      const body = dataOf<{
        certificate: { id: string; status: string; certificateNo: string };
      }>(res);
      expect(body.certificate.id).toBe(draftId);
      expect(body.certificate.status).toBe('ISSUED');
      expect(body.certificate.certificateNo).toMatch(/^TS-\d{2}-0001$/);
      liveCertificateId = draftId;
    });

    it('refuses to issue the same certificate twice', async () => {
      await server()
        .post(`/api/v1/certificates/${liveCertificateId}/issue`)
        .set(auth(officeToken))
        .send({ studentId: studentIds.get(3), type: 'TESTIMONIAL' })
        .expect(409);
    });

    it('refuses to DELETE an issued certificate', async () => {
      const res = await server()
        .delete(`/api/v1/certificates/${liveCertificateId}`)
        .set(auth(officeToken))
        .expect(409);
      expect(errorOf(res)).toContain('Revoke');
    });

    it('issues a watermarked duplicate that references the original', async () => {
      const res = await server()
        .post(`/api/v1/certificates/${liveCertificateId}/reissue`)
        .set(auth(officeToken))
        .send({ kind: 'DUPLICATE', remarks: 'Family lost the original' })
        .expect(201);
      const body = dataOf<{
        certificate: {
          issueKind: string;
          certificateNo: string;
          dataSnapshot: Record<string, string>;
        };
        warnings: string[];
      }>(res);
      expect(body.certificate.issueKind).toBe('DUPLICATE');
      expect(body.certificate.certificateNo).toMatch(/^TS-\d{2}-0002$/);
      expect(body.certificate.dataSnapshot.original_no).toMatch(
        /^TS-\d{2}-0001$/,
      );
      expect(body.warnings.join(' ')).toContain('original remains valid');
    });

    it('the original still verifies VALID after being duplicated', async () => {
      const row = await prisma.certificate.findUnique({
        where: { id: liveCertificateId },
        select: { verifyCode: true },
      });
      const res = await server()
        .get('/api/v1/public/verify/certificate')
        .query({ code: row!.verifyCode })
        .expect(200);
      expect(dataOf<{ outcome: string }>(res).outcome).toBe('VALID');
    });

    it('warns when a student already holds a live certificate of that type', async () => {
      const res = await server()
        .post('/api/v1/certificates')
        .set(auth(officeToken))
        .send({ studentId: studentIds.get(3), type: 'TESTIMONIAL' })
        .expect(201);
      const body = dataOf<{ certificate: { id: string }; warnings: string[] }>(
        res,
      );
      expect(body.warnings.join(' ')).toContain('already holds');
      await server()
        .delete(`/api/v1/certificates/${body.certificate.id}`)
        .set(auth(officeToken))
        .expect(204);
    });

    it('lists the register with every kind on it', async () => {
      const res = await server()
        .get('/api/v1/certificates')
        .query({ limit: 100 })
        .set(auth(officeToken))
        .expect(200);
      const rows = dataOf<Array<{ issueKind: string; status: string }>>(res);
      const kinds = new Set(rows.map((r) => r.issueKind));
      expect(kinds.has('ORIGINAL')).toBe(true);
      expect(kinds.has('DUPLICATE')).toBe(true);
      expect(kinds.has('CORRECTION')).toBe(true);
    });
  });

  // ── legacy backfill ─────────────────────────────────────────────────

  describe('roadmap §8 legacy backfill', () => {
    it('refuses as the Office Staff — backdating the register is the head’s', async () => {
      await server()
        .post('/api/v1/certificates/legacy')
        .set(auth(officeToken))
        .send({
          studentId: studentIds.get(3),
          type: 'TRANSFER',
          certificateNo: `${NAME}/2011/0042`,
          issueDate: '2011-03-14',
        })
        .expect(403);
    });

    it('accepts a pre-system certificate with its own number', async () => {
      const res = await server()
        .post('/api/v1/certificates/legacy')
        .set(auth(adminToken))
        .send({
          studentId: studentIds.get(3),
          type: 'TRANSFER',
          certificateNo: `  ${NAME}/2011/0042  `,
          issueDate: '2011-03-14',
        })
        .expect(201);
      const body = dataOf<{
        certificate: {
          certificateNo: string;
          isLegacy: boolean;
          templateId: string | null;
          verifyCode: string;
          status: string;
        };
        warnings: string[];
      }>(res);

      expect(body.certificate.certificateNo).toBe(`${NAME}/2011/0042`);
      expect(body.certificate.isLegacy).toBe(true);
      // No stored layout: the school printed this one on a typewriter.
      expect(body.certificate.templateId).toBeNull();
      expect(body.certificate.status).toBe('ISSUED');
      expect(body.warnings.join(' ')).toContain('cannot be re-printed');

      // It still verifies — that is why it was entered.
      const verify = await server()
        .get('/api/v1/public/verify/certificate')
        .query({ code: body.certificate.verifyCode })
        .expect(200);
      expect(dataOf<{ outcome: string }>(verify).outcome).toBe('VALID');
    });

    /**
     * `uq_certificates_no` ignores `deleted_at`. A certificate number has
     * been written on a piece of paper that left the building, and a
     * school may be asked about it ten years later.
     */
    it('refuses a number already in the register', async () => {
      const res = await server()
        .post('/api/v1/certificates/legacy')
        .set(auth(adminToken))
        .send({
          studentId: studentIds.get(3),
          type: 'CHARACTER',
          certificateNo: `${NAME}/2011/0042`,
          issueDate: '2011-04-01',
        })
        .expect(409);
      expect(errorOf(res)).toContain('never reused');
    });
  });

  // ── reports ─────────────────────────────────────────────────────────

  describe('reports', () => {
    it('prints the register with the waiver and revocation columns', async () => {
      // The window is widened past 2011 on purpose: the register defaults
      // to the last twelve months, so the legacy backfill this suite
      // entered is correctly OUTSIDE it — a register is a window, and the
      // default one is the year a school actually asks about.
      const res = await server()
        .get('/api/v1/certificates/reports/register')
        .query({ from: '2010-01-01' })
        .set(auth(adminToken))
        .expect(200);
      const report = dataOf<{
        rows: Array<{
          certificateNo: string;
          status: string;
          clearanceWaived: boolean;
          isLegacy: boolean;
        }>;
        totals: { issued: number; revoked: number; duplicates: number };
      }>(res);

      expect(report.rows.length).toBeGreaterThan(0);
      // Drafts are work in progress, not register entries.
      expect(report.rows.every((r) => r.status !== 'DRAFT')).toBe(true);
      expect(report.rows.some((r) => r.clearanceWaived)).toBe(true);
      expect(report.rows.some((r) => r.isLegacy)).toBe(true);
      expect(report.totals.revoked).toBeGreaterThan(0);
      expect(report.totals.duplicates).toBeGreaterThan(0);
    });

    it('summarizes by type', async () => {
      const res = await server()
        .get('/api/v1/certificates/reports/summary')
        .set(auth(adminToken))
        .expect(200);
      const report = dataOf<{
        byType: Array<{ type: string; total: number }>;
        totals: { total: number };
      }>(res);
      expect(report.totals.total).toBeGreaterThan(0);
      expect(report.byType.some((r) => r.type === 'TRANSFER')).toBe(true);
    });

    it('exports the register as a workbook', async () => {
      const res = await server()
        .get('/api/v1/certificates/reports/register/export')
        .set(auth(adminToken))
        .buffer(true)
        .expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      // A real workbook, not an empty stream — the M24 export assertion.
      expect(Number(res.headers['content-length'])).toBeGreaterThan(1000);
    });

    it('prints the register as a PDF', async () => {
      const res = await server()
        .get('/api/v1/certificates/reports/register/pdf')
        .set(auth(adminToken))
        .expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
    });
  });

  // ── the archive ─────────────────────────────────────────────────────

  describe('the archive', () => {
    let childFolderId: string;
    let fileId: string;

    it('creates a root folder', async () => {
      const res = await server()
        .post('/api/v1/archive/folders')
        .set(auth(officeToken))
        .send({ name: `${NAME} Circulars` })
        .expect(201);
      folderId = dataOf<{ id: string }>(res).id;
    });

    it('refuses a second root folder of the same name', async () => {
      // The COALESCE identity index: Postgres treats NULL parents as
      // distinct, so without it two roots called "Circulars" are legal.
      await server()
        .post('/api/v1/archive/folders')
        .set(auth(officeToken))
        .send({ name: `  ${NAME} circulars  ` })
        .expect(409);
    });

    it('allows the same name under a different parent', async () => {
      const res = await server()
        .post('/api/v1/archive/folders')
        .set(auth(officeToken))
        .send({ name: `${NAME} Circulars`, parentId: folderId })
        .expect(201);
      childFolderId = dataOf<{ id: string }>(res).id;
    });

    it('refuses to move a folder inside its own subtree', async () => {
      const res = await server()
        .put(`/api/v1/archive/folders/${folderId}`)
        .set(auth(officeToken))
        .send({ name: `${NAME} Circulars`, parentId: childFolderId })
        .expect(409);
      expect(errorOf(res)).toContain('inside itself');
    });

    it('files a document with tags', async () => {
      const res = await server()
        .post('/api/v1/archive/files')
        .set(auth(officeToken))
        .send({
          folderId: childFolderId,
          title: `${NAME} Board circular`,
          fileUrl: 'archive/board-circular.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 4096,
          tags: ['Board', 'board', '  EXAM  '],
        })
        .expect(201);
      const file = dataOf<{ id: string; tags: string[] }>(res);
      fileId = file.id;
      // Lower-cased and de-duplicated: a cabinet whose search is
      // case-sensitive is one nobody uses twice.
      expect(file.tags).toEqual(['board', 'exam']);
    });

    it('finds it by tag, however the client spelt the parameter', async () => {
      // Found by this suite: `@IsArray()` alone 400s on `?tags=board`,
      // because a single query parameter is a string. All three shapes a
      // client will plausibly send have to work.
      for (const query of [
        { tags: 'board' },
        { tags: 'board,exam' },
        { tags: ['board'] },
      ]) {
        const res = await server()
          .get('/api/v1/archive/files')
          .query(query)
          .set(auth(officeToken))
          .expect(200);
        const rows = dataOf<Array<{ id: string }>>(res);
        expect(rows.some((r) => r.id === fileId)).toBe(true);
      }
    });

    it('narrows rather than widens as tags are added', async () => {
      // `hasEvery`, not `hasSome`: a filter that ORs its tags gets wider
      // as you refine it, which is the opposite of a filter.
      const res = await server()
        .get('/api/v1/archive/files')
        .query({ tags: 'board,nosuchtag' })
        .set(auth(officeToken))
        .expect(200);
      expect(dataOf<Array<{ id: string }>>(res)).toHaveLength(0);
    });

    it('refuses half a link', async () => {
      await server()
        .post('/api/v1/archive/files')
        .set(auth(officeToken))
        .send({
          folderId: childFolderId,
          title: `${NAME} Half linked`,
          fileUrl: 'archive/x.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          linkedType: 'STUDENT',
        })
        .expect(400);
    });

    it('refuses a file type the school does not accept', async () => {
      const res = await server()
        .post('/api/v1/archive/files')
        .set(auth(officeToken))
        .send({
          folderId: childFolderId,
          title: `${NAME} Executable`,
          fileUrl: 'archive/x.exe',
          mimeType: 'application/x-msdownload',
          sizeBytes: 100,
        })
        .expect(400);
      expect(errorOf(res)).toContain('not an accepted document type');
    });

    it('refuses to delete a folder with something in it', async () => {
      const res = await server()
        .delete(`/api/v1/archive/folders/${childFolderId}`)
        .set(auth(officeToken))
        .expect(409);
      expect(errorOf(res)).toContain('1 document(s)');
    });

    it('rolls file counts up the tree', async () => {
      const res = await server()
        .get('/api/v1/archive/folders')
        .set(auth(officeToken))
        .expect(200);
      const roots = dataOf<
        Array<{ id: string; fileCount: number; totalFileCount: number }>
      >(res);
      const root = roots.find((r) => r.id === folderId);
      expect(root?.fileCount).toBe(0);
      expect(root?.totalFileCount).toBe(1);
    });

    it('refuses the delete to somebody without archive.delete', async () => {
      // The office files documents and does not remove them — the point
      // of a filing cabinet is that things stay in it.
      await server()
        .delete(`/api/v1/archive/files/${fileId}`)
        .set(auth(officeToken))
        .expect(403);
    });

    it('lets the head remove it', async () => {
      await server()
        .delete(`/api/v1/archive/files/${fileId}`)
        .set(auth(adminToken))
        .expect(204);
    });
  });

  // ── the portal ──────────────────────────────────────────────────────

  describe('the portal projection', () => {
    it('shows the student their own certificates', async () => {
      const res = await server()
        .get('/api/v1/portal/certificates')
        .set(auth(studentToken))
        .expect(200);
      const rows = dataOf<
        Array<{
          certificateNo: string;
          status: string;
          verifyCode: string;
          downloadable: boolean;
        }>
      >(res);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.certificateNo.length > 0)).toBe(true);
    });

    it('keeps a revoked certificate on the list, with its reason', async () => {
      // Hiding it would tell the family nothing when somebody checks the
      // code and is told REVOKED.
      const res = await server()
        .get('/api/v1/portal/certificates')
        .set(auth(studentToken))
        .expect(200);
      const rows = dataOf<
        Array<{ status: string; revokedReason: string | null }>
      >(res);
      const revoked = rows.find((r) => r.status === 'REVOKED');
      expect(revoked).toBeDefined();
      expect(revoked?.revokedReason).toContain('Name spelt wrongly');
    });

    it('never shows a draft', async () => {
      const res = await server()
        .get('/api/v1/portal/certificates')
        .set(auth(studentToken))
        .expect(200);
      const rows = dataOf<Array<{ status: string }>>(res);
      expect(rows.every((r) => r.status !== 'DRAFT')).toBe(true);
    });

    it('refuses a student the admin register', async () => {
      await server()
        .get('/api/v1/certificates')
        .set(auth(studentToken))
        .expect(403);
    });
  });

  // ── database invariants ─────────────────────────────────────────────

  describe('the database refuses what the services refuse', () => {
    it('chk_certificates_status_evidence — an ISSUED row with no number', async () => {
      await expect(
        prisma.certificate.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            studentId: studentIds.get(3)!,
            type: 'CHARACTER',
            verifyCode: 'QQQQQQQQQ1',
            status: 'ISSUED',
            issueKind: 'ORIGINAL',
            dataSnapshot: { a: '1' },
            issuedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('chk_certificates_status_evidence — a DRAFT holding a verify code', async () => {
      await expect(
        prisma.certificate.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            studentId: studentIds.get(3)!,
            type: 'CHARACTER',
            verifyCode: 'QQQQQQQQQ2',
            status: 'DRAFT',
            issueKind: 'ORIGINAL',
            dataSnapshot: {},
          },
        }),
      ).rejects.toThrow();
    });

    it('chk_certificates_issue_kind — a DUPLICATE pointing at nothing', async () => {
      await expect(
        prisma.certificate.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            studentId: studentIds.get(3)!,
            type: 'TRANSFER',
            certificateNo: `${NAME}-BAD-1`,
            verifyCode: 'QQQQQQQQQ3',
            status: 'ISSUED',
            issueKind: 'DUPLICATE',
            dataSnapshot: { a: '1' },
            issuedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('chk_certificates_provenance — a waiver with no reason', async () => {
      await expect(
        prisma.certificate.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            studentId: studentIds.get(3)!,
            type: 'TRANSFER',
            certificateNo: `${NAME}-BAD-2`,
            verifyCode: 'QQQQQQQQQ4',
            status: 'ISSUED',
            issueKind: 'ORIGINAL',
            dataSnapshot: { a: '1' },
            issuedAt: new Date(),
            clearanceOverrideBy: studentIds.get(3)!,
          },
        }),
      ).rejects.toThrow();
    });

    it('uq_certificates_verify_code — globally unique', async () => {
      const live = await prisma.certificate.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, verifyCode: { not: null } },
        select: { verifyCode: true },
      });
      await expect(
        prisma.certificate.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            studentId: studentIds.get(3)!,
            type: 'CHARACTER',
            certificateNo: `${NAME}-BAD-3`,
            verifyCode: live!.verifyCode,
            status: 'ISSUED',
            issueKind: 'ORIGINAL',
            dataSnapshot: { a: '1' },
            issuedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('chk_archive_files_link — a zero-byte document', async () => {
      await expect(
        prisma.archiveFile.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            folderId,
            title: `${NAME} Empty`,
            fileUrl: 'archive/empty.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 0,
          },
        }),
      ).rejects.toThrow();
    });
  });
});
