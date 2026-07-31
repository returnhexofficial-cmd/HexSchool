import {
  assessOverdue,
  dhakaDateKey,
  isFineSettled,
  outstandingFine,
  replacementCharge,
  totalCharge,
  type FinePolicy,
} from './fine.engine';

const POLICY: FinePolicy = {
  perDay: 2,
  graceDays: 0,
  maxPerBook: 500,
  holidayAware: false,
  lostMultiplier: 1.5,
  damagedMultiplier: 0.5,
  defaultBookPrice: 300,
};

/** `2026-03-10T10:00:00+06:00` — Dhaka wall clock, expressed as UTC. */
const at = (iso: string) => new Date(iso);

describe('assessOverdue', () => {
  it('charges nothing for a book returned before it was due', () => {
    const verdict = assessOverdue({
      dueAt: at('2026-03-10T10:00:00Z'),
      returnedAt: at('2026-03-08T09:00:00Z'),
      policy: POLICY,
    });
    expect(verdict).toEqual({
      daysLate: 0,
      chargeableDays: 0,
      holidayDays: 0,
      amount: 0,
      capped: false,
    });
  });

  it('charges nothing for a return on the due date itself', () => {
    const verdict = assessOverdue({
      dueAt: at('2026-03-10T10:00:00Z'),
      returnedAt: at('2026-03-10T10:00:00Z'),
      policy: POLICY,
    });
    expect(verdict.amount).toBe(0);
  });

  /**
   * The instant-not-date rule. A book due at 10:00 and handed back at
   * 09:00 the next morning was held for 23 hours past the deadline —
   * less than one extra day, so nothing is owed. Counting calendar dates
   * would charge a member for a morning they were entitled to.
   */
  it('does not charge for a partial day past the deadline', () => {
    const verdict = assessOverdue({
      dueAt: at('2026-03-10T10:00:00Z'),
      returnedAt: at('2026-03-11T09:00:00Z'),
      policy: POLICY,
    });
    expect(verdict.daysLate).toBe(0);
    expect(verdict.amount).toBe(0);
  });

  it('charges one day the moment a full day has elapsed', () => {
    const verdict = assessOverdue({
      dueAt: at('2026-03-10T10:00:00Z'),
      returnedAt: at('2026-03-11T10:00:00Z'),
      policy: POLICY,
    });
    expect(verdict.daysLate).toBe(1);
    expect(verdict.chargeableDays).toBe(1);
    expect(verdict.amount).toBe(2);
  });

  it('multiplies whole days by the daily rate', () => {
    const verdict = assessOverdue({
      dueAt: at('2026-03-01T10:00:00Z'),
      returnedAt: at('2026-03-11T10:00:00Z'),
      policy: POLICY,
    });
    expect(verdict.daysLate).toBe(10);
    expect(verdict.amount).toBe(20);
  });

  it('takes grace days off the lateness before charging', () => {
    const verdict = assessOverdue({
      dueAt: at('2026-03-01T10:00:00Z'),
      returnedAt: at('2026-03-06T10:00:00Z'),
      policy: { ...POLICY, graceDays: 3 },
    });
    expect(verdict.daysLate).toBe(5);
    expect(verdict.chargeableDays).toBe(2);
    expect(verdict.amount).toBe(4);
  });

  it('charges nothing when the lateness is entirely inside grace', () => {
    const verdict = assessOverdue({
      dueAt: at('2026-03-01T10:00:00Z'),
      returnedAt: at('2026-03-03T10:00:00Z'),
      policy: { ...POLICY, graceDays: 3 },
    });
    expect(verdict.daysLate).toBe(2);
    expect(verdict.chargeableDays).toBe(0);
    expect(verdict.amount).toBe(0);
  });

  it('caps at max_per_book and says so', () => {
    const verdict = assessOverdue({
      dueAt: at('2026-01-01T10:00:00Z'),
      returnedAt: at('2026-12-01T10:00:00Z'),
      policy: POLICY,
    });
    expect(verdict.daysLate).toBe(334);
    expect(verdict.amount).toBe(500);
    expect(verdict.capped).toBe(true);
  });

  it('leaves the fine uncapped when max_per_book is 0', () => {
    const verdict = assessOverdue({
      dueAt: at('2026-01-01T10:00:00Z'),
      returnedAt: at('2026-03-02T10:00:00Z'),
      policy: { ...POLICY, maxPerBook: 0 },
    });
    expect(verdict.chargeableDays).toBe(60);
    expect(verdict.amount).toBe(120);
    expect(verdict.capped).toBe(false);
  });

  it('charges nothing when the daily rate is zero', () => {
    const verdict = assessOverdue({
      dueAt: at('2026-03-01T10:00:00Z'),
      returnedAt: at('2026-03-20T10:00:00Z'),
      policy: { ...POLICY, perDay: 0 },
    });
    expect(verdict.amount).toBe(0);
    expect(verdict.chargeableDays).toBe(0);
  });

  describe('holiday awareness', () => {
    // Book due Sunday 2026-03-01 10:00. Late through 2026-03-11.
    const holidays = new Set(['2026-03-06', '2026-03-07', '2026-03-08']);

    it('ignores the holiday set when the option is off', () => {
      const verdict = assessOverdue({
        dueAt: at('2026-03-01T04:00:00Z'),
        returnedAt: at('2026-03-11T04:00:00Z'),
        policy: POLICY,
        holidays,
      });
      expect(verdict.holidayDays).toBe(0);
      expect(verdict.amount).toBe(20);
    });

    it('drops closed days from the charge when it is on', () => {
      const verdict = assessOverdue({
        dueAt: at('2026-03-01T04:00:00Z'),
        returnedAt: at('2026-03-11T04:00:00Z'),
        policy: { ...POLICY, holidayAware: true },
        holidays,
      });
      expect(verdict.daysLate).toBe(10);
      expect(verdict.holidayDays).toBe(3);
      expect(verdict.chargeableDays).toBe(7);
      expect(verdict.amount).toBe(14);
    });

    /**
     * Grace is spent first, so a holiday inside the grace window is not
     * "used up" as a holiday — it was never going to be charged for.
     * Getting this backwards would let a school's three grace days and
     * three closed days cancel each other out and charge full price.
     */
    it('counts holidays only in the window grace did not already cover', () => {
      const verdict = assessOverdue({
        dueAt: at('2026-03-01T04:00:00Z'),
        returnedAt: at('2026-03-11T04:00:00Z'),
        // Grace absorbs the first five late days, so the chargeable
        // dates are 2026-03-07 → 2026-03-11 and only two of the three
        // holidays fall inside them.
        policy: { ...POLICY, holidayAware: true, graceDays: 5 },
        holidays,
      });
      expect(verdict.daysLate).toBe(10);
      expect(verdict.chargeableDays).toBe(3);
      expect(verdict.holidayDays).toBe(2);
      expect(verdict.amount).toBe(6);
    });

    it('charges nothing when every chargeable day was a holiday', () => {
      const verdict = assessOverdue({
        dueAt: at('2026-03-05T04:00:00Z'),
        returnedAt: at('2026-03-08T04:00:00Z'),
        policy: { ...POLICY, holidayAware: true },
        holidays,
      });
      expect(verdict.daysLate).toBe(3);
      expect(verdict.holidayDays).toBe(3);
      expect(verdict.amount).toBe(0);
    });
  });
});

