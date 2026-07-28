import { VoucherSource, VoucherType } from '@prisma/client';
import { AutoPostingService } from './auto-posting.service';
import type { AutoVoucherInput } from './voucher.service';

/**
 * The M16 → M20 bridge. The engines already prove the arithmetic; what is
 * left to test here is the wiring nobody else covers — which account the
 * money lands in, what the voucher is keyed on, and what happens when the
 * chart of accounts is not ready.
 */
describe('AutoPostingService', () => {
  const SCHOOL = 'school-1';

  let vouchers: { postAuto: jest.Mock };
  let map: { resolve: jest.Mock; slot: jest.Mock };
  let settings: { load: jest.Mock };
  let prisma: {
    payment: { findFirst: jest.Mock };
    voucher: { findFirst: jest.Mock };
  };
  let service: AutoPostingService;

  const SLOTS: Record<string, string> = {
    FEE_INCOME_DEFAULT: 'acc-fee-income',
    LATE_FINE_INCOME: 'acc-fine-income',
    CASH_DEFAULT: 'acc-cash',
    GATEWAY_CHARGES: 'acc-charges',
    OPENING_EQUITY: 'acc-capital',
  };

  const payment = (overrides: Record<string, unknown> = {}) => ({
    id: 'pay-1',
    paymentNo: 'CV-26-00001',
    amount: 3000,
    method: 'CASH',
    paidAt: new Date('2026-07-10T00:00:00Z'),
    createdAt: new Date('2026-07-10T00:00:00Z'),
    invoice: {
      invoiceNo: 'INV-2607-000001',
      fineTotal: 0,
      items: [
        {
          feeHeadId: 'head-tuition',
          description: 'Tuition',
          amount: 2000,
          discount: 0,
        },
        {
          feeHeadId: 'head-transport',
          description: 'Transport',
          amount: 1000,
          discount: 0,
        },
      ],
      enrollment: {
        student: {
          studentUid: 'S-2601',
          firstName: 'Ayesha',
          lastName: 'Rahman',
        },
      },
    },
    ...overrides,
  });

  beforeEach(() => {
    vouchers = {
      postAuto: jest
        .fn()
        .mockImplementation((input: AutoVoucherInput) =>
          Promise.resolve({ id: 'v-1', voucherNo: 'CV-26-00001', ...input }),
        ),
    };
    map = {
      resolve: jest.fn().mockResolvedValue({
        heads: new Map([['head-tuition', 'acc-tuition-income']]),
        methods: new Map([['BKASH', 'acc-bkash-clearing']]),
        system: new Map(Object.entries(SLOTS)),
      }),
      slot: jest.fn((_resolved: unknown, name: string) => SLOTS[name] ?? null),
    };
    settings = {
      load: jest.fn().mockResolvedValue({ enabled: true, autoPostFees: true }),
    };
    prisma = {
      payment: { findFirst: jest.fn().mockResolvedValue(payment()) },
      voucher: { findFirst: jest.fn() },
    };
    service = new AutoPostingService(
      vouchers as never,
      map as never,
      settings as never,
      prisma as never,
    );
  });

  const lastInput = (): AutoVoucherInput => {
    const calls = vouchers.postAuto.mock.calls as AutoVoucherInput[][];
    return calls[calls.length - 1][0];
  };

  // ── payment ─────────────────────────────────────────────────────────

  it('debits the funds account and credits income per mapped head', async () => {
    await service.postPayment(SCHOOL, 'pay-1');
    const input = lastInput();

    expect(input.type).toBe(VoucherType.CREDIT);
    expect(input.source).toBe(VoucherSource.FEES);
    expect(input.entries).toEqual([
      { accountId: 'acc-cash', debit: 3000, credit: 0 },
      {
        accountId: 'acc-tuition-income',
        debit: 0,
        credit: 2000,
        narration: 'Tuition',
      },
      // Transport has no mapping of its own, so it falls back.
      {
        accountId: 'acc-fee-income',
        debit: 0,
        credit: 1000,
        narration: 'Transport',
      },
    ]);
  });

  it('keys the voucher on the payment id so a replay cannot double-post', async () => {
    await service.postPayment(SCHOOL, 'pay-1');
    expect(lastInput().sourceRef).toBe('payment:pay-1');
  });

  it('routes a gateway payment to its clearing account, not straight to cash', async () => {
    prisma.payment.findFirst.mockResolvedValue(payment({ method: 'BKASH' }));
    await service.postPayment(SCHOOL, 'pay-1');
    expect(lastInput().entries[0].accountId).toBe('acc-bkash-clearing');
  });

  it('credits the fine portion to fine income, not tuition', async () => {
    prisma.payment.findFirst.mockResolvedValue(
      payment({
        amount: 3100,
        invoice: { ...payment().invoice, fineTotal: 100 },
      }),
    );
    await service.postPayment(SCHOOL, 'pay-1');
    const fine = lastInput().entries.find(
      (entry) => entry.accountId === 'acc-fine-income',
    );
    expect(fine).toMatchObject({ credit: 100, narration: 'Late fine' });
  });

  it('names the student and the invoice in the narration', async () => {
    await service.postPayment(SCHOOL, 'pay-1');
    expect(lastInput().narration).toContain('Ayesha Rahman (S-2601)');
    expect(lastInput().narration).toContain('INV-2607-000001');
  });

  it('dates the voucher when the money was paid, not when it was posted', async () => {
    await service.postPayment(SCHOOL, 'pay-1');
    expect(lastInput().date).toEqual(new Date('2026-07-10T00:00:00Z'));
  });

  it('posts nothing when auto-posting is switched off', async () => {
    settings.load.mockResolvedValue({ enabled: true, autoPostFees: false });
    await expect(service.postPayment(SCHOOL, 'pay-1')).resolves.toBeNull();
    expect(vouchers.postAuto).not.toHaveBeenCalled();
  });

  it('reports rather than throws when no cash account is configured', async () => {
    // The payment is already recorded; a misconfigured chart of accounts
    // must never take the fee desk down with it.
    map.slot.mockImplementation((_r: unknown, name: string) =>
      name === 'CASH_DEFAULT' ? null : SLOTS[name],
    );
    await expect(service.postPayment(SCHOOL, 'pay-1')).resolves.toBeNull();
    expect(vouchers.postAuto).not.toHaveBeenCalled();
  });

  it('returns null for a payment that no longer exists', async () => {
    prisma.payment.findFirst.mockResolvedValue(null);
    await expect(service.postPayment(SCHOOL, 'missing')).resolves.toBeNull();
  });

  // ── refund ──────────────────────────────────────────────────────────

  const originalVoucher = {
    id: 'v-1',
    voucherNo: 'CV-26-00001',
    entries: [
      {
        accountId: 'acc-cash',
        debit: 3000,
        credit: 0,
        narration: null,
        displayOrder: 0,
      },
      {
        accountId: 'acc-tuition-income',
        debit: 0,
        credit: 2000,
        narration: 'Tuition',
        displayOrder: 1,
      },
      {
        accountId: 'acc-fee-income',
        debit: 0,
        credit: 1000,
        narration: 'Transport',
        displayOrder: 2,
      },
    ],
  };

  it('mirrors the original voucher for a full refund', async () => {
    prisma.voucher.findFirst.mockResolvedValue(originalVoucher);
    prisma.payment.findFirst.mockResolvedValue({
      amount: 3000,
      paymentNo: 'CV-26-00001',
    });

    await service.postRefund(SCHOOL, 'pay-1', 'ref-1', 3000);
    const input = lastInput();

    expect(input.type).toBe(VoucherType.DEBIT);
    expect(input.sourceRef).toBe('refund:ref-1');
    expect(input.entries).toEqual([
      { accountId: 'acc-cash', debit: 0, credit: 3000, narration: null },
      {
        accountId: 'acc-tuition-income',
        debit: 2000,
        credit: 0,
        narration: 'Tuition',
      },
      {
        accountId: 'acc-fee-income',
        debit: 1000,
        credit: 0,
        narration: 'Transport',
      },
    ]);
  });

  it('scales the original lines for a partial refund and still balances', async () => {
    prisma.voucher.findFirst.mockResolvedValue(originalVoucher);
    prisma.payment.findFirst.mockResolvedValue({
      amount: 3000,
      paymentNo: 'CV-26-00001',
    });

    await service.postRefund(SCHOOL, 'pay-1', 'ref-2', 1000);
    const entries = lastInput().entries;

    const debits = entries.reduce((sum, entry) => sum + entry.debit, 0);
    const credits = entries.reduce((sum, entry) => sum + entry.credit, 0);
    expect(credits).toBeCloseTo(1000, 10);
    expect(debits).toBeCloseTo(credits, 10);
  });

  it('absorbs the rounding drift of an awkward fraction on the income side', async () => {
    // A third of 1,000 across two income lines cannot divide evenly, and a
    // voucher that is out by a paisa cannot post.
    prisma.voucher.findFirst.mockResolvedValue(originalVoucher);
    prisma.payment.findFirst.mockResolvedValue({
      amount: 3000,
      paymentNo: 'CV-26-00001',
    });

    await service.postRefund(SCHOOL, 'pay-1', 'ref-3', 1000.01);
    const entries = lastInput().entries;
    const debits = entries.reduce((sum, entry) => sum + entry.debit, 0);
    const credits = entries.reduce((sum, entry) => sum + entry.credit, 0);
    expect(Math.round((debits - credits) * 100)).toBe(0);
    // The funds line matches what the bank will actually show.
    expect(
      entries.find((entry) => entry.accountId === 'acc-cash')?.credit,
    ).toBeCloseTo(1000.01, 10);
  });

  it('reports rather than throws when the payment was never posted', async () => {
    prisma.voucher.findFirst.mockResolvedValue(null);
    await expect(
      service.postRefund(SCHOOL, 'pay-1', 'ref-4', 500),
    ).resolves.toBeNull();
    expect(vouchers.postAuto).not.toHaveBeenCalled();
  });
});
