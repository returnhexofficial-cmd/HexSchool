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
import { LibraryOverdueJob } from '../src/modules/library/jobs/library-overdue.job';
import {
  seedSystemRoles,
  syncPermissionRegistry,
} from '../src/modules/rbac/seed/rbac.seeder';

/**
 * Requires dev infra (DB + redis). Module 23 — Library Management.
 *
 * The suite is built around the things unit tests structurally cannot
 * see (roadmap §9):
 *
 *   1. **The whole loop** — issue → renew → overdue return → fine
 *      collect — through the real DI graph, the real CHECK constraints
 *      and the real sequence service.
 *   2. **The database invariants.** `fine_paid` is derived by CHECK,
 *      `uq_book_issues_open_copy` is what makes "one pair of hands" true,
 *      and the accession unique deliberately ignores `deleted_at`. Each
 *      is asserted to actually reject a bad row, because a constraint
 *      nobody has seen refuse anything is a constraint that might not be
 *      there.
 *   3. **Separation of duties.** The seeded Librarian may take money and
 *      may not write it off — the M16/M20/M21 rule, and the only place
 *      the seeded role set is checked against a live request.
 *   4. **The M09 clearance hook**, which is a cross-module DI binding
 *      and therefore exactly the kind of thing that compiles and then
 *      does nothing.
 */