describe('dhakaDateKey', () => {
  /**
   * Dhaka is UTC+6, so an instant late on a UTC day is already the next
   * day locally. A holiday set keyed on the wrong day would forgive the
   * wrong date — and would do it only for evening returns, which is the
   * kind of bug that survives a year of use.
   */
  it('reads an instant in Asia/Dhaka, not UTC', () => {
    expect(dhakaDateKey(new Date('2026-03-10T20:00:00Z'))).toBe('2026-03-11');
    expect(dhakaDateKey(new Date('2026-03-10T17:59:00Z'))).toBe('2026-03-10');
  });
});

describe('replacementCharge', () => {
  it('applies the lost multiplier to the recorded price', () => {
    expect(replacementCharge(400, POLICY, 'LOST')).toBe(600);
  });

  it('applies the damaged multiplier', () => {
    expect(replacementCharge(400, POLICY, 'DAMAGED')).toBe(200);
  });

  it('falls back to the default price when the title has none', () => {
    expect(replacementCharge(null, POLICY, 'LOST')).toBe(450);
    expect(replacementCharge(undefined, POLICY, 'LOST')).toBe(450);
    expect(replacementCharge(0, POLICY, 'LOST')).toBe(450);
  });

  it('never returns a negative charge from a negative multiplier', () => {
    expect(
      replacementCharge(400, { ...POLICY, lostMultiplier: -2 }, 'LOST'),
    ).toBe(0);
  });
});

describe('totalCharge', () => {
  it('sums an overdue and a replacement and reports the graver reason', () => {
    expect(totalCharge(20, 600)).toEqual({ amount: 620, reason: 'LOST' });
  });

  it('reports OVERDUE when only lateness is owed', () => {
    expect(totalCharge(20, 0)).toEqual({ amount: 20, reason: 'OVERDUE' });
  });

  it('reports NONE for a clean return', () => {
    expect(totalCharge(0, 0)).toEqual({ amount: 0, reason: 'NONE' });
  });
});

describe('outstandingFine / isFineSettled', () => {
  it('nets collections and waivers off the assessment', () => {
    expect(
      outstandingFine({ fineAmount: 100, fineCollected: 30, fineWaived: 20 }),
    ).toBe(50);
  });

  it('never goes negative', () => {
    expect(
      outstandingFine({ fineAmount: 100, fineCollected: 80, fineWaived: 40 }),
    ).toBe(0);
  });

  /**
   * The same predicate `chk_book_issues_fine_paid` enforces. If these
   * ever diverge the database refuses the write, which is the point of
   * having both — but the engine is what the UI reads, so it has to be
   * the same comparison, including at the boundary.
   */
  it('settles exactly at the boundary', () => {
    expect(
      isFineSettled({ fineAmount: 100, fineCollected: 60, fineWaived: 40 }),
    ).toBe(true);
    expect(
      isFineSettled({ fineAmount: 100, fineCollected: 60, fineWaived: 39.99 }),
    ).toBe(false);
  });

  it('treats a zero fine as settled', () => {
    expect(
      isFineSettled({ fineAmount: 0, fineCollected: 0, fineWaived: 0 }),
    ).toBe(true);
  });
});
