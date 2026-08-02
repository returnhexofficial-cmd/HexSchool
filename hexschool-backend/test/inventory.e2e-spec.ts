import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEFAULT_SCHOOL_ID, UserType } from '../src/common/constants';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { InventoryAlertsJob } from '../src/modules/inventory/jobs/inventory-alerts.job';
import {
  seedSystemRoles,
  syncPermissionRegistry,
} from '../src/modules/rbac/seed/rbac.seeder';

/**
 * Requires dev infra (DB + redis). Module 24 — Inventory & Assets.
 *
 * Built around what unit tests structurally cannot see (roadmap §9):
 *
 *   1. **The chain**: purchase → receive → issue → return, and the
 *      disposal approval beside it. Every step writes to the ledger in
 *      the same transaction as its document, and the only way to know
 *      those two agree is to walk the chain against a real database.
 *   2. **The database invariants.** The one-sided ledger CHECK, the
 *      non-negative balance, the `base_qty = qty × pack_size` identity,
 *      the holder shape, the return ceiling, the status-evidence CHECKs
 *      and the never-reused asset tag are each asserted to actually
 *      refuse a bad row — a constraint nobody has seen reject anything is
 *      a constraint that might not be there.
 *   3. **Separation of duties.** The seeded Office Staff runs the store
 *      and may NOT cancel a received delivery, correct a count or write
 *      an asset off; the Accountant reads the reports and may not issue.
 *      This is the only place the seeded role set is checked against live
 *      requests.
 *   4. **The concurrency the running balance depends on** — two issues of
 *      the same item at once must not both compute against one balance.
 */
