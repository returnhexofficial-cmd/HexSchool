import { InvoiceStatus } from '../../../common/constants';
import {
  agingBucket,
  assessFine,
  daysBetween,
  deriveStatus,
  FineConfig,
  FineInput,
} from './fine.engine';

const config = (over: Partial<FineConfig> = {}): FineConfig => ({
  graceDays: 5,
  flatPerMonth: 0,
  percentPerMonth: 0,
  cap: 0,
  ...over,
});

const input = (over: Partial<FineInput> = {}): FineInput => ({
  payable: 1000,
  fineSoFar: 0,
  dueDate: '2026-07-10',
  today: '2026-07-20',
  finedForMonth: null,
  currentMonth: '2026-07-01',
  ...over,
});

describe('fine engine', () => {
  it('counts whole days across a month boundary', () => {
    expect(daysBetween('2026-07-10', '2026-07-20')).toBe(10);
    expect(daysBetween('2026-07-28', '2026-08-03')).toBe(6);
    expect(daysBetween('2026-07-20', '2026-07-10')).toBe(-10);
  });

  describe('assessFine', () => {
    it('does nothing when no fine is configured', () => {
      expect(assessFine(input(), config())).toEqual({
        charge: 0,
        reason: 'NOT_CONFIGURED',
      });
    });

    it('does nothing before the due date', () => {
      const verdict = assessFine(
        input({ today: '2026-07-05' }),
        config({ flatPerMonth: 100 }),
      );
      expect(verdict.reason).toBe('NOT_OVERDUE');
    });

    it('respects the grace period', () => {
      const verdict = assessFine(
        input({ today: '2026-07-14' }), // 4 days late, grace is 5
        config({ flatPerMonth: 100 }),
      );
      expect(verdict.reason).toBe('WITHIN_GRACE');
    });

    it('charges a flat fine once past grace', () => {
      expect(assessFine(input(), config({ flatPerMonth: 100 }))).toEqual({
        charge: 100,
        reason: 'CHARGED',
      });
    });

    it('charges a percentage of the payable', () => {
      expect(
        assessFine(input(), config({ percentPerMonth: 2 })).charge,
      ).toBe(20);
    });

    it('adds flat and percentage together', () => {
      expect(
        assessFine(input(), config({ flatPerMonth: 50, percentPerMonth: 2 }))
          .charge,
      ).toBe(70);
    });

    it('is IDEMPOTENT within a month — the whole point of the nightly job', () => {
      // Without this, an invoice left unpaid for a week is fined seven
      // times.
      const verdict = assessFine(
        input({ finedForMonth: '2026-07-01' }),
        config({ flatPerMonth: 100 }),
      );
      expect(verdict).toEqual({ charge: 0, reason: 'ALREADY_FINED_THIS_MONTH' });
    });

    it('charges again the following month', () => {
      const verdict = assessFine(
        input({
          finedForMonth: '2026-07-01',
          currentMonth: '2026-08-01',
          today: '2026-08-02',
        }),
        config({ flatPerMonth: 100 }),
      );
      expect(verdict).toEqual({ charge: 100, reason: 'CHARGED' });
    });

    it('stops at the cap', () => {
      const verdict = assessFine(
        input({ fineSoFar: 500 }),
        config({ flatPerMonth: 100, cap: 500 }),
      );
      expect(verdict).toEqual({ charge: 0, reason: 'CAP_REACHED' });
    });

    it('charges only the headroom when the cap is close', () => {
      const verdict = assessFine(
        input({ fineSoFar: 450 }),
        config({ flatPerMonth: 100, cap: 500 }),
      );
      expect(verdict).toEqual({ charge: 50, reason: 'CHARGED' });
    });
  });

  describe('deriveStatus', () => {
    const base = {
      payable: 1000,
      paidTotal: 0,
      dueDate: '2026-07-10',
      today: '2026-07-05',
      cancelled: false,
      fullyRefunded: false,
    };

    it('is UNPAID before the due date with nothing paid', () => {
      expect(deriveStatus(base)).toBe(InvoiceStatus.UNPAID);
    });

    it('is PARTIAL once some money lands', () => {
      expect(deriveStatus({ ...base, paidTotal: 400 })).toBe(
        InvoiceStatus.PARTIAL,
      );
    });

    it('is PAID when settled in full', () => {
      expect(deriveStatus({ ...base, paidTotal: 1000 })).toBe(
        InvoiceStatus.PAID,
      );
    });

    it('is OVERDUE past the due date', () => {
      expect(deriveStatus({ ...base, today: '2026-07-20' })).toBe(
        InvoiceStatus.OVERDUE,
      );
    });

    it('prefers PAID over OVERDUE — settled late is still settled', () => {
      expect(
        deriveStatus({ ...base, today: '2026-07-20', paidTotal: 1000 }),
      ).toBe(InvoiceStatus.PAID);
    });

    it('treats a fully waived invoice as settled', () => {
      expect(deriveStatus({ ...base, payable: 0 })).toBe(InvoiceStatus.PAID);
    });

    it('lets administrative states outrank computed ones', () => {
      expect(
        deriveStatus({ ...base, paidTotal: 1000, cancelled: true }),
      ).toBe(InvoiceStatus.CANCELLED);
      expect(
        deriveStatus({ ...base, paidTotal: 1000, fullyRefunded: true }),
      ).toBe(InvoiceStatus.REFUNDED);
    });
  });

  describe('agingBucket', () => {
    it.each([
      ['2026-07-20', 'CURRENT'],
      ['2026-07-09', '0-30'],
      ['2026-06-01', '31-60'],
      ['2026-05-01', '61-90'],
      ['2026-01-01', '90+'],
    ])('due %s → %s', (dueDate, bucket) => {
      expect(agingBucket(dueDate, '2026-07-10')).toBe(bucket);
    });
  });
});
