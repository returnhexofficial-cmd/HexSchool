import { FeeOverrideType } from '../../../common/constants';
import {
  BillableHead,
  buildInvoice,
  Concession,
  discountFor,
  prorationFactor,
} from './invoice.engine';

const head = (over: Partial<BillableHead> = {}): BillableHead => ({
  feeHeadId: 'fh-tuition',
  feeHeadName: 'Tuition',
  amount: 1000,
  prorated: true,
  ...over,
});

const concession = (over: Partial<Concession> = {}): Concession => ({
  feeHeadId: 'fh-tuition',
  type: FeeOverrideType.DISCOUNT_PERCENT,
  value: 10,
  reason: 'Sibling discount',
  ...over,
});

describe('invoice engine', () => {
  describe('prorationFactor', () => {
    it('bills a full month for anyone present from the 1st', () => {
      expect(
        prorationFactor({
          daysInMonth: 31,
          billableFromDay: 1,
          includeJoinDay: true,
        }),
      ).toBe(1);
    });

    it('bills 12/31 for a student joining on the 20th', () => {
      const factor = prorationFactor({
        daysInMonth: 31,
        billableFromDay: 20,
        includeJoinDay: true,
      });
      expect(factor).toBeCloseTo(12 / 31, 10);
    });

    it('excludes the joining day when the school says so', () => {
      const factor = prorationFactor({
        daysInMonth: 31,
        billableFromDay: 20,
        includeJoinDay: false,
      });
      expect(factor).toBeCloseTo(11 / 31, 10);
    });

    it('bills nothing for someone joining after the month ended', () => {
      expect(
        prorationFactor({
          daysInMonth: 30,
          billableFromDay: 31,
          includeJoinDay: true,
        }),
      ).toBe(0);
    });

    it('handles February without a special case', () => {
      expect(
        prorationFactor({
          daysInMonth: 28,
          billableFromDay: 15,
          includeJoinDay: true,
        }),
      ).toBeCloseTo(14 / 28, 10);
    });
  });

  describe('discountFor', () => {
    it('applies a percentage', () => {
      expect(discountFor(1000, [concession({ value: 10 })]).discount).toBe(100);
    });

    it('applies a flat amount', () => {
      expect(
        discountFor(1000, [
          concession({ type: FeeOverrideType.DISCOUNT_FLAT, value: 250 }),
        ]).discount,
      ).toBe(250);
    });

    it('stacks percent FIRST, then flat', () => {
      // 10% of 1000 = 100, plus 100 flat = 200.  Applying flat first
      // would give 190 — two students with the same concessions must
      // never be billed differently because of ordering.
      const { discount } = discountFor(1000, [
        concession({ value: 10 }),
        concession({ type: FeeOverrideType.DISCOUNT_FLAT, value: 100 }),
      ]);
      expect(discount).toBe(200);
    });

    it('treats a scholarship as a flat reduction', () => {
      expect(
        discountFor(1000, [
          concession({ type: FeeOverrideType.SCHOLARSHIP, value: 400 }),
        ]).discount,
      ).toBe(400);
    });

    it('lets a waiver win outright over everything else', () => {
      const { discount, note } = discountFor(1000, [
        concession({ value: 10 }),
        concession({ type: FeeOverrideType.WAIVER, value: 0, reason: 'Staff child' }),
      ]);
      expect(discount).toBe(1000);
      expect(note).toMatch(/Waived — Staff child/);
    });

    it('never discounts more than the line', () => {
      const { discount } = discountFor(1000, [
        concession({ type: FeeOverrideType.DISCOUNT_FLAT, value: 5000 }),
      ]);
      expect(discount).toBe(1000);
    });

    it('caps a runaway percentage at 100', () => {
      const { discount } = discountFor(1000, [
        concession({ value: 80 }),
        concession({ value: 50 }),
      ]);
      expect(discount).toBe(1000);
    });

    it('is inert with no concessions', () => {
      expect(discountFor(1000, [])).toEqual({ discount: 0, note: null });
    });

    it('names the concessions on the line', () => {
      const { note } = discountFor(1000, [
        concession({ value: 10, reason: 'Sibling discount' }),
      ]);
      expect(note).toMatch(/10%/);
      expect(note).toMatch(/Sibling discount/);
    });
  });

  describe('buildInvoice', () => {
    it('bills every head and totals them', () => {
      const invoice = buildInvoice(
        [
          head({ feeHeadId: 'fh-1', feeHeadName: 'Tuition', amount: 1500 }),
          head({ feeHeadId: 'fh-2', feeHeadName: 'Transport', amount: 500 }),
        ],
        [],
      );

      expect(invoice.subtotal).toBe(2000);
      expect(invoice.discountTotal).toBe(0);
      expect(invoice.payable).toBe(2000);
      expect(invoice.lines).toHaveLength(2);
    });

    it('applies concessions per head, not across the invoice', () => {
      const invoice = buildInvoice(
        [
          head({ feeHeadId: 'fh-1', amount: 1000 }),
          head({ feeHeadId: 'fh-2', amount: 1000 }),
        ],
        [concession({ feeHeadId: 'fh-1', value: 50 })],
      );

      expect(invoice.discountTotal).toBe(500);
      expect(invoice.payable).toBe(1500);
      expect(invoice.lines[1].discount).toBe(0);
    });

    it('prorates only the heads that recur', () => {
      // A one-off admission fee is not halved because the student
      // joined mid-month.
      const invoice = buildInvoice(
        [
          head({ feeHeadId: 'fh-1', feeHeadName: 'Tuition', amount: 1000, prorated: true }),
          head({ feeHeadId: 'fh-2', feeHeadName: 'Admission', amount: 5000, prorated: false }),
        ],
        [],
        0.5,
      );

      expect(invoice.lines[0].amount).toBe(500);
      expect(invoice.lines[1].amount).toBe(5000);
      expect(invoice.subtotal).toBe(5500);
    });

    it('notes the proration on the line', () => {
      const invoice = buildInvoice([head({ amount: 1000 })], [], 0.5);
      expect(invoice.lines[0].note).toMatch(/Prorated 50%/);
    });

    it('drops a line prorated away to nothing rather than billing zero', () => {
      const invoice = buildInvoice([head({ amount: 1000 })], [], 0);
      expect(invoice.lines).toHaveLength(0);
      expect(invoice.payable).toBe(0);
    });

    it('combines proration and a concession in the right order', () => {
      // Prorate to 500 first, THEN take 10% of the prorated line = 50.
      // Discounting the full 1000 would over-credit the student.
      const invoice = buildInvoice(
        [head({ amount: 1000 })],
        [concession({ value: 10 })],
        0.5,
      );

      expect(invoice.lines[0].amount).toBe(500);
      expect(invoice.lines[0].discount).toBe(50);
      expect(invoice.payable).toBe(450);
    });

    it('produces a fully waived invoice payable of zero', () => {
      const invoice = buildInvoice(
        [head({ amount: 1000 })],
        [concession({ type: FeeOverrideType.WAIVER, value: 0, reason: 'Orphan' })],
      );
      expect(invoice.payable).toBe(0);
      expect(invoice.subtotal).toBe(1000);
    });

    it('keeps subtotal - discount = payable to the paisa', () => {
      // The identity chk_invoices_payable enforces in the database.
      const invoice = buildInvoice(
        [
          head({ feeHeadId: 'a', amount: 1234.56 }),
          head({ feeHeadId: 'b', amount: 789.01 }),
          head({ feeHeadId: 'c', amount: 45.67 }),
        ],
        [
          concession({ feeHeadId: 'a', value: 12.5 }),
          concession({ feeHeadId: 'b', type: FeeOverrideType.DISCOUNT_FLAT, value: 33.33 }),
        ],
        0.6774193548387096, // 21/31 — a genuinely awkward factor
      );

      expect(invoice.payable).toBe(
        Math.round((invoice.subtotal - invoice.discountTotal) * 100) / 100,
      );
    });
  });
});