describe('Inventory & Assets (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const PASSWORD = 'E2ePass123';
  const ADMIN = 'e2e-inv-admin@test.local';
  const OFFICE = 'e2e-inv-office@test.local';
  const ACCOUNTANT = 'e2e-inv-accountant@test.local';
  const NAME = 'E2EINV';

  let adminToken: string;
  let officeToken: string;
  let accountantToken: string;

  let departmentId: string;
  let categoryId: string;
  let supplierId: string;
  let paperId: string; // CONSUMABLE, REAM, pack of 500
  let penId: string; // CONSUMABLE, PCS, pack of 12
  let chairId: string; // ASSET, PCS

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => request(app.getHttpServer());
  const dataOf = <T>(res: request.Response): T =>
    (res.body as { data: T }).data;

  const emails = [ADMIN, OFFICE, ACCOUNTANT];

  /**
   * `YYYY-MM-DD`, `offset` days from today **in Asia/Dhaka**.
   *
   * The +6 h shift is not decoration — it is the M25 lesson, which was
   * the M23 `chk_book_issues_window` lesson in a new costume. The server
   * dates everything through `dhakaToday()`, so between 18:00 and 24:00
   * UTC a UTC-based fixture is a day behind it, and a disposal dated
   * "today" would land before a purchase dated "today". **Never mix a
   * client-side clock with a server-side one**, in a row or in an
   * assertion.
   */
  const DHAKA_OFFSET_MS = 6 * 3_600_000;
  const day = (offset: number): string =>
    new Date(Date.now() + DHAKA_OFFSET_MS + offset * 86_400_000)
      .toISOString()
      .slice(0, 10);

  const cleanup = async () => {
    // Children before parents; the ledger and the issue lines first,
    // because both point at items.
    await prisma.stockLedgerEntry.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        item: { code: { startsWith: NAME } },
      },
    });
    await prisma.stockIssueItem.deleteMany({
      where: {
        issue: { issueNo: { contains: '' }, schoolId: DEFAULT_SCHOOL_ID },
        item: { code: { startsWith: NAME } },
      },
    });
    await prisma.stockIssue.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, purpose: { startsWith: NAME } },
    });
    await prisma.assetUnit.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        item: { code: { startsWith: NAME } },
      },
    });
    await prisma.purchaseItem.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        item: { code: { startsWith: NAME } },
      },
    });
    await prisma.purchase.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        OR: [
          { supplier: { name: { startsWith: NAME } } },
          { invoiceRef: { startsWith: NAME } },
        ],
      },
    });
    await prisma.item.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, code: { startsWith: NAME } },
    });
    await prisma.itemCategory.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.supplier.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, name: { startsWith: NAME } },
    });
    await prisma.voucherEntry.deleteMany({
      where: { voucher: { sourceRef: { startsWith: 'inventory-purchase:' } } },
    });
    await prisma.voucher.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        sourceRef: { startsWith: 'inventory-purchase:' },
      },
    });
    await prisma.department.deleteMany({
      where: { schoolId: DEFAULT_SCHOOL_ID, code: { startsWith: NAME } },
    });
    await prisma.notification.deleteMany({
      where: {
        schoolId: DEFAULT_SCHOOL_ID,
        templateCode: { startsWith: 'INVENTORY_' },
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
    const [adminUser, officeUser, accountantUser] = await Promise.all([
      mk(ADMIN, UserType.ADMIN),
      mk(OFFICE, UserType.STAFF),
      mk(ACCOUNTANT, UserType.STAFF),
    ]);

    const roleFor = (slug: string) =>
      prisma.role.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, slug, deletedAt: null },
      });
    const [adminRole, officeRole, accountantRole] = await Promise.all([
      roleFor('admin'),
      roleFor('office-staff'),
      roleFor('accountant'),
    ]);
    await prisma.userRole.createMany({
      data: [
        { userId: adminUser.id, roleId: adminRole!.id },
        { userId: officeUser.id, roleId: officeRole!.id },
        { userId: accountantUser.id, roleId: accountantRole!.id },
      ],
    });

    const department = await prisma.department.create({
      data: {
        schoolId: DEFAULT_SCHOOL_ID,
        name: `${NAME} Science`,
        code: `${NAME}-SCI`,
      },
    });
    departmentId = department.id;

    const login = async (identifier: string) => {
      const res = await server()
        .post('/api/v1/auth/login')
        .send({ identifier, password: PASSWORD })
        .expect(200);
      return dataOf<{ accessToken: string }>(res).accessToken;
    };
    adminToken = await login(ADMIN);
    officeToken = await login(OFFICE);
    accountantToken = await login(ACCOUNTANT);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  // ── 1. catalogue ────────────────────────────────────────────────────

  describe('catalogue', () => {
    it('creates a supplier', async () => {
      const res = await server()
        .post('/api/v1/inventory/suppliers')
        .set(auth(officeToken))
        .send({
          name: `${NAME} Karim Traders`,
          contactPerson: 'Karim',
          phone: '01711111111',
        })
        .expect(201);
      supplierId = dataOf<{ id: string }>(res).id;
      expect(supplierId).toBeTruthy();
    });

    it('refuses a second supplier with the same name', async () => {
      await server()
        .post('/api/v1/inventory/suppliers')
        .set(auth(officeToken))
        .send({ name: `${NAME} karim traders` })
        .expect(409);
    });

    it('refuses blacklisting a supplier with no reason', async () => {
      await server()
        .patch(`/api/v1/inventory/suppliers/${supplierId}`)
        .set(auth(officeToken))
        .send({ name: `${NAME} Karim Traders`, status: 'BLACKLISTED' })
        .expect(400);
    });

    it('creates a category', async () => {
      const res = await server()
        .post('/api/v1/inventory/categories')
        .set(auth(officeToken))
        .send({ name: `${NAME} Stationery` })
        .expect(201);
      categoryId = dataOf<{ id: string }>(res).id;
    });

    it('refuses a sibling category with the same name', async () => {
      await server()
        .post('/api/v1/inventory/categories')
        .set(auth(officeToken))
        .send({ name: `${NAME} stationery` })
        .expect(409);
    });

    it('refuses a category cycle', async () => {
      const child = await server()
        .post('/api/v1/inventory/categories')
        .set(auth(officeToken))
        .send({ name: `${NAME} Paper`, parentId: categoryId })
        .expect(201);
      const childId = dataOf<{ id: string }>(child).id;

      // Making the parent a child of its own child.
      await server()
        .patch(`/api/v1/inventory/categories/${categoryId}`)
        .set(auth(officeToken))
        .send({ name: `${NAME} Stationery`, parentId: childId })
        .expect(400);
    });

    it('creates items — a ream of 500, a box of 12, and an asset', async () => {
      const mk = (body: Record<string, unknown>) =>
        server()
          .post('/api/v1/inventory/items')
          .set(auth(officeToken))
          .send(body)
          .expect(201);

      paperId = dataOf<{ id: string }>(
        await mk({
          code: `${NAME}-PAPER`,
          name: `${NAME} A4 Paper`,
          type: 'CONSUMABLE',
          unit: 'REAM',
          categoryId,
          reorderLevel: 10,
        }),
      ).id;

      penId = dataOf<{ id: string }>(
        await mk({
          code: `${NAME}-PEN`,
          name: `${NAME} Ball Pen`,
          type: 'CONSUMABLE',
          unit: 'PCS',
          categoryId,
          packSize: 12,
          packLabel: 'Box of 12',
          reorderLevel: 50,
        }),
      ).id;

      chairId = dataOf<{ id: string }>(
        await mk({
          code: `${NAME}-CHAIR`,
          name: `${NAME} Classroom Chair`,
          type: 'ASSET',
          unit: 'PCS',
        }),
      ).id;

      expect([paperId, penId, chairId].every(Boolean)).toBe(true);
    });

    it('refuses a duplicate item code', async () => {
      await server()
        .post('/api/v1/inventory/items')
        .set(auth(officeToken))
        .send({
          code: `${NAME.toLowerCase()}-paper`,
          name: 'Something else',
          type: 'CONSUMABLE',
        })
        .expect(409);
    });

    it('reports a brand-new item as a zero balance, not as missing', async () => {
      const res = await server()
        .get(`/api/v1/inventory/items/${paperId}`)
        .set(auth(officeToken))
        .expect(200);
      expect(dataOf<{ balance: number }>(res).balance).toBe(0);
    });
  });

  // ── 2. purchase → receive ───────────────────────────────────────────

  describe('purchase and receive', () => {
    let purchaseId: string;

    it('creates a draft with a gap-free number and a computed total', async () => {
      const res = await server()
        .post('/api/v1/inventory/purchases')
        .set(auth(officeToken))
        .send({
          supplierId,
          date: day(-1),
          invoiceRef: `${NAME}-INV-1`,
          lines: [
            // 2 reams @ 300 = 600
            { itemId: paperId, qty: 2, unitPrice: 300 },
            // 4 boxes of 12 @ 240 = 960, i.e. 48 pens at 20 each
            { itemId: penId, qty: 4, unitPrice: 240 },
          ],
        })
        .expect(201);

      const body = dataOf<{
        id: string;
        purchaseNo: string;
        total: string;
        status: string;
      }>(res);
      purchaseId = body.id;
      expect(body.purchaseNo).toMatch(/^PO-\d{2}-\d{5}$/);
      expect(Number(body.total)).toBe(1560);
      expect(body.status).toBe('DRAFT');
    });

    it('stores the base quantity as qty × pack size (roadmap §8)', async () => {
      const lines = await prisma.purchaseItem.findMany({
        where: { purchaseId },
      });
      const pen = lines.find((line) => line.itemId === penId)!;
      expect(Number(pen.qty)).toBe(4);
      expect(Number(pen.packSize)).toBe(12);
      expect(Number(pen.baseQty)).toBe(48);
    });

    it('a DRAFT moves no stock at all', async () => {
      const res = await server()
        .get(`/api/v1/inventory/items/${paperId}`)
        .set(auth(officeToken))
        .expect(200);
      expect(dataOf<{ balance: number }>(res).balance).toBe(0);
    });

    it('receives the delivery: stock in, in base units', async () => {
      await server()
        .post(`/api/v1/inventory/purchases/${purchaseId}/receive`)
        .set(auth(officeToken))
        .send({})
        .expect(201);

      const paper = await server()
        .get(`/api/v1/inventory/items/${paperId}`)
        .set(auth(officeToken))
        .expect(200);
      const pen = await server()
        .get(`/api/v1/inventory/items/${penId}`)
        .set(auth(officeToken))
        .expect(200);

      expect(dataOf<{ balance: number }>(paper).balance).toBe(2);
      // 4 boxes became 48 pens — the whole point of §8's conversion.
      expect(dataOf<{ balance: number }>(pen).balance).toBe(48);
    });

    it('writes the per-base-unit cost, so a box of 12 at 240 values a pen at 20', async () => {
      const pen = await prisma.item.findUnique({ where: { id: penId } });
      expect(Number(pen!.lastUnitCost)).toBe(20);
    });

    it('stamps received_at as the status evidence', async () => {
      const purchase = await prisma.purchase.findUnique({
        where: { id: purchaseId },
      });
      expect(purchase!.status).toBe('RECEIVED');
      expect(purchase!.receivedAt).toBeTruthy();
      expect(purchase!.receivedBy).toBeTruthy();
    });

    it('posts a DEBIT voucher through M20, idempotent on its source ref', async () => {
      const vouchers = await prisma.voucher.findMany({
        where: { sourceRef: `inventory-purchase:${purchaseId}` },
        include: { entries: true },
      });
      expect(vouchers).toHaveLength(1);
      expect(vouchers[0].type).toBe('DEBIT');
      expect(vouchers[0].source).toBe('INVENTORY');

      const debits = vouchers[0].entries.reduce(
        (sum, e) => sum + Number(e.debit),
        0,
      );
      const credits = vouchers[0].entries.reduce(
        (sum, e) => sum + Number(e.credit),
        0,
      );
      expect(debits).toBe(1560);
      // Σdebit = Σcredit to the paisa, or M20 refuses to post it.
      expect(debits).toBe(credits);
    });

    it('**a RECEIVED purchase is immutable** (roadmap §6)', async () => {
      await server()
        .patch(`/api/v1/inventory/purchases/${purchaseId}`)
        .set(auth(officeToken))
        .send({
          date: day(0),
          lines: [{ itemId: paperId, qty: 99, unitPrice: 1 }],
        })
        .expect(409);

      await server()
        .delete(`/api/v1/inventory/purchases/${purchaseId}`)
        .set(auth(officeToken))
        .expect(409);
    });

    it('refuses to receive it twice', async () => {
      await server()
        .post(`/api/v1/inventory/purchases/${purchaseId}/receive`)
        .set(auth(officeToken))
        .send({})
        .expect(409);
    });

    it('generates one tagged unit per asset bought', async () => {
      const res = await server()
        .post('/api/v1/inventory/purchases')
        .set(auth(officeToken))
        .send({
          supplierId,
          date: day(-1),
          invoiceRef: `${NAME}-INV-2`,
          lines: [{ itemId: chairId, qty: 3, unitPrice: 1200 }],
        })
        .expect(201);
      const assetPurchase = dataOf<{ id: string }>(res).id;

      const received = await server()
        .post(`/api/v1/inventory/purchases/${assetPurchase}/receive`)
        .set(auth(officeToken))
        .send({ locationText: 'Room 3', warrantyUntil: day(365) })
        .expect(201);

      expect(
        dataOf<{ assetUnitsGenerated: number }>(received).assetUnitsGenerated,
      ).toBe(3);

      const units = await prisma.assetUnit.findMany({
        where: { itemId: chairId, deletedAt: null },
      });
      expect(units).toHaveLength(3);
      // Tags are contiguous and normalized.
      expect(units.every((u) => /^AST-\d{5}$/.test(u.assetTag))).toBe(true);
      // A received batch goes to the STORE, held by nobody — the all-NULL
      // branch of `chk_asset_units_custodian`.
      expect(units.every((u) => u.status === 'IN_STORE')).toBe(true);
      expect(units.every((u) => u.custodianType === null)).toBe(true);
      expect(units.every((u) => Number(u.purchasePrice) === 1200)).toBe(true);
    });

    it('refuses a warranty that would have expired before the delivery (roadmap §7)', async () => {
      const res = await server()
        .post('/api/v1/inventory/purchases')
        .set(auth(officeToken))
        .send({
          date: day(-1),
          invoiceRef: `${NAME}-INV-3`,
          lines: [{ itemId: chairId, qty: 1, unitPrice: 100 }],
        })
        .expect(201);
      const id = dataOf<{ id: string }>(res).id;

      await server()
        .post(`/api/v1/inventory/purchases/${id}/receive`)
        .set(auth(officeToken))
        .send({ warrantyUntil: day(-30) })
        .expect(400);

      await prisma.purchaseItem.deleteMany({ where: { purchaseId: id } });
      await prisma.purchase.delete({ where: { id } });
    });

    it('refuses a purchase line against a blacklisted supplier', async () => {
      await server()
        .patch(`/api/v1/inventory/suppliers/${supplierId}`)
        .set(auth(officeToken))
        .send({
          name: `${NAME} Karim Traders`,
          status: 'BLACKLISTED',
          statusReason: 'Short-delivered twice',
        })
        .expect(200);

      await server()
        .post('/api/v1/inventory/purchases')
        .set(auth(officeToken))
        .send({
          supplierId,
          date: day(0),
          lines: [{ itemId: paperId, qty: 1, unitPrice: 100 }],
        })
        .expect(409);

      await server()
        .patch(`/api/v1/inventory/suppliers/${supplierId}`)
        .set(auth(officeToken))
        .send({ name: `${NAME} Karim Traders`, status: 'ACTIVE' })
        .expect(200);
    });
  });

  // ── 3. issue → return ───────────────────────────────────────────────

  describe('issue and return', () => {
    let issueId: string;
    let paperLineId: string;

    it('previews the same verdict the endpoint will reach', async () => {
      const res = await server()
        .post('/api/v1/inventory/issues/preview')
        .set(auth(officeToken))
        .send({
          issueDate: day(0),
          issuedTo: { type: 'DEPARTMENT', departmentId },
          lines: [{ itemId: penId, qty: 12 }],
        })
        .expect(200);
      expect(dataOf<{ allowed: boolean }>(res).allowed).toBe(true);
    });

    it('issues to a department and takes the stock out', async () => {
      const res = await server()
        .post('/api/v1/inventory/issues')
        .set(auth(officeToken))
        .send({
          issueDate: day(0),
          issuedTo: { type: 'DEPARTMENT', departmentId },
          purpose: `${NAME} term supplies`,
          lines: [
            { itemId: penId, qty: 12 },
            { itemId: paperId, qty: 1 },
          ],
        })
        .expect(201);

      const body = dataOf<{
        id: string;
        issueNo: string;
        status: string;
        holderName: string;
        items: Array<{ id: string; itemId: string }>;
      }>(res);
      issueId = body.id;
      paperLineId = body.items.find((line) => line.itemId === paperId)!.id;

      expect(body.issueNo).toMatch(/^ISS-\d{2}-\d{5}$/);
      expect(body.status).toBe('ISSUED');
      // Resolved LIVE, never snapshotted onto the slip.
      expect(body.holderName).toBe(`${NAME} Science`);

      const pen = await server()
        .get(`/api/v1/inventory/items/${penId}`)
        .set(auth(officeToken))
        .expect(200);
      expect(dataOf<{ balance: number }>(pen).balance).toBe(36);
    });

    it('**refuses an issue past the balance, reporting every bad line at once**', async () => {
      const res = await server()
        .post('/api/v1/inventory/issues')
        .set(auth(officeToken))
        .send({
          issueDate: day(0),
          issuedTo: { type: 'ROOM', room: 'Room 5' },
          lines: [
            { itemId: penId, qty: 9999 },
            // An asset cannot be issued by quantity at all.
            { itemId: chairId, qty: 1 },
          ],
        })
        .expect(409);

      const details = (
        res.body as { error: { details?: Array<{ reason: string }> } }
      ).error.details;
      expect(details).toHaveLength(2);
      expect(details!.some((d) => /on hand/.test(d.reason))).toBe(true);
      expect(details!.some((d) => /asset register/.test(d.reason))).toBe(true);
    });

    it('a refused issue moves no stock', async () => {
      const pen = await server()
        .get(`/api/v1/inventory/items/${penId}`)
        .set(auth(officeToken))
        .expect(200);
      expect(dataOf<{ balance: number }>(pen).balance).toBe(36);
    });

    it('takes a partial return and derives PARTIAL_RETURN', async () => {
      const res = await server()
        .post(`/api/v1/inventory/issues/${issueId}/return`)
        .set(auth(officeToken))
        .send({ lines: [{ issueItemId: paperLineId, qty: 1 }] })
        .expect(201);

      // The paper line is fully back but the pen line is not, so the SLIP
      // is partial — a fold over the lines, not a count of them.
      expect(dataOf<{ status: string }>(res).status).toBe('PARTIAL_RETURN');

      const paper = await server()
        .get(`/api/v1/inventory/items/${paperId}`)
        .set(auth(officeToken))
        .expect(200);
      expect(dataOf<{ balance: number }>(paper).balance).toBe(2);
    });

    it('refuses a return of more than went out (roadmap §6)', async () => {
      const issue = await prisma.stockIssue.findUnique({
        where: { id: issueId },
        include: { items: true },
      });
      const penLine = issue!.items.find((line) => line.itemId === penId)!;

      await server()
        .post(`/api/v1/inventory/issues/${issueId}/return`)
        .set(auth(officeToken))
        .send({ lines: [{ issueItemId: penLine.id, qty: 999 }] })
        .expect(409);
    });

    it('refuses a second return of a line that is already fully back', async () => {
      await server()
        .post(`/api/v1/inventory/issues/${issueId}/return`)
        .set(auth(officeToken))
        .send({ lines: [{ issueItemId: paperLineId, qty: 1 }] })
        .expect(409);
    });

    it('derives RETURNED once every line is back', async () => {
      const issue = await prisma.stockIssue.findUnique({
        where: { id: issueId },
        include: { items: true },
      });
      const penLine = issue!.items.find((line) => line.itemId === penId)!;

      const res = await server()
        .post(`/api/v1/inventory/issues/${issueId}/return`)
        .set(auth(officeToken))
        .send({ lines: [{ issueItemId: penLine.id, qty: 12 }] })
        .expect(201);

      expect(dataOf<{ status: string }>(res).status).toBe('RETURNED');

      const pen = await server()
        .get(`/api/v1/inventory/items/${penId}`)
        .set(auth(officeToken))
        .expect(200);
      expect(dataOf<{ balance: number }>(pen).balance).toBe(48);
    });

    it('refuses an issue to a department that does not exist', async () => {
      await server()
        .post('/api/v1/inventory/issues')
        .set(auth(officeToken))
        .send({
          issueDate: day(0),
          issuedTo: {
            type: 'DEPARTMENT',
            departmentId: '00000000-0000-4000-8000-000000000999',
          },
          lines: [{ itemId: penId, qty: 1 }],
        })
        .expect(404);
    });

    it('refuses a ROOM issue with no room named', async () => {
      await server()
        .post('/api/v1/inventory/issues')
        .set(auth(officeToken))
        .send({
          issueDate: day(0),
          issuedTo: { type: 'ROOM' },
          lines: [{ itemId: penId, qty: 1 }],
        })
        .expect(400);
    });
  });

  // ── 4. adjustments ──────────────────────────────────────────────────

  describe('adjustments (roadmap §4 + §8 count sheet)', () => {
    it('refuses an adjustment with no reason', async () => {
      await server()
        .post('/api/v1/inventory/adjustments')
        .set(auth(adminToken))
        .send({ lines: [{ itemId: paperId, countedQty: 1 }] })
        .expect(400);
    });

    it('takes a counted quantity and derives the movement', async () => {
      // The ledger says 2 reams; the shelf has 1.
      const res = await server()
        .post('/api/v1/inventory/adjustments')
        .set(auth(adminToken))
        .send({
          lines: [{ itemId: paperId, countedQty: 1 }],
          reason: 'Stock take March',
        })
        .expect(201);

      const adjusted = dataOf<{
        adjusted: Array<{ direction: string; difference: number }>;
      }>(res).adjusted;
      expect(adjusted).toHaveLength(1);
      expect(adjusted[0]).toMatchObject({ direction: 'OUT', difference: 1 });

      const paper = await server()
        .get(`/api/v1/inventory/items/${paperId}`)
        .set(auth(officeToken))
        .expect(200);
      expect(dataOf<{ balance: number }>(paper).balance).toBe(1);
    });

    it('skips items whose count already matches', async () => {
      const res = await server()
        .post('/api/v1/inventory/adjustments')
        .set(auth(adminToken))
        .send({
          lines: [{ itemId: paperId, countedQty: 1 }],
          reason: 'Recount',
        })
        .expect(201);
      expect(dataOf<{ adjusted: unknown[] }>(res).adjusted).toHaveLength(0);
    });

    it('refuses a count that would drive the balance negative', async () => {
      // Not reachable through `countedQty` (it is floored at 0), so this
      // is the ledger's own guard, asserted directly below in §7.
      const res = await server()
        .post('/api/v1/inventory/adjustments')
        .set(auth(adminToken))
        .send({
          lines: [{ itemId: paperId, countedQty: 0 }],
          reason: 'Everything gone',
        })
        .expect(201);
      expect(dataOf<{ adjusted: unknown[] }>(res).adjusted).toHaveLength(1);
    });

    it('records what the ledger said before the correction', async () => {
      const rows = await prisma.stockLedgerEntry.findMany({
        where: { itemId: paperId, txn: 'ADJUST' },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows[0].remarks).toContain('ledger 2 → counted 1');
    });
  });

  // ── 5. assets ───────────────────────────────────────────────────────

  describe('asset lifecycle', () => {
    let assetId: string;

    beforeAll(async () => {
      const unit = await prisma.assetUnit.findFirst({
        where: { itemId: chairId, deletedAt: null },
        orderBy: { assetTag: 'asc' },
      });
      assetId = unit!.id;
    });

    it('assigns a unit to a department', async () => {
      const res = await server()
        .post(`/api/v1/inventory/assets/${assetId}/assign`)
        .set(auth(officeToken))
        .send({
          custodian: { type: 'DEPARTMENT', departmentId },
          locationText: 'Lab 1',
        })
        .expect(201);

      const body = dataOf<{ status: string; custodianName: string }>(res);
      expect(body.status).toBe('ASSIGNED');
      expect(body.custodianName).toBe(`${NAME} Science`);
    });

    it('transfers it to a room — ASSIGNED → ASSIGNED, custodian changes', async () => {
      const res = await server()
        .post(`/api/v1/inventory/assets/${assetId}/transfer`)
        .set(auth(officeToken))
        .send({ custodian: { type: 'ROOM', room: 'Room 7' } })
        .expect(201);

      const body = dataOf<{ status: string; custodianName: string }>(res);
      expect(body.status).toBe('ASSIGNED');
      expect(body.custodianName).toBe('Room 7');

      // The holder CHECK: exactly one shape at a time.
      const row = await prisma.assetUnit.findUnique({ where: { id: assetId } });
      expect(row!.custodianRoom).toBe('Room 7');
      expect(row!.custodianDeptId).toBeNull();
      expect(row!.custodianPersonId).toBeNull();
    });

    it('sends it for repair and KEEPS the custodian', async () => {
      await server()
        .post(`/api/v1/inventory/assets/${assetId}/repair`)
        .set(auth(officeToken))
        .send({ remarks: 'Leg broken' })
        .expect(201);

      const row = await prisma.assetUnit.findUnique({ where: { id: assetId } });
      expect(row!.status).toBe('UNDER_REPAIR');
      // It is still Room 7's chair — it is merely away being fixed.
      expect(row!.custodianRoom).toBe('Room 7');
    });

    it('completes the repair and hands it straight back', async () => {
      const res = await server()
        .post(`/api/v1/inventory/assets/${assetId}/repair-complete`)
        .set(auth(officeToken))
        .send({ condition: 'FAIR' })
        .expect(201);
      const body = dataOf<{ status: string; condition: string }>(res);
      expect(body.status).toBe('ASSIGNED');
      expect(body.condition).toBe('FAIR');
    });

    it('returns it to the store, clearing the custodian to all-NULL', async () => {
      await server()
        .post(`/api/v1/inventory/assets/${assetId}/return`)
        .set(auth(officeToken))
        .expect(201);

      const row = await prisma.assetUnit.findUnique({ where: { id: assetId } });
      expect(row!.status).toBe('IN_STORE');
      expect(row!.custodianType).toBeNull();
      expect(row!.custodianRoom).toBeNull();
    });

    it('**the office may NOT write an asset off** (roadmap §6)', async () => {
      await server()
        .post(`/api/v1/inventory/assets/${assetId}/dispose`)
        .set(auth(officeToken))
        .send({ status: 'DISPOSED', disposedAt: day(0), reason: 'Broken' })
        .expect(403);
    });

    it('the head may, and the reason and the name are recorded', async () => {
      const res = await server()
        .post(`/api/v1/inventory/assets/${assetId}/dispose`)
        .set(auth(adminToken))
        .send({
          status: 'DISPOSED',
          disposedAt: day(0),
          reason: 'Beyond economic repair',
        })
        .expect(201);
      expect(dataOf<{ status: string }>(res).status).toBe('DISPOSED');

      const row = await prisma.assetUnit.findUnique({ where: { id: assetId } });
      expect(row!.disposalReason).toBe('Beyond economic repair');
      expect(row!.disposedBy).toBeTruthy();
      expect(row!.disposedAt).toBeTruthy();
    });

    it('**a written-off unit never comes back**', async () => {
      await server()
        .post(`/api/v1/inventory/assets/${assetId}/assign`)
        .set(auth(officeToken))
        .send({ custodian: { type: 'DEPARTMENT', departmentId } })
        .expect(409);

      await server()
        .post(`/api/v1/inventory/assets/${assetId}/return`)
        .set(auth(officeToken))
        .expect(409);
    });

    it('drops it from the register count but keeps it in the written-off list', async () => {
      const res = await server()
        .get('/api/v1/inventory/reports/assets')
        .set(auth(adminToken))
        .expect(200);

      const report = dataOf<{
        rows: Array<{ id: string }>;
        counts: { onBooks: number; disposed: number };
        writtenOff: Array<{ id: string; reason: string }>;
      }>(res);

      expect(report.rows.some((row) => row.id === assetId)).toBe(false);
      expect(report.counts.disposed).toBeGreaterThanOrEqual(1);
      expect(report.writtenOff.some((row) => row.id === assetId)).toBe(true);
    });

    it('**never re-issues the tag of a deleted unit**', async () => {
      // The index ignores `deleted_at` on purpose: a label already stuck
      // to a chair must not name a second chair.
      const spare = await prisma.assetUnit.findFirst({
        where: { itemId: chairId, deletedAt: null, id: { not: assetId } },
      });
      await prisma.assetUnit.update({
        where: { id: spare!.id },
        data: { deletedAt: new Date() },
      });

      const res = await server()
        .post('/api/v1/inventory/assets')
        .set(auth(officeToken))
        .send({ itemId: chairId, assetTag: spare!.assetTag })
        .expect(409);
      expect(JSON.stringify(res.body)).toMatch(/never reused/);

      await prisma.assetUnit.update({
        where: { id: spare!.id },
        data: { deletedAt: null },
      });
    });

    it('refuses to tag a consumable', async () => {
      await server()
        .post('/api/v1/inventory/assets')
        .set(auth(officeToken))
        .send({ itemId: paperId })
        .expect(400);
    });
  });

  // ── 6. cancelling a received purchase ───────────────────────────────

  describe('cancelling a received purchase (roadmap §6)', () => {
    let cancelId: string;

    beforeAll(async () => {
      const res = await server()
        .post('/api/v1/inventory/purchases')
        .set(auth(officeToken))
        .send({
          supplierId,
          date: day(0),
          invoiceRef: `${NAME}-INV-CANCEL`,
          lines: [{ itemId: penId, qty: 1, unitPrice: 240 }],
        })
        .expect(201);
      cancelId = dataOf<{ id: string }>(res).id;
      await server()
        .post(`/api/v1/inventory/purchases/${cancelId}/receive`)
        .set(auth(officeToken))
        .send({})
        .expect(201);
    });

    it('the office may NOT cancel a received delivery', async () => {
      await server()
        .post(`/api/v1/inventory/purchases/${cancelId}/cancel`)
        .set(auth(officeToken))
        .send({ reason: 'Wrong goods' })
        .expect(403);
    });

    it('the head may, and the stock is reversed rather than deleted', async () => {
      const before = dataOf<{ balance: number }>(
        await server()
          .get(`/api/v1/inventory/items/${penId}`)
          .set(auth(officeToken))
          .expect(200),
      ).balance;

      await server()
        .post(`/api/v1/inventory/purchases/${cancelId}/cancel`)
        .set(auth(adminToken))
        .send({ reason: 'Supplier delivered the wrong goods' })
        .expect(201);

      const after = dataOf<{ balance: number }>(
        await server()
          .get(`/api/v1/inventory/items/${penId}`)
          .set(auth(officeToken))
          .expect(200),
      ).balance;
      expect(after).toBe(before - 12);

      // The PURCHASE rows are still in the ledger — the delivery happened.
      const rows = await prisma.stockLedgerEntry.findMany({
        where: { refType: 'PURCHASE', refId: cancelId },
      });
      expect(rows.some((row) => row.txn === 'PURCHASE')).toBe(true);
      expect(rows.some((row) => row.txn === 'ADJUST')).toBe(true);
    });

    it('leaves the posted voucher standing — reversing it is the accountant’s call', async () => {
      const vouchers = await prisma.voucher.findMany({
        where: { sourceRef: `inventory-purchase:${cancelId}` },
      });
      expect(vouchers).toHaveLength(1);
      expect(vouchers[0].status).toBe('POSTED');
    });

    it('refuses to cancel a delivery whose stock has already gone out', async () => {
      const res = await server()
        .post('/api/v1/inventory/purchases')
        .set(auth(officeToken))
        .send({
          supplierId,
          date: day(0),
          invoiceRef: `${NAME}-INV-SPENT`,
          lines: [{ itemId: paperId, qty: 5, unitPrice: 300 }],
        })
        .expect(201);
      const spentId = dataOf<{ id: string }>(res).id;

      await server()
        .post(`/api/v1/inventory/purchases/${spentId}/receive`)
        .set(auth(officeToken))
        .send({})
        .expect(201);

      // Issue everything the school now holds.
      const balance = dataOf<{ balance: number }>(
        await server()
          .get(`/api/v1/inventory/items/${paperId}`)
          .set(auth(officeToken))
          .expect(200),
      ).balance;

      await server()
        .post('/api/v1/inventory/issues')
        .set(auth(officeToken))
        .send({
          issueDate: day(0),
          issuedTo: { type: 'ROOM', room: 'Room 9' },
          purpose: `${NAME} exam papers`,
          lines: [{ itemId: paperId, qty: balance }],
        })
        .expect(201);

      // Now the reversal cannot fit — and that refusal is the point.
      await server()
        .post(`/api/v1/inventory/purchases/${spentId}/cancel`)
        .set(auth(adminToken))
        .send({ reason: 'Too late' })
        .expect(409);
    });
  });

  // ── 7. the database invariants ──────────────────────────────────────

  describe('database invariants', () => {
    const raw = (sql: string) => prisma.$executeRawUnsafe(sql);

    it('chk_stock_ledger_one_sided refuses a two-sided movement', async () => {
      await expect(
        raw(`INSERT INTO stock_ledger (school_id, item_id, txn, qty_in, qty_out, balance_after)
             VALUES ('${DEFAULT_SCHOOL_ID}', '${paperId}', 'PURCHASE', 5, 5, 0)`),
      ).rejects.toThrow();
    });

    it('chk_stock_ledger_one_sided refuses a movement of nothing', async () => {
      await expect(
        raw(`INSERT INTO stock_ledger (school_id, item_id, txn, qty_in, qty_out, balance_after)
             VALUES ('${DEFAULT_SCHOOL_ID}', '${paperId}', 'PURCHASE', 0, 0, 0)`),
      ).rejects.toThrow();
    });

    it('**the balance may never go negative**', async () => {
      await expect(
        raw(`INSERT INTO stock_ledger (school_id, item_id, txn, qty_in, qty_out, balance_after)
             VALUES ('${DEFAULT_SCHOOL_ID}', '${paperId}', 'ISSUE', 0, 5, -5)`),
      ).rejects.toThrow();
    });

    it('chk_stock_ledger_reason refuses an ADJUST with no reason', async () => {
      await expect(
        raw(`INSERT INTO stock_ledger (school_id, item_id, txn, qty_in, qty_out, balance_after)
             VALUES ('${DEFAULT_SCHOOL_ID}', '${paperId}', 'ADJUST', 1, 0, 1)`),
      ).rejects.toThrow();
    });

    it('chk_purchase_items_shape refuses base_qty ≠ qty × pack_size', async () => {
      const purchase = await prisma.purchase.findFirst({
        where: { schoolId: DEFAULT_SCHOOL_ID, invoiceRef: `${NAME}-INV-1` },
      });
      await expect(
        raw(`INSERT INTO purchase_items (school_id, purchase_id, item_id, qty, pack_size, base_qty, unit_price, total, updated_at)
             VALUES ('${DEFAULT_SCHOOL_ID}', '${purchase!.id}', '${chairId}', 4, 12, 4, 100, 400, CURRENT_TIMESTAMP)`),
      ).rejects.toThrow();
    });

    it('chk_asset_units_custodian refuses two holder shapes at once', async () => {
      await expect(
        raw(`INSERT INTO asset_units (school_id, item_id, asset_tag, custodian_type, custodian_dept_id, custodian_room, updated_at)
             VALUES ('${DEFAULT_SCHOOL_ID}', '${chairId}', '${NAME}-BAD-1', 'DEPARTMENT', '${departmentId}', 'Room 4', CURRENT_TIMESTAMP)`),
      ).rejects.toThrow();
    });

    it('chk_asset_units_custodian refuses a kind with no target', async () => {
      await expect(
        raw(`INSERT INTO asset_units (school_id, item_id, asset_tag, custodian_type, updated_at)
             VALUES ('${DEFAULT_SCHOOL_ID}', '${chairId}', '${NAME}-BAD-2', 'PERSON', CURRENT_TIMESTAMP)`),
      ).rejects.toThrow();
    });

    it('chk_asset_units_disposal_evidence refuses a write-off with no reason', async () => {
      await expect(
        raw(`INSERT INTO asset_units (school_id, item_id, asset_tag, status, disposed_at, updated_at)
             VALUES ('${DEFAULT_SCHOOL_ID}', '${chairId}', '${NAME}-BAD-3', 'DISPOSED', CURRENT_DATE, CURRENT_TIMESTAMP)`),
      ).rejects.toThrow();
    });

    it('chk_asset_units_warranty refuses cover that predates the purchase', async () => {
      await expect(
        raw(`INSERT INTO asset_units (school_id, item_id, asset_tag, purchase_date, warranty_until, updated_at)
             VALUES ('${DEFAULT_SCHOOL_ID}', '${chairId}', '${NAME}-BAD-4', DATE '2026-06-01', DATE '2026-01-01', CURRENT_TIMESTAMP)`),
      ).rejects.toThrow();
    });

    it('chk_purchases_status_evidence refuses RECEIVED with no received_at', async () => {
      await expect(
        raw(`INSERT INTO purchases (school_id, purchase_no, date, status, updated_at)
             VALUES ('${DEFAULT_SCHOOL_ID}', '${NAME}-BAD-PO', CURRENT_DATE, 'RECEIVED', CURRENT_TIMESTAMP)`),
      ).rejects.toThrow();
    });

    it('chk_stock_issue_items_returned refuses more returned than issued', async () => {
      const line = await prisma.stockIssueItem.findFirst({
        where: { itemId: penId },
      });
      await expect(
        raw(
          `UPDATE stock_issue_items SET returned_qty = qty + 1 WHERE id = '${line!.id}'`,
        ),
      ).rejects.toThrow();
    });

    it('chk_suppliers_shape refuses a blacklisting with no reason', async () => {
      await expect(
        raw(`INSERT INTO suppliers (school_id, name, status, updated_at)
             VALUES ('${DEFAULT_SCHOOL_ID}', '${NAME} Bad Supplier', 'BLACKLISTED', CURRENT_TIMESTAMP)`),
      ).rejects.toThrow();
    });

    it('uq_purchase_items_identity refuses one item twice on a purchase', async () => {
      await server()
        .post('/api/v1/inventory/purchases')
        .set(auth(officeToken))
        .send({
          date: day(0),
          lines: [
            { itemId: paperId, qty: 1, unitPrice: 10 },
            { itemId: paperId, qty: 2, unitPrice: 10 },
          ],
        })
        .expect(400);
    });

    it('uq_items_code frees a code when the item is deleted', async () => {
      const created = await server()
        .post('/api/v1/inventory/items')
        .set(auth(officeToken))
        .send({
          code: `${NAME}-TEMP`,
          name: `${NAME} Temporary`,
          type: 'CONSUMABLE',
        })
        .expect(201);
      const tempId = dataOf<{ id: string }>(created).id;

      await server()
        .delete(`/api/v1/inventory/items/${tempId}`)
        .set(auth(officeToken))
        .expect(204);

      // An item code is a catalogue label, not a sticker — the OPPOSITE
      // of the asset-tag rule, and deliberately so.
      await server()
        .post('/api/v1/inventory/items')
        .set(auth(officeToken))
        .send({
          code: `${NAME}-TEMP`,
          name: `${NAME} Temporary Again`,
          type: 'CONSUMABLE',
        })
        .expect(201);
    });

    it('refuses to delete an item that has stock history', async () => {
      const res = await server()
        .delete(`/api/v1/inventory/items/${paperId}`)
        .set(auth(officeToken))
        .expect(409);
      expect(JSON.stringify(res.body)).toMatch(/stock movement/);
    });
  });

  // ── 8. the running balance under concurrency ────────────────────────

  describe('the running balance', () => {
    it('**stays consistent when two issues of one item race**', async () => {
      // Without the FOR UPDATE lock in `lockItemAndReadBalance`, both
      // would read the same starting balance and write balances computed
      // against it — and the column would silently stop adding up.
      const res = await server()
        .post('/api/v1/inventory/purchases')
        .set(auth(officeToken))
        .send({
          date: day(0),
          invoiceRef: `${NAME}-INV-RACE`,
          lines: [{ itemId: penId, qty: 10, unitPrice: 240 }],
        })
        .expect(201);
      const raceId = dataOf<{ id: string }>(res).id;
      await server()
        .post(`/api/v1/inventory/purchases/${raceId}/receive`)
        .set(auth(officeToken))
        .send({})
        .expect(201);

      const before = dataOf<{ balance: number }>(
        await server()
          .get(`/api/v1/inventory/items/${penId}`)
          .set(auth(officeToken))
          .expect(200),
      ).balance;

      const issue = (n: number) =>
        server()
          .post('/api/v1/inventory/issues')
          .set(auth(officeToken))
          .send({
            issueDate: day(0),
            issuedTo: { type: 'ROOM', room: `Race ${n}` },
            purpose: `${NAME} race`,
            lines: [{ itemId: penId, qty: 10 }],
          });

      const results = await Promise.all([issue(1), issue(2), issue(3)]);
      const accepted = results.filter((r) => r.status === 201).length;
      expect(accepted).toBeGreaterThan(0);

      const after = dataOf<{ balance: number }>(
        await server()
          .get(`/api/v1/inventory/items/${penId}`)
          .set(auth(officeToken))
          .expect(200),
      ).balance;
      expect(after).toBe(before - accepted * 10);
    });

    it('the stored running balance agrees with a replay of the movements', async () => {
      const res = await server()
        .get(`/api/v1/inventory/reports/ledger/${penId}`)
        .set(auth(adminToken))
        .expect(200);

      const report = dataOf<{
        balance: number;
        replayed: number;
        rows: Array<{ balanceAfter: number; qtyIn: number; qtyOut: number }>;
      }>(res);

      // The second opinion. A disagreement means a writer skipped the
      // lock, which is worth failing loudly over.
      expect(report.replayed).toBe(report.balance);

      let running = 0;
      for (const row of report.rows) {
        running = Math.round((running + row.qtyIn - row.qtyOut) * 1000) / 1000;
        expect(row.balanceAfter).toBe(running);
      }
    });
  });

  // ── 9. reports ──────────────────────────────────────────────────────

  describe('reports', () => {
    it('values stock at the last price paid, and names the method', async () => {
      const res = await server()
        .get('/api/v1/inventory/reports/stock')
        .set(auth(adminToken))
        .expect(200);

      const report = dataOf<{
        rows: Array<{ itemId: string; balance: number; value: number | null }>;
        totalValue: number;
        valuationMethod: string;
        valuationNote: string;
      }>(res);

      expect(report.valuationMethod).toBe('LAST_PRICE');
      expect(report.valuationNote).toMatch(/last unit price/);

      const pen = report.rows.find((row) => row.itemId === penId)!;
      expect(pen.value).toBe(Math.round(pen.balance * 20 * 100) / 100);
    });

    it('lists items at or below their reorder level', async () => {
      const res = await server()
        .get('/api/v1/inventory/reports/low-stock')
        .set(auth(adminToken))
        .expect(200);
      const rows = dataOf<{ rows: Array<{ itemId: string }> }>(res).rows;
      // Paper was adjusted down to 0 against a reorder level of 10.
      expect(rows.some((row) => row.itemId === paperId)).toBe(true);
    });

    it('counts only RECEIVED purchases as spending', async () => {
      const draft = await server()
        .post('/api/v1/inventory/purchases')
        .set(auth(officeToken))
        .send({
          date: day(0),
          invoiceRef: `${NAME}-INV-DRAFT`,
          lines: [{ itemId: paperId, qty: 100, unitPrice: 1000 }],
        })
        .expect(201);

      const res = await server()
        .get('/api/v1/inventory/reports/purchases')
        .set(auth(adminToken))
        .expect(200);

      const report = dataOf<{
        purchaseList: Array<{ id: string }>;
        total: number;
      }>(res);
      expect(
        report.purchaseList.some(
          (row) => row.id === dataOf<{ id: string }>(draft).id,
        ),
      ).toBe(false);
    });

    it('reports consumption **net of returns**', async () => {
      const res = await server()
        .get('/api/v1/inventory/reports/consumption')
        .set(auth(adminToken))
        .expect(200);

      const groups = dataOf<{
        groups: Array<{ holder: string; quantity: number }>;
      }>(res).groups;

      // The Science department took 12 pens and 1 ream and sent all of
      // them back, so it consumed nothing and must not appear.
      expect(groups.some((g) => g.holder === `${NAME} Science`)).toBe(false);
      // The rooms that kept what they took do appear.
      expect(groups.some((g) => g.holder.startsWith('Race'))).toBe(true);
    });

    it('lists warranties that need attention, including the ones never recorded', async () => {
      const res = await server()
        .get('/api/v1/inventory/reports/warranty?days=3650')
        .set(auth(adminToken))
        .expect(200);
      const rows = dataOf<{ rows: Array<{ state: string }> }>(res).rows;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.state !== 'ACTIVE')).toBe(true);
    });

    it('exports the stock sheet', async () => {
      const res = await server()
        .get('/api/v1/inventory/reports/stock/export')
        .set(auth(adminToken))
        .buffer(true)
        .expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      // A real workbook, not an empty stream. `PK` is the zip magic every
      // XLSX starts with — the M22 zip-writer lesson, read from the far end.
      expect(Number(res.headers['content-length'])).toBeGreaterThan(1000);
    });

    it('exports the asset register as a PDF somebody can carry', async () => {
      const res = await server()
        .get('/api/v1/inventory/reports/assets/export/pdf')
        .set(auth(adminToken))
        .buffer(true)
        .responseType('blob')
        .expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      // `%PDF` is the magic every PDF starts with — a 200 with an empty
      // stream would otherwise pass this test happily.
      const pdf = res.body as Buffer;
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    });
  });

  // ── 10. separation of duties ────────────────────────────────────────

  describe('separation of duties', () => {
    it('the office runs the store', async () => {
      await server()
        .get('/api/v1/inventory/items')
        .set(auth(officeToken))
        .expect(200);
      await server()
        .get('/api/v1/inventory/purchases')
        .set(auth(officeToken))
        .expect(200);
    });

    it('the office may NOT correct a count', async () => {
      await server()
        .post('/api/v1/inventory/adjustments')
        .set(auth(officeToken))
        .send({
          lines: [{ itemId: penId, countedQty: 999 }],
          reason: 'Trying it on',
        })
        .expect(403);
    });

    it('the accountant reads the reports but does not run the store', async () => {
      await server()
        .get('/api/v1/inventory/reports/stock')
        .set(auth(accountantToken))
        .expect(200);

      await server()
        .post('/api/v1/inventory/issues')
        .set(auth(accountantToken))
        .send({
          issueDate: day(0),
          issuedTo: { type: 'ROOM', room: 'Nope' },
          lines: [{ itemId: penId, qty: 1 }],
        })
        .expect(403);

      await server()
        .post('/api/v1/inventory/items')
        .set(auth(accountantToken))
        .send({ code: `${NAME}-X`, name: 'X', type: 'CONSUMABLE' })
        .expect(403);
    });

    it('an unauthenticated caller gets nothing', async () => {
      await server().get('/api/v1/inventory/items').expect(401);
    });
  });

  // ── 11. the alert job ───────────────────────────────────────────────

  describe('the low-stock sweep', () => {
    it('tells the office what is running out', async () => {
      const job = app.get(InventoryAlertsJob);
      const result = await job.runForSchool(
        DEFAULT_SCHOOL_ID,
        new Date(),
        true,
      );
      expect(result.lowStock).toBeGreaterThan(0);

      const sent = await prisma.notification.findMany({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          templateCode: 'INVENTORY_LOW_STOCK',
        },
      });
      expect(sent.length).toBeGreaterThan(0);
      // One message naming the worst few, not one per item.
      expect(sent[0].bodyRendered).toMatch(new RegExp(NAME));
    });

    it('does nothing on a day that is not the configured weekday', async () => {
      await prisma.notification.deleteMany({
        where: {
          schoolId: DEFAULT_SCHOOL_ID,
          templateCode: 'INVENTORY_LOW_STOCK',
        },
      });
      const job = app.get(InventoryAlertsJob);
      // A Wednesday, against the default Saturday.
      const wednesday = new Date('2026-08-05T06:00:00.000Z');
      const result = await job.runForSchool(DEFAULT_SCHOOL_ID, wednesday);
      expect(result.lowStock).toBe(0);
    });
  });
});
