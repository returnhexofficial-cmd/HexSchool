import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { Workbook } from 'exceljs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEFAULT_SCHOOL_ID, UserType } from '../src/common/constants';
import { PrismaService } from '../src/database/prisma/prisma.service';
import {
  seedSystemRoles,
  syncPermissionRegistry,
} from '../src/modules/rbac/seed/rbac.seeder';

/**
 * Requires dev infra (DB + redis). Uses an E2E class at level 18 so real
 * dev data is untouched; everything created here is removed in afterAll.
 * Student UIDs claimed stay burned (by design — same as employee IDs).
 */
describe('Student & Guardian Management (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-student-admin@test.local';
  const PLAIN = 'e2e-student-plain@test.local';
  // Guardian/account phone pool — distinct prefix from other suites.
  const PHONES = Array.from(
    { length: 10 },
    (_, i) => `017990177${String(i).padStart(2, '0')}`,
  );

  let adminToken: string;
  let plainToken: string;
  let classId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;
  /** superagent only auto-buffers JSON/text — collect binary bodies.
   *  Typed to supertest's `parse` contract (res is a readable stream). */
  const binaryParser = (
    res: request.Response,
    cb: (err: Error | null, body: Buffer) => void,
  ) => {
    const chunks: Buffer[] = [];
    const stream = res as unknown as NodeJS.ReadableStream;
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  const studentPayload = (i: number, extra: object = {}) => ({
    firstName: 'E2EStudent',
    lastName: `Child${i}`,
    gender: 'MALE',
    dob: '2014-03-12',
    admissionDate: '2026-01-10',
    admissionClassId: classId,
    guardians: [
      {
        name: `E2E Guardian ${i}`,
        phone: PHONES[i],
        relation: 'FATHER',
        isPrimary: true,
      },
    ],
    ...extra,
  });

  const cleanup = async () => {
    const students = await prisma.student.findMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: 'E2EStudent' },
      select: { id: true, userId: true },
    });
    const studentUserIds = students
      .map((s) => s.userId)
      .filter((u): u is string => !!u);
    if (students.length > 0) {
      await prisma.student.deleteMany({
        where: { id: { in: students.map((s) => s.id) } },
      });
    }
    const guardians = await prisma.guardian.findMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, phone: { in: PHONES } },
      select: { id: true, userId: true },
    });
    const guardianUserIds = guardians
      .map((g) => g.userId)
      .filter((u): u is string => !!u);
    if (guardians.length > 0) {
      await prisma.guardian.deleteMany({
        where: { id: { in: guardians.map((g) => g.id) } },
      });
    }
    await prisma.schoolClass.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: 'E2E SClass' },
    });
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: { in: [ADMIN, PLAIN] } },
          { phone: { in: PHONES } },
          { id: { in: [...studentUserIds, ...guardianUserIds] } },
        ],
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
    const adminRole = await prisma.role.findFirst({
      where: { schoolId: DEFAULT_SCHOOL_ID, slug: 'admin', deletedAt: null },
    });
    await prisma.userRole.create({
      data: { userId: adminUser.id, roleId: adminRole!.id },
    });

    const klass = await prisma.schoolClass.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: 'E2E SClass',
        numericLevel: 18,
      },
    });
    classId = klass.id;

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
    await cleanup();
    await app.close();
  }, 120_000);

  let studentAId: string;
  let studentBId: string;
  let guardianAId: string;
  let extraGuardianId: string;

  it('student endpoints are permission-guarded', async () => {
    await server().get('/api/v1/students').set(auth(plainToken)).expect(403);
    await server()
      .post('/api/v1/students')
      .set(auth(plainToken))
      .send(studentPayload(0))
      .expect(403);
  });

  it('full registration: UID claimed, guardian created + linked primary', async () => {
    const res = await server()
      .post('/api/v1/students')
      .set(auth(adminToken))
      .send(studentPayload(0))
      .expect(201);
    const data = dataOf<{
      student: {
        id: string;
        studentUid: string;
        qrToken: string;
        guardians: Array<{
          isPrimary: boolean;
          guardian: { id: string; phone: string };
        }>;
      };
      duplicateWarnings: unknown[];
      warnings: string[];
    }>(res);
    studentAId = data.student.id;
    guardianAId = data.student.guardians[0].guardian.id;

    expect(data.student.studentUid).toMatch(/2026\d{5}$/);
    expect(data.student.guardians).toHaveLength(1);
    expect(data.student.guardians[0].isPrimary).toBe(true);
    expect(data.student.guardians[0].guardian.phone).toBe(PHONES[0]);
    expect(data.duplicateWarnings).toEqual([]);
  });

  it('sibling registration dedupes the guardian by phone and warns on duplicates', async () => {
    const res = await server()
      .post('/api/v1/students')
      .set(auth(adminToken))
      .send(studentPayload(1, { guardians: studentPayload(0).guardians }))
      .expect(201);
    const data = dataOf<{
      student: {
        id: string;
        guardians: Array<{ guardian: { id: string } }>;
      };
      duplicateWarnings: Array<{ reason: string }>;
    }>(res);
    studentBId = data.student.id;

    // Same phone → same guardian row (siblings share guardians).
    expect(data.student.guardians[0].guardian.id).toBe(guardianAId);
    // Same dob + same guardian phone → twins/duplicate warning, not a block.
    expect(data.duplicateWarnings.length).toBeGreaterThan(0);
  });

  it('duplicate birth certificate → 409; check-duplicates probe warns', async () => {
    const cert = '12345678901234567';
    await server()
      .put(`/api/v1/students/${studentAId}`)
      .set(auth(adminToken))
      .send({ birthCertificateNo: cert })
      .expect(200);
    await server()
      .post('/api/v1/students')
      .set(auth(adminToken))
      .send(studentPayload(2, { birthCertificateNo: cert }))
      .expect(409);

    const probe = dataOf<Array<{ reason: string }>>(
      await server()
        .post('/api/v1/students/check-duplicates')
        .set(auth(adminToken))
        .send({
          firstName: 'E2EStudent',
          lastName: 'Child0',
          dob: '2014-03-12',
        })
        .expect(201),
    );
    expect(probe.length).toBeGreaterThan(0);
    expect(probe[0].reason).toBe('NAME_DOB');
  });

  it('list search finds students by guardian phone', async () => {
    const res = await server()
      .get(`/api/v1/students?search=${PHONES[0]}`)
      .set(auth(adminToken))
      .expect(200);
    const rows = dataOf<Array<{ id: string }>>(res);
    expect(rows.map((r) => r.id)).toEqual(
      expect.arrayContaining([studentAId, studentBId]),
    );
  });

  it('guardian CRUD: dup phone 409, link/promote/unlink invariants', async () => {
    // Standalone guardian creation with a used phone → 409.
    await server()
      .post('/api/v1/guardians')
      .set(auth(adminToken))
      .send({ name: 'Dup', phone: PHONES[0], relation: 'FATHER' })
      .expect(409);

    extraGuardianId = dataOf<{ id: string }>(
      await server()
        .post('/api/v1/guardians')
        .set(auth(adminToken))
        .send({ name: 'E2E Aunt', phone: PHONES[3], relation: 'AUNT' })
        .expect(201),
    ).id;

    // Linking defaults to non-primary when a primary exists.
    const links = dataOf<Array<{ guardianId: string; isPrimary: boolean }>>(
      await server()
        .post(`/api/v1/students/${studentAId}/guardians`)
        .set(auth(adminToken))
        .send({ guardianId: extraGuardianId, relation: 'AUNT' })
        .expect(201),
    );
    expect(links.find((l) => l.guardianId === extraGuardianId)!.isPrimary).toBe(
      false,
    );

    // Unlinking the primary while another remains → 409.
    await server()
      .delete(`/api/v1/students/${studentAId}/guardians/${guardianAId}`)
      .set(auth(adminToken))
      .expect(409);

    // Promote the aunt — old primary demoted in the same transaction.
    const promoted = dataOf<Array<{ guardianId: string; isPrimary: boolean }>>(
      await server()
        .put(`/api/v1/students/${studentAId}/guardians/${extraGuardianId}`)
        .set(auth(adminToken))
        .send({ isPrimary: true })
        .expect(200),
    );
    expect(promoted.filter((l) => l.isPrimary)).toHaveLength(1);
    expect(promoted.find((l) => l.isPrimary)!.guardianId).toBe(extraGuardianId);

    // Guardian delete blocked while linked.
    await server()
      .delete(`/api/v1/guardians/${extraGuardianId}`)
      .set(auth(adminToken))
      .expect(409);

    // Now the old primary can be unlinked, and demoting directly is a 400.
    await server()
      .put(`/api/v1/students/${studentAId}/guardians/${extraGuardianId}`)
      .set(auth(adminToken))
      .send({ isPrimary: false })
      .expect(400);
    await server()
      .delete(`/api/v1/students/${studentAId}/guardians/${guardianAId}`)
      .set(auth(adminToken))
      .expect(200);
  });

  it('medical record is permission-gated and upserts', async () => {
    await server()
      .get(`/api/v1/students/${studentAId}/medical`)
      .set(auth(plainToken))
      .expect(403);

    await server()
      .put(`/api/v1/students/${studentAId}/medical`)
      .set(auth(adminToken))
      .send({ heightCm: 141.5, allergies: 'Dust' })
      .expect(200);

    const medical = dataOf<{ heightCm: string; allergies: string }>(
      await server()
        .get(`/api/v1/students/${studentAId}/medical`)
        .set(auth(adminToken))
        .expect(200),
    );
    expect(Number(medical.heightCm)).toBe(141.5);
    expect(medical.allergies).toBe('Dust');
  });

  it('portal accounts: student + guardian may share a phone across user types', async () => {
    const studentAccount = dataOf<{
      userId: string;
      tempPassword: string;
      phone: string;
    }>(
      await server()
        .post(`/api/v1/students/${studentAId}/create-account`)
        .set(auth(adminToken))
        .send({ phone: PHONES[5] })
        .expect(201),
    );
    expect(studentAccount.tempPassword).toBeTruthy();

    const studentUser = await prisma.user.findUnique({
      where: { id: studentAccount.userId },
    });
    expect(studentUser?.userType).toBe('STUDENT');
    expect(studentUser?.mustChangePassword).toBe(true);

    // Same phone for the PARENT account — allowed since M09 moved
    // uniqueness to (school_id, user_type, contact).
    const guardianAccount = dataOf<{ userId: string }>(
      await server()
        .post(`/api/v1/guardians/${extraGuardianId}/create-account`)
        .set(auth(adminToken))
        .send({ phone: PHONES[5] })
        .expect(201),
    );
    const guardianUser = await prisma.user.findUnique({
      where: { id: guardianAccount.userId },
    });
    expect(guardianUser?.userType).toBe('PARENT');

    // A second student account on the same phone → 409 (same type).
    await server()
      .post(`/api/v1/students/${studentBId}/create-account`)
      .set(auth(adminToken))
      .send({ phone: PHONES[5] })
      .expect(409);

    // Re-provisioning → 409.
    await server()
      .post(`/api/v1/students/${studentAId}/create-account`)
      .set(auth(adminToken))
      .send({ phone: PHONES[6] })
      .expect(409);
  });

  it('status transition writes history and deactivates the portal account', async () => {
    const res = await server()
      .put(`/api/v1/students/${studentAId}/status`)
      .set(auth(adminToken))
      .send({ status: 'TRANSFERRED', reason: 'Family relocated' })
      .expect(200);
    const data = dataOf<{
      student: { status: string; userId: string };
      warnings: string[];
    }>(res);
    expect(data.student.status).toBe('TRANSFERRED');
    // **Changed by Module 16.** This used to assert a placeholder
    // "Dues clearance could not be verified (Fees module not installed
    // yet)" warning. The check is real now, and this student has no
    // invoices — so a clean exit carries no warning at all. The dues
    // warning and the opt-in hard block are covered by
    // `fee.e2e-spec.ts` and the M09 service spec.
    expect(data.warnings).toEqual([]);

    const full = dataOf<{
      statusHistory: Array<{ fromStatus: string; toStatus: string }>;
    }>(
      await server()
        .get(`/api/v1/students/${studentAId}/full`)
        .set(auth(adminToken))
        .expect(200),
    );
    expect(full.statusHistory[0]).toMatchObject({
      fromStatus: 'ACTIVE',
      toStatus: 'TRANSFERRED',
    });

    // Cascade (event listener) flips the portal user to INACTIVE.
    const userId = data.student.userId;
    let status = '';
    for (let i = 0; i < 20 && status !== 'INACTIVE'; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
      status =
        (await prisma.user.findUnique({ where: { id: userId } }))?.status ?? '';
    }
    expect(status).toBe('INACTIVE');
  });

  it('QR token rotates; ID card PDFs are generated (single + batch)', async () => {
    const before = await prisma.student.findUnique({
      where: { id: studentBId },
      select: { qrToken: true },
    });
    await server()
      .post(`/api/v1/students/${studentBId}/rotate-qr`)
      .set(auth(adminToken))
      .expect(201);
    const after = await prisma.student.findUnique({
      where: { id: studentBId },
      select: { qrToken: true },
    });
    expect(after?.qrToken).not.toBe(before?.qrToken);

    const single = await server()
      .post(`/api/v1/students/${studentBId}/id-card`)
      .set(auth(adminToken))
      .buffer(true)
      .parse(binaryParser)
      .expect(201);
    expect(single.headers['content-type']).toContain('application/pdf');
    expect((single.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    // No photo uploaded → card flagged incomplete (M09 §8).
    expect(single.headers['x-cards-incomplete']).toBe('1');

    const batch = await server()
      .post('/api/v1/students/id-cards')
      .set(auth(adminToken))
      .send({ studentIds: [studentAId, studentBId] })
      .buffer(true)
      .parse(binaryParser)
      .expect(201);
    expect(batch.headers['content-type']).toContain('application/pdf');
    expect((batch.body as Buffer).length).toBeGreaterThan(
      (single.body as Buffer).length / 2,
    );
  });

  it('XLSX import: template downloads; dry-run reports; commit inserts valid rows', async () => {
    const template = await server()
      .get('/api/v1/students/import-template')
      .set(auth(adminToken))
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(template.headers['content-type']).toContain('spreadsheetml');
    // Real XLSX bytes (zip magic), not a JSON-serialized Buffer.
    expect((template.body as Buffer).subarray(0, 2).toString()).toBe('PK');

    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Students');
    sheet.addRow(Array.from({ length: 19 }, (_, i) => `Col ${i + 1}`));
    sheet.addRow([
      'E2EStudent',
      'Imported',
      'ই-স্টুডেন্ট',
      'FEMALE',
      '2013-07-01',
      'ISLAM',
      'O+',
      '',
      '2026-01-15',
      '18',
      '',
      'Dhaka',
      '',
      'E2E Import Guardian',
      PHONES[7],
      'MOTHER',
      '',
      'Business',
      '',
    ]);
    sheet.addRow([
      'E2EStudent',
      'Broken',
      '',
      'NOPE',
      '2013-07-01',
      'ISLAM',
      '',
      '',
      '2026-01-15',
      '99',
      '',
      '',
      '',
      'E2E Import Guardian',
      'badphone',
      'MOTHER',
      '',
      '',
      '',
    ]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const dryRun = dataOf<{
      total: number;
      valid: number;
      invalid: number;
      imported: number;
      rows: Array<{ row: number; status: string; errors: string[] }>;
    }>(
      await server()
        .post('/api/v1/students/import')
        .set(auth(adminToken))
        .attach('file', buffer, 'students.xlsx')
        .field('commit', 'false')
        .expect(201),
    );
    expect(dryRun).toMatchObject({
      total: 2,
      valid: 1,
      invalid: 1,
      imported: 0,
    });
    expect(
      dryRun.rows.find((r) => r.status === 'ERROR')!.errors.length,
    ).toBeGreaterThanOrEqual(3);

    const commit = dataOf<{
      imported: number;
      rows: Array<{ status: string; studentUid?: string }>;
    }>(
      await server()
        .post('/api/v1/students/import')
        .set(auth(adminToken))
        .attach('file', buffer, 'students.xlsx')
        .field('commit', 'true')
        .expect(201),
    );
    expect(commit.imported).toBe(1);

    const imported = await prisma.student.findFirst({
      where: { schoolId: DEFAULT_SCHOOL_ID, lastName: 'Imported' },
      include: { guardians: { include: { guardian: true } } },
    });
    expect(imported).toBeTruthy();
    expect(imported!.nameBn).toBe('ই-স্টুডেন্ট'); // UTF-8 Bangla survives
    expect(imported!.guardians[0].guardian.phone).toBe(PHONES[7]);
  });

  it('soft delete burns the UID and frees nothing else', async () => {
    await server()
      .delete(`/api/v1/students/${studentBId}`)
      .set(auth(adminToken))
      .expect(200);
    await server()
      .get(`/api/v1/students/${studentBId}`)
      .set(auth(adminToken))
      .expect(404);

    const row = await prisma.student.findUnique({
      where: { id: studentBId },
    });
    expect(row?.deletedAt).toBeTruthy();
    expect(row?.studentUid).toBeTruthy(); // stays burned in the unique index
  });
});