describe('Library Management (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-lib-admin@test.local';
  const LIBRARIAN = 'e2e-lib-librarian@test.local';
  const STUDENT = 'e2e-lib-student@test.local';
  const NAME = 'E2ELIB';

  let adminToken: string;
  let librarianToken: string;
  let studentToken: string;

  let categoryId: string;
  let bookId: string;
  let studentId: string;
  let otherStudentId: string;
  let memberId: string;
  let cardNo: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;

  const emails = [ADMIN, LIBRARIAN, STUDENT];

  /** A fresh title with `count` copies; returns the accession numbers. */
  const stockedBook = async (
    title: string,
    count = 1,
    price = 400,
  ): Promise<{ bookId: string; accessions: string[] }> => {
    const book = dataOf<{ id: string }>(
      await server()
        .post('/api/v1/library/books')
        .set(auth(adminToken))
        .send({ title: `${NAME} ${title}`, categoryId, price })
        .expect(201),
    );
    const copies = dataOf<Array<{ accessionNo: string }>>(
      await server()
        .post(`/api/v1/library/books/${book.id}/copies`)
        .set(auth(adminToken))
        .send({ count })
        .expect(201),
    );
    return { bookId: book.id, accessions: copies.map((c) => c.accessionNo) };
  };

  const cleanup = async () => {
    await prisma.stockVerificationScan.deleteMany({
      where: { verification: { name: { startsWith: NAME } } },
    });
    await prisma.stockVerification.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.bookReservation.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        book: { title: { startsWith: NAME } },
      },
    });
    await prisma.bookIssue.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        copy: { book: { title: { startsWith: NAME } } },
      },
    });
    await prisma.bookCopy.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        book: { title: { startsWith: NAME } },
      },
    });
    await prisma.bookAuthor.deleteMany({
      where: { book: { title: { startsWith: NAME } } },
    });
    await prisma.book.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, title: { startsWith: NAME } },
    });
    await prisma.libraryMember.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        cardNo: { startsWith: `${NAME}-` },
      },
    });
    // Cards the fixtures made through the real enrol path, which numbers
    // them from the school's sequence rather than the NAME prefix.
    const fixtureStudents = await prisma.student.findMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, firstName: NAME },
      select: { id: true },
    });
    if (fixtureStudents.length > 0) {
      await prisma.libraryMember.deleteMany({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          personId: { in: fixtureStudents.map((s) => s.id) },
        },
      });
    }
    await prisma.bookCategory.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.author.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.publisher.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.notification.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        templateCode: { startsWith: 'LIBRARY_' },
      },
    });
    await prisma.studentStatusHistory.deleteMany({
      where: { student: { firstName: NAME } },
    });
    await prisma.student.deleteMany({
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
    const [adminUser, librarianUser, studentUser] = await Promise.all([
      mk(ADMIN, UserType.ADMIN),
      mk(LIBRARIAN, UserType.STAFF),
      mk(STUDENT, UserType.STUDENT),
    ]);

    const roleFor = async (slug: string) =>
      prisma.role.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, slug, deletedAt: null },
      });
    const adminRole = await roleFor('admin');
    const librarianRole = await roleFor('librarian');
    await prisma.userRole.createMany({
      data: [
        { userId: adminUser.id, roleId: adminRole!.id },
        { userId: librarianUser.id, roleId: librarianRole!.id },
      ],
    });

    const klass = await prisma.schoolClass.findFirst({
      where: { schoolId: DEFAULT_SCHOOL_ID, deletedAt: null },
      select: { id: true },
    });

    const mkStudent = async (last: string, userId: string | null) =>
      prisma.student.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          userId,
          studentUid: `${NAME}-${last}-${Date.now()}`,
          firstName: NAME,
          lastName: last,
          gender: 'MALE',
          dob: new Date('2013-01-01'),
          admissionDate: new Date('2026-01-02'),
          admissionClassId: klass?.id ?? null,
          qrToken: randomUUID(),
        },
      });

    const [reader, other] = await Promise.all([
      mkStudent('Reader', studentUser.id),
      mkStudent('Other', null),
    ]);
    studentId = reader.id;
    otherStudentId = other.id;

    const login = async (identifier: string) => {
      const res = await server()
        .post('/api/v1/auth/login')
        .send({ identifier, password: PASSWORD })
        .expect(200);
      return dataOf<{ accessToken: string }>(res).accessToken;
    };
    adminToken = await login(ADMIN);
    librarianToken = await login(LIBRARIAN);
    studentToken = await login(STUDENT);

    const category = dataOf<{ id: string }>(
      await server()
        .post('/api/v1/library/categories')
        .set(auth(adminToken))
        .send({ name: `${NAME} Science` })
        .expect(201),
    );
    categoryId = category.id;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  // ── catalogue ───────────────────────────────────────────────────────

  describe('catalogue', () => {
    it('catalogues a title with an author created from its name', async () => {
      const res = await server()
        .post('/api/v1/library/books')
        .set(auth(adminToken))
        .send({
          title: `${NAME} Physics for Class 9`,
          categoryId,
          isbn: '978-0-306-40615-7',
          authorNames: [`${NAME} Humayun Ahmed`],
          price: 400,
          rackNo: 'A1',
        })
        .expect(201);

      const book = dataOf<{
        id: string;
        isbn: string;
        authors: Array<{ author: { name: string } }>;
      }>(res);
      bookId = book.id;
      // Stored normalised — the hyphens the librarian typed are gone.
      expect(book.isbn).toBe('9780306406157');
      expect(book.authors[0].author.name).toBe(`${NAME} Humayun Ahmed`);
    });

    it('refuses an ISBN whose check digit is wrong', async () => {
      await server()
        .post('/api/v1/library/books')
        .set(auth(adminToken))
        .send({ title: `${NAME} Bad ISBN`, categoryId, isbn: '0306460152' })
        .expect(400);
    });

    it('accepts a book with no ISBN — most of a BD library has none', async () => {
      await server()
        .post('/api/v1/library/books')
        .set(auth(adminToken))
        .send({ title: `${NAME} No ISBN`, categoryId })
        .expect(201);
    });

    it('finds a title by ISBN typed with hyphens', async () => {
      const res = await server()
        .get('/api/v1/library/books')
        .query({ search: '978-0-306-40615-7' })
        .set(auth(adminToken))
        .expect(200);
      expect((res.body as { data: unknown[] }).data.length).toBeGreaterThan(0);
    });

    it('refuses to delete a category that still has books', async () => {
      const res = await server()
        .delete(`/api/v1/library/categories/${categoryId}`)
        .set(auth(adminToken))
        .expect(409);
      expect(JSON.stringify(res.body)).toMatch(/catalogued under/i);
    });
  });

  // ── copies ──────────────────────────────────────────────────────────

  describe('copies', () => {
    it('generates sequential accession numbers', async () => {
      const res = await server()
        .post(`/api/v1/library/books/${bookId}/copies`)
        .set(auth(adminToken))
        .send({ count: 3 })
        .expect(201);

      const copies = dataOf<Array<{ accessionNo: string }>>(res);
      expect(copies).toHaveLength(3);
      const suffixes = copies.map((c) =>
        Number(c.accessionNo.split('-').at(-1)),
      );
      expect(suffixes[1]).toBe(suffixes[0] + 1);
      expect(suffixes[2]).toBe(suffixes[1] + 1);
    });

    /**
     * `uq_book_copies_accession` deliberately IGNORES `deleted_at` — an
     * accession number is a label stuck in a book and is never reused.
     * This asserts the index actually behaves that way, because it is
     * the one unique in this module that is NOT partial and the reason
     * is easy to "correct" later.
     */
    it('never re-issues an accession number, even after the copy is deleted', async () => {
      const { accessions } = await stockedBook('Recycled', 1);
      const copy = await prisma.bookCopy.findFirstOrThrow({
        where: { accessionNo: accessions[0] },
      });
      await prisma.bookCopy.update({
        where: { id: copy.id },
        data: { deletedAt: new Date() },
      });

      await expect(
        prisma.bookCopy.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            bookId: copy.bookId,
            accessionNo: accessions[0],
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses a copy whose accession number is blank (chk_book_copies_shape)', async () => {
      await expect(
        prisma.bookCopy.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            bookId,
            accessionNo: '   ',
          },
        }),
      ).rejects.toThrow();
    });
  });

  // ── members ─────────────────────────────────────────────────────────

  describe('members', () => {
    it('enrols a student and gives them a card number', async () => {
      const res = await server()
        .post('/api/v1/library/members')
        .set(auth(librarianToken))
        .send({ personType: 'STUDENT', personId: studentId })
        .expect(201);

      const member = dataOf<{ id: string; cardNo: string; maxBooks: number }>(
        res,
      );
      memberId = member.id;
      cardNo = member.cardNo;
      expect(member.cardNo).toMatch(/^LIB-/);
      // The per-type default from settings, copied onto the card.
      expect(member.maxBooks).toBe(2);
    });

    it('is idempotent — enrolling the same person returns their card', async () => {
      const res = await server()
        .post('/api/v1/library/members')
        .set(auth(librarianToken))
        .send({ personType: 'STUDENT', personId: studentId })
        .expect(201);
      expect(dataOf<{ cardNo: string }>(res).cardNo).toBe(cardNo);
    });

    it('refuses a card for somebody who is not in the school', async () => {
      await server()
        .post('/api/v1/library/members')
        .set(auth(librarianToken))
        .send({ personType: 'STUDENT', personId: randomUUID() })
        .expect(404);
    });

    it('refuses one person two live cards (uq_library_members_person)', async () => {
      await expect(
        prisma.libraryMember.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            personType: 'STUDENT',
            personId: studentId,
            cardNo: `${NAME}-DUP-1`,
          },
        }),
      ).rejects.toThrow();
    });
  });

  // ── the circulation loop ────────────────────────────────────────────

  describe('issue → renew → overdue return → fine', () => {
    let accessionNo: string;
    let issueId: string;

    beforeAll(async () => {
      const stocked = await stockedBook('Loop', 1, 400);
      accessionNo = stocked.accessions[0];
    });

    it('previews the verdict before committing anything', async () => {
      const res = await server()
        .post('/api/v1/library/issue/preview')
        .set(auth(librarianToken))
        .send({ accessionNo, cardNo })
        .expect(201);

      expect(
        dataOf<{ verdict: { allowed: boolean } }>(res).verdict.allowed,
      ).toBe(true);
      // A preview writes nothing.
      const copy = await prisma.bookCopy.findFirstOrThrow({
        where: { accessionNo },
      });
      expect(copy.status).toBe('AVAILABLE');
    });

    it('issues, marking the copy ISSUED in the same transaction', async () => {
      const res = await server()
        .post('/api/v1/library/issue')
        .set(auth(librarianToken))
        .send({ accessionNo, cardNo })
        .expect(201);

      const issue = dataOf<{ id: string; dueAt: string }>(res);
      issueId = issue.id;

      const copy = await prisma.bookCopy.findFirstOrThrow({
        where: { accessionNo },
      });
      expect(copy.status).toBe('ISSUED');
      // Student loan = 7 days from the settings default.
      const days = Math.round(
        (new Date(issue.dueAt).getTime() - Date.now()) / 86_400_000,
      );
      expect(days).toBe(7);
    });

    it('strips scanner noise from the accession number', async () => {
      const res = await server()
        .get(
          `/api/v1/library/copies/by-accession/${encodeURIComponent(`  ${accessionNo.toLowerCase()}\r\n`)}`,
        )
        .set(auth(librarianToken))
        .expect(200);
      expect(
        dataOf<{ copy: { accessionNo: string } }>(res).copy.accessionNo,
      ).toBe(accessionNo);
    });

    /**
     * `uq_book_issues_open_copy` — one physical book is in one pair of
     * hands. The service refuses first; this asserts the index would too.
     */
    it('refuses to issue a copy that is already out', async () => {
      await server()
        .post('/api/v1/library/issue')
        .set(auth(librarianToken))
        .send({ accessionNo, cardNo })
        .expect(409);

      await expect(
        prisma.bookIssue.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            copyId: (
              await prisma.bookCopy.findFirstOrThrow({ where: { accessionNo } })
            ).id,
            memberId,
            dueAt: new Date(Date.now() + 86_400_000),
          },
        }),
      ).rejects.toThrow();
    });

    it('renews, moving the due date forward and counting it', async () => {
      const res = await server()
        .post(`/api/v1/library/issues/${issueId}/renew`)
        .set(auth(librarianToken))
        .send({})
        .expect(201);
      expect(dataOf<{ renewCount: number }>(res).renewCount).toBe(1);
    });

    it('charges the overdue fine on return, days × rate', async () => {
      // Back-date the loan so it is five days overdue. Done through
      // Prisma rather than the API because there is deliberately no
      // endpoint that moves a due date backwards.
      await prisma.bookIssue.update({
        where: { id: issueId },
        data: {
          issuedAt: new Date(Date.now() - 20 * 86_400_000),
          dueAt: new Date(Date.now() - 5 * 86_400_000),
        },
      });

      const res = await server()
        .post('/api/v1/library/return')
        .set(auth(librarianToken))
        .send({ accessionNo })
        .expect(201);

      const result = dataOf<{
        fine: { amount: number; daysLate: number; reason: string };
      }>(res);
      expect(result.fine.daysLate).toBe(5);
      // 5 days × 2 BDT, minus any school holidays in the window — the
      // seeded school has none in a rolling five-day span, but the
      // assertion is on the shape rather than the exact figure so a
      // Friday inside the window cannot make this flake.
      expect(result.fine.amount).toBeGreaterThan(0);
      expect(result.fine.amount).toBeLessThanOrEqual(10);
      expect(result.fine.reason).toBe('OVERDUE');

      const copy = await prisma.bookCopy.findFirstOrThrow({
        where: { accessionNo },
      });
      expect(copy.status).toBe('AVAILABLE');
    });

    it('leaves the fine unsettled until it is collected', async () => {
      const issue = await prisma.bookIssue.findFirstOrThrow({
        where: { id: issueId },
      });
      expect(issue.finePaid).toBe(false);
      expect(Number(issue.fineAmount)).toBeGreaterThan(0);
    });

    it('blocks the member from borrowing while the fine is over the limit', async () => {
      // Push the fine past `library.fine_block_threshold` (100).
      await prisma.bookIssue.update({
        where: { id: issueId },
        data: { fineAmount: 150, finePaid: false },
      });
      const { accessions } = await stockedBook('Blocked', 1);

      const res = await server()
        .post('/api/v1/library/issue')
        .set(auth(librarianToken))
        .send({ accessionNo: accessions[0], cardNo })
        .expect(409);
      expect(JSON.stringify(res.body)).toMatch(/unpaid fine/i);
    });

    it('lets an override-holder past the fine block', async () => {
      const { accessions } = await stockedBook('Override', 1);
      // The admin holds every code, including `library.issue.override`.
      await server()
        .post('/api/v1/library/issue')
        .set(auth(adminToken))
        .send({ accessionNo: accessions[0], cardNo, override: true })
        .expect(201);
      await server()
        .post('/api/v1/library/return')
        .set(auth(adminToken))
        .send({ accessionNo: accessions[0] })
        .expect(201);
    });

    it('collects the fine and marks it settled', async () => {
      const res = await server()
        .post(`/api/v1/library/fines/${issueId}/collect`)
        .set(auth(librarianToken))
        .send({})
        .expect(201);

      expect(dataOf<{ outstanding: number }>(res).outstanding).toBe(0);
      const issue = await prisma.bookIssue.findFirstOrThrow({
        where: { id: issueId },
      });
      expect(issue.finePaid).toBe(true);
      expect(Number(issue.fineCollected)).toBe(150);
    });

    it('refuses to collect twice', async () => {
      await server()
        .post(`/api/v1/library/fines/${issueId}/collect`)
        .set(auth(librarianToken))
        .send({})
        .expect(409);
    });
  });

  // ── the database's own rules ────────────────────────────────────────

  describe('database invariants', () => {
    let issueId: string;

    beforeAll(async () => {
      const { accessions } = await stockedBook('Invariants', 1);
      const copy = await prisma.bookCopy.findFirstOrThrow({
        where: { accessionNo: accessions[0] },
      });
      // `issued_at` is set explicitly rather than left to its
      // `CURRENT_TIMESTAMP` default: the default is the SERVER's clock
      // and `returnedAt: new Date()` is this process's, computed
      // microseconds earlier — which `chk_book_issues_window` reads as a
      // book returned before it was issued, and refuses. The constraint
      // is right; the fixture was the thing going round it.
      const issuedAt = new Date(Date.now() - 3 * 86_400_000);
      const issue = await prisma.bookIssue.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          copyId: copy.id,
          memberId,
          issuedAt,
          dueAt: new Date(issuedAt.getTime() + 86_400_000),
          returnedAt: new Date(),
          fineAmount: 100,
          fineReason: 'OVERDUE',
          finePaid: false,
        },
      });
      issueId = issue.id;
    });

    /**
     * `fine_paid` is DERIVED, not assigned. This is the invariant a
     * "mark as paid" button would otherwise be able to break, and the
     * whole reason it is a CHECK rather than a convention.
     */
    it('refuses a fine_paid flag that disagrees with the arithmetic', async () => {
      await expect(
        prisma.bookIssue.update({
          where: { id: issueId },
          data: { finePaid: true },
        }),
      ).rejects.toThrow();
    });

    it('refuses settling more than was assessed', async () => {
      await expect(
        prisma.bookIssue.update({
          where: { id: issueId },
          data: { fineCollected: 60, fineWaived: 60, finePaid: true },
        }),
      ).rejects.toThrow();
    });

    /** `chk_book_issues_waiver_evidence` — a nameless write-off. */
    it('refuses a waiver with no waiver and no reason', async () => {
      await expect(
        prisma.bookIssue.update({
          where: { id: issueId },
          data: { fineWaived: 100, finePaid: true },
        }),
      ).rejects.toThrow();
    });

    it('accepts a waiver that says who and why', async () => {
      const user = await prisma.user.findFirstOrThrow({
        where: { email: ADMIN },
      });
      const updated = await prisma.bookIssue.update({
        where: { id: issueId },
        data: {
          fineWaived: 100,
          fineWaivedBy: user.id,
          fineWaiveReason: 'Flood damage, family cannot pay',
          finePaid: true,
        },
      });
      expect(Number(updated.fineWaived)).toBe(100);
    });

    /** `chk_book_issues_window` — overdue before it left the desk. */
    it('refuses a due date at or before the issue instant', async () => {
      const { accessions } = await stockedBook('BadWindow', 1);
      const copy = await prisma.bookCopy.findFirstOrThrow({
        where: { accessionNo: accessions[0] },
      });
      const now = new Date();
      await expect(
        prisma.bookIssue.create({
          data: {
            schoolId: DEFAULT_SCHOOL_ID,
            copyId: copy.id,
            memberId,
            issuedAt: now,
            dueAt: new Date(now.getTime() - 1000),
          },
        }),
      ).rejects.toThrow();
    });
  });

  // ── separation of duties ────────────────────────────────────────────

  describe('the seeded Librarian role', () => {
    let issueId: string;

    beforeAll(async () => {
      const { accessions } = await stockedBook('Duties', 1);
      const copy = await prisma.bookCopy.findFirstOrThrow({
        where: { accessionNo: accessions[0] },
      });
      const issuedAt = new Date(Date.now() - 3 * 86_400_000);
      const issue = await prisma.bookIssue.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          copyId: copy.id,
          memberId,
          issuedAt,
          dueAt: new Date(issuedAt.getTime() + 86_400_000),
          returnedAt: new Date(),
          fineAmount: 50,
          fineReason: 'OVERDUE',
          finePaid: false,
        },
      });
      issueId = issue.id;
    });

    it('may run the desk', async () => {
      await server()
        .get('/api/v1/library/issues')
        .set(auth(librarianToken))
        .expect(200);
    });

    it('may take money', async () => {
      await server()
        .post(`/api/v1/library/fines/${issueId}/collect`)
        .set(auth(librarianToken))
        .send({ amount: 10 })
        .expect(201);
    });

    /**
     * The M16/M20/M21 rule, continued into the reading room: the person
     * who takes the money is not the person who decides it is not owed.
     */
    it('may NOT write a fine off', async () => {
      await server()
        .post(`/api/v1/library/fines/${issueId}/waive`)
        .set(auth(librarianToken))
        .send({ reason: 'Feeling generous' })
        .expect(403);
    });

    it('may NOT override a borrowing limit', async () => {
      const { accessions } = await stockedBook('NoOverride', 1);
      // The member is at their limit only if something is out; the point
      // here is the permission, so the override flag alone is enough to
      // reach the check.
      await prisma.libraryMember.update({
        where: { id: memberId },
        data: { status: 'SUSPENDED' },
      });
      await server()
        .post('/api/v1/library/issue')
        .set(auth(librarianToken))
        .send({ accessionNo: accessions[0], cardNo, override: true })
        .expect(403);
      await prisma.libraryMember.update({
        where: { id: memberId },
        data: { status: 'ACTIVE' },
      });
    });

    it('the head may write it off', async () => {
      await server()
        .post(`/api/v1/library/fines/${issueId}/waive`)
        .set(auth(adminToken))
        .send({ reason: 'Disputed damage, settled at 10 BDT' })
        .expect(201);
    });
  });

  // ── holds ───────────────────────────────────────────────────────────

  describe('reservations', () => {
    let heldBookId: string;
    let heldAccession: string;

    beforeAll(async () => {
      const stocked = await stockedBook('Held', 1);
      heldBookId = stocked.bookId;
      heldAccession = stocked.accessions[0];
    });

    it('refuses a hold on a title that is on the shelf', async () => {
      const res = await server()
        .post('/api/v1/library/reservations')
        .set(auth(adminToken))
        .send({ bookId: heldBookId, memberId })
        .expect(409);
      expect(JSON.stringify(res.body)).toMatch(/on the shelf/i);
    });

    it('holds a returned copy for the member who was waiting', async () => {
      // Somebody else takes the only copy.
      const other = dataOf<{ id: string; cardNo: string }>(
        await server()
          .post('/api/v1/library/members')
          .set(auth(adminToken))
          .send({ personType: 'STUDENT', personId: otherStudentId })
          .expect(201),
      );
      await server()
        .post('/api/v1/library/issue')
        .set(auth(adminToken))
        .send({ accessionNo: heldAccession, cardNo: other.cardNo })
        .expect(201);

      // Now our reader can queue for it.
      await server()
        .post('/api/v1/library/reservations')
        .set(auth(adminToken))
        .send({ bookId: heldBookId, memberId })
        .expect(201);

      // It comes back — and does NOT go on the shelf.
      const returned = await server()
        .post('/api/v1/library/return')
        .set(auth(adminToken))
        .send({ accessionNo: heldAccession })
        .expect(201);

      expect(
        dataOf<{ heldFor: { memberId: string } | null }>(returned).heldFor
          ?.memberId,
      ).toBe(memberId);
      const copy = await prisma.bookCopy.findFirstOrThrow({
        where: { accessionNo: heldAccession },
      });
      expect(copy.status).toBe('RESERVED');
    });

    it('refuses to issue a held copy to anybody else', async () => {
      const other = await prisma.libraryMember.findFirstOrThrow({
        where: { personId: otherStudentId },
      });
      const res = await server()
        .post('/api/v1/library/issue')
        .set(auth(librarianToken))
        .send({ accessionNo: heldAccession, cardNo: other.cardNo })
        .expect(409);
      expect(JSON.stringify(res.body)).toMatch(/held for another member/i);
    });

    it('lets the member it is held for collect it, fulfilling the hold', async () => {
      await server()
        .post('/api/v1/library/issue')
        .set(auth(librarianToken))
        .send({ accessionNo: heldAccession, cardNo })
        .expect(201);

      const hold = await prisma.bookReservation.findFirstOrThrow({
        where: { bookId: heldBookId, memberId },
      });
      expect(hold.status).toBe('FULFILLED');
    });
  });

  // ── the portal OPAC ─────────────────────────────────────────────────

  describe('OPAC', () => {
    it('shows the student their own loans', async () => {
      const res = await server()
        .get('/api/v1/portal/library/me')
        .set(auth(studentToken))
        .expect(200);

      const mine = dataOf<{
        member: { cardNo: string } | null;
        loans: unknown[];
      }>(res);
      expect(mine.member?.cardNo).toBe(cardNo);
      expect(mine.loans.length).toBeGreaterThan(0);
    });

    it('searches the catalogue without leaking a purchase price', async () => {
      const res = await server()
        .get('/api/v1/portal/library/catalogue')
        .query({ search: NAME })
        .set(auth(studentToken))
        .expect(200);

      const body = dataOf<{ rows: Array<Record<string, unknown>> }>(res);
      expect(body.rows.length).toBeGreaterThan(0);
      // The SELECT list is the privacy policy (the M19 rule): a reader
      // needs to know whether they can have the book, not what the
      // school paid for it.
      for (const row of body.rows) {
        expect(row).not.toHaveProperty('price');
        expect(row).not.toHaveProperty('description');
      }
    });

    it('refuses a student the admin catalogue', async () => {
      await server()
        .get('/api/v1/library/books')
        .set(auth(studentToken))
        .expect(403);
    });

    it('refuses a student the circulation desk', async () => {
      await server()
        .post('/api/v1/library/issue')
        .set(auth(studentToken))
        .send({ accessionNo: 'ANY', cardNo })
        .expect(403);
    });
  });

  // ── the M09 clearance hook ──────────────────────────────────────────

  describe('student exit clearance (M09 hook)', () => {
    it('warns the office about books still out', async () => {
      const res = await server()
        .put(`/api/v1/students/${studentId}/status`)
        .set(auth(adminToken))
        .send({ status: 'TRANSFERRED', reason: 'Moving to Dhaka' })
        .expect(200);

      const warnings = dataOf<{ warnings: string[] }>(res).warnings;
      expect(warnings.join(' ')).toMatch(/library book/i);
    });

    it('blocks the exit when the school turns the setting on', async () => {
      // Through the API, not straight into `school_settings`: the
      // settings service caches every value in Redis for 60 s and busts
      // that cache on write. A row written behind its back is a row the
      // running app does not see for a minute — which is by design (M04),
      // and is exactly what a first draft of this test discovered.
      await server()
        .put('/api/v1/settings/library')
        .set(auth(adminToken))
        .send({ 'library.clearance_block_exit': true })
        .expect(200);

      try {
        const res = await server()
          .put(`/api/v1/students/${studentId}/status`)
          .set(auth(adminToken))
          .send({ status: 'DROPPED', reason: 'Test' })
          .expect(409);
        expect(JSON.stringify(res.body)).toMatch(/settle the library/i);
      } finally {
        await server()
          .put('/api/v1/settings/library')
          .set(auth(adminToken))
          .send({ 'library.clearance_block_exit': false })
          .expect(200);
      }
    });

    it('clears a person who never borrowed anything', async () => {
      const res = await server()
        .get(`/api/v1/library/clearance/STUDENT/${randomUUID()}`)
        .set(auth(adminToken))
        .expect(200);
      expect(dataOf<{ cleared: boolean }>(res).cleared).toBe(true);
    });
  });

  // ── stock verification ──────────────────────────────────────────────

  describe('stock verification', () => {
    let verificationId: string;

    it('opens a count', async () => {
      const res = await server()
        .post('/api/v1/library/stock-checks')
        .set(auth(librarianToken))
        .send({ name: `${NAME} Annual count` })
        .expect(201);
      verificationId = dataOf<{ id: string }>(res).id;
    });

    it('refuses a second count while one is open', async () => {
      await server()
        .post('/api/v1/library/stock-checks')
        .set(auth(librarianToken))
        .send({ name: `${NAME} Second count` })
        .expect(409);
    });

    it('records an unknown barcode rather than rejecting it', async () => {
      const res = await server()
        .post(`/api/v1/library/stock-checks/${verificationId}/scan`)
        .set(auth(librarianToken))
        .send({ accessionNos: ['NOT-A-REAL-CODE'] })
        .expect(201);
      expect(dataOf<{ unknown: number }>(res).unknown).toBe(1);
    });

    /** A book on loan is legitimately not on the shelf. */
    it('does not report an issued copy as missing', async () => {
      const res = await server()
        .get(`/api/v1/library/stock-checks/${verificationId}/diff`)
        .set(auth(librarianToken))
        .expect(200);

      const diff = dataOf<{
        missing: Array<{ accessionNo: string }>;
        unexpected: Array<{ reason: string }>;
      }>(res);
      const issued = await prisma.bookCopy.findMany({
        where: { schoolId: DEFAULT_SCHOOL_ID, status: 'ISSUED' },
        select: { accessionNo: true },
      });
      const missingCodes = diff.missing.map((m) => m.accessionNo);
      for (const copy of issued) {
        expect(missingCodes).not.toContain(copy.accessionNo);
      }
      expect(diff.unexpected.some((u) => u.reason === 'UNKNOWN')).toBe(true);
    });

    it('closes and freezes the diff', async () => {
      const res = await server()
        .post(`/api/v1/library/stock-checks/${verificationId}/close`)
        .set(auth(librarianToken))
        .send({ notes: 'First pass' })
        .expect(201);

      const closed = dataOf<{
        verification: { status: string; completedAt: string | null };
      }>(res);
      expect(closed.verification.status).toBe('COMPLETED');
      expect(closed.verification.completedAt).not.toBeNull();
    });

    it('refuses to scan into a closed count', async () => {
      await server()
        .post(`/api/v1/library/stock-checks/${verificationId}/scan`)
        .set(auth(librarianToken))
        .send({ accessionNos: ['ANYTHING'] })
        .expect(409);
    });
  });

  // ── reports and the job ─────────────────────────────────────────────

  describe('reports and the overdue job', () => {
    it('lists overdue loans with the member on them', async () => {
      const { accessions } = await stockedBook('Chased', 1);
      await server()
        .post('/api/v1/library/issue')
        .set(auth(librarianToken))
        .send({ accessionNo: accessions[0], cardNo })
        .expect(201);
      const copy = await prisma.bookCopy.findFirstOrThrow({
        where: { accessionNo: accessions[0] },
      });
      await prisma.bookIssue.updateMany({
        where: { copyId: copy.id, returnedAt: null },
        data: {
          issuedAt: new Date(Date.now() - 30 * 86_400_000),
          dueAt: new Date(Date.now() - 9 * 86_400_000),
        },
      });

      const res = await server()
        .get('/api/v1/library/reports/overdue')
        .set(auth(librarianToken))
        .expect(200);

      const rows = dataOf<
        Array<{
          accessionNo: string;
          daysOverdue: number;
          memberName: string;
        }>
      >(res);
      const row = rows.find((r) => r.accessionNo === accessions[0]);
      expect(row).toBeDefined();
      expect(row!.daysOverdue).toBeGreaterThanOrEqual(9);
      expect(row!.memberName).toContain(NAME);
    });

    it('reports category stock without the written-off copies', async () => {
      const res = await server()
        .get('/api/v1/library/reports/stock')
        .set(auth(librarianToken))
        .expect(200);

      const stock = dataOf<{ inStock: number; writtenOff: number }>(res);
      expect(stock.inStock).toBeGreaterThan(0);
      expect(stock.writtenOff).toBeGreaterThanOrEqual(0);
    });

    it('exports the overdue list as a real XLSX', async () => {
      const res = await server()
        .get('/api/v1/library/reports/overdue.xlsx')
        .set(auth(adminToken))
        .expect(200);
      // supertest only buffers known binary types, so the assertion is
      // on the headers (the M12/M20 export convention) — what it proves
      // is that a workbook came back rather than a JSON envelope.
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
      expect(res.headers['content-disposition']).toContain('.xlsx');
    });

    it('chases an overdue loan through the notification pipeline', async () => {
      const job = app.get(LibraryOverdueJob);
      // `force` skips the weekday check — the schedule is a per-school
      // setting, and a test that only passed on Saturdays is the M18
      // attendance-on-Friday flake all over again.
      const result = await job.runForSchool(
        DEFAULT_SCHOOL_ID,
        new Date(),
        true,
      );
      expect(result.chased).toBeGreaterThan(0);

      const sent = await prisma.notification.count({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          templateCode: 'LIBRARY_OVERDUE',
        },
      });
      expect(sent).toBeGreaterThan(0);
    });

    it('does not chase the same loan twice inside the repeat window', async () => {
      const job = app.get(LibraryOverdueJob);
      const again = await job.runForSchool(DEFAULT_SCHOOL_ID, new Date(), true);
      expect(again.chased).toBe(0);
    });
  });

  // ── writing a copy off ──────────────────────────────────────────────

  describe('lost and damaged', () => {
    /**
     * A card of its own. By this point the shared member is at their
     * two-book limit and holding an overdue loan, both of which the
     * issue policy correctly refuses — so borrowing here needs somebody
     * who has not been used by the earlier blocks.
     */
    let lossCardNo: string;
    let lossMemberId: string;

    /**
     * A card per test, not per block: writing a copy off leaves a 600 BDT
     * charge on the borrower, which then correctly blocks them from
     * borrowing the next one. Reusing the card would test the fine block
     * a third time rather than the thing each case is about.
     */
    const freshCard = async (label: string) => {
      const student = await prisma.student.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          studentUid: `${NAME}-${label}-${Date.now()}`,
          firstName: NAME,
          lastName: label,
          gender: 'FEMALE',
          dob: new Date('2013-05-05'),
          admissionDate: new Date('2026-01-02'),
          qrToken: randomUUID(),
        },
      });
      return dataOf<{ id: string; cardNo: string }>(
        await server()
          .post('/api/v1/library/members')
          .set(auth(adminToken))
          .send({ personType: 'STUDENT', personId: student.id })
          .expect(201),
      );
    };

    beforeEach(async () => {
      const member = await freshCard('Loss');
      lossCardNo = member.cardNo;
      lossMemberId = member.id;
    });

    it('closes the open loan and charges the borrower for a lost copy', async () => {
      const { accessions } = await stockedBook('Lost', 1, 400);
      await server()
        .post('/api/v1/library/issue')
        .set(auth(adminToken))
        .send({ accessionNo: accessions[0], cardNo: lossCardNo })
        .expect(201);

      const copy = await prisma.bookCopy.findFirstOrThrow({
        where: { accessionNo: accessions[0] },
      });
      const res = await server()
        .post(`/api/v1/library/copies/${copy.id}/mark`)
        .set(auth(adminToken))
        .send({ status: 'LOST', reason: 'Reported missing by the student' })
        .expect(201);

      const result = dataOf<{ charge: number; chargedMemberId: string }>(res);
      // 400 × the 1.5 lost multiplier.
      expect(result.charge).toBe(600);
      expect(result.chargedMemberId).toBe(lossMemberId);

      const closed = await prisma.bookIssue.findFirstOrThrow({
        where: { copyId: copy.id },
      });
      expect(closed.returnedAt).not.toBeNull();
      expect(closed.fineReason).toBe('LOST');
      // The member's slot is freed — otherwise a lost book would block
      // them from borrowing forever.
      expect(closed.returnedAt).toBeTruthy();
    });

    it('refuses to withdraw a copy that is on loan', async () => {
      const { accessions } = await stockedBook('OnLoan', 1);
      await server()
        .post('/api/v1/library/issue')
        .set(auth(adminToken))
        .send({ accessionNo: accessions[0], cardNo: lossCardNo })
        .expect(201);
      const copy = await prisma.bookCopy.findFirstOrThrow({
        where: { accessionNo: accessions[0] },
      });

      await server()
        .post(`/api/v1/library/copies/${copy.id}/mark`)
        .set(auth(adminToken))
        .send({ status: 'WITHDRAWN', reason: 'Clearing the shelf' })
        .expect(409);
    });
  });
});
