import {
  allocatePayment,
  outstanding,
  PayableInvoice,
  refundRefusal,
  refundRefusalMessage,
} from './payment.engine';

const invoice = (over: Partial<PayableInvoice> = {}): PayableInvoice => ({
  invoiceId: 'inv-1',
  invoiceNo: 'INV-2607-000001',
  dueDate: '2026-07-10',
  payable: 1000,
  paidTotal: 0,
  ...over,
});

describe('payment engine', () => {
  it('computes what is left on an invoice', () => {
    expect(outstanding(invoice({ paidTotal: 400 }))).toBe(600);
    expect(outstanding(invoice({ paidTotal: 1000 }))).toBe(0);
    // A refund could in principle overshoot; never report negative dues.
    expect(outstanding(invoice({ paidTotal: 1200 }))).toBe(0);
  });

  describe('allocatePayment', () => {
    it('settles a single invoice exactly', () => {
      const result = allocatePayment(1000, [invoice()]);
      expect(result.allocations).toEqual([
        {
          invoiceId: 'inv-1',
          invoiceNo: 'INV-2607-000001',
          amount: 1000,
          remaining: 0,
        },
      ]);
      expect(result.unallocated).toBe(0);
    });

    it('pays the OLDEST due date first', () => {
      // The invoice that has been outstanding longest is the one still
      // accruing a fine — settle it first.
      const result = allocatePayment(1000, [
        invoice({ invoiceId: 'new', invoiceNo: 'INV-B', dueDate: '2026-07-10' }),
        invoice({ invoiceId: 'old', invoiceNo: 'INV-A', dueDate: '2026-05-10' }),
      ]);

      expect(result.allocations[0].invoiceId).toBe('old');
      expect(result.allocations).toHaveLength(1);
    });

    it('spreads across several invoices', () => {
      const result = allocatePayment(1500, [
        invoice({ invoiceId: 'a', invoiceNo: 'INV-A', dueDate: '2026-05-10' }),
        invoice({ invoiceId: 'b', invoiceNo: 'INV-B', dueDate: '2026-06-10' }),
      ]);

      expect(result.allocations).toEqual([
        expect.objectContaining({ invoiceId: 'a', amount: 1000, remaining: 0 }),
        expect.objectContaining({ invoiceId: 'b', amount: 500, remaining: 500 }),
      ]);
      expect(result.totalAllocated).toBe(1500);
    });

    it('reports money it could not place instead of over-allocating', () => {
      // Overpayment is a deliberate, permission-gated act elsewhere —
      // never something that happens because someone rounded up.
      const result = allocatePayment(1500, [invoice()]);
      expect(result.totalAllocated).toBe(1000);
      expect(result.unallocated).toBe(500);
    });

    it('skips invoices already settled', () => {
      const result = allocatePayment(500, [
        invoice({ invoiceId: 'paid', invoiceNo: 'INV-A', dueDate: '2026-05-10', paidTotal: 1000 }),
        invoice({ invoiceId: 'due', invoiceNo: 'INV-B', dueDate: '2026-06-10' }),
      ]);

      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0].invoiceId).toBe('due');
    });

    it('accounts for money already paid on a partially settled invoice', () => {
      const result = allocatePayment(600, [invoice({ paidTotal: 400 })]);
      expect(result.allocations[0].amount).toBe(600);
      expect(result.allocations[0].remaining).toBe(0);
    });

    it('breaks ties on due date by invoice number, deterministically', () => {
      const result = allocatePayment(2000, [
        invoice({ invoiceId: 'b', invoiceNo: 'INV-B' }),
        invoice({ invoiceId: 'a', invoiceNo: 'INV-A' }),
      ]);
      expect(result.allocations.map((a) => a.invoiceId)).toEqual(['a', 'b']);
    });

    it('allocates nothing when there is nothing to pay', () => {
      expect(allocatePayment(500, []).unallocated).toBe(500);
    });
  });

  describe('refundRefusal', () => {
    const base = {
      paymentAmount: 1000,
      refundedSoFar: 0,
      requested: 500,
      isRefundable: true,
    };

    it('allows a partial refund', () => {
      expect(refundRefusal(base)).toBeNull();
    });

    it('allows the exact remaining balance', () => {
      expect(refundRefusal({ ...base, refundedSoFar: 500, requested: 500 })).toBeNull();
    });

    it('refuses a non-refundable head', () => {
      expect(refundRefusal({ ...base, isRefundable: false })).toBe('NOT_REFUNDABLE');
    });

    it('refuses more than what is left', () => {
      expect(refundRefusal({ ...base, refundedSoFar: 800, requested: 300 })).toBe(
        'EXCEEDS_PAYMENT',
      );
    });

    it('refuses a zero or negative refund', () => {
      expect(refundRefusal({ ...base, requested: 0 })).toBe('NON_POSITIVE');
    });

    it('explains the refusal with the available balance', () => {
      const message = refundRefusalMessage('EXCEEDS_PAYMENT', {
        ...base,
        refundedSoFar: 800,
        requested: 300,
      });
      expect(message).toMatch(/200 available/);
    });
  });
});
