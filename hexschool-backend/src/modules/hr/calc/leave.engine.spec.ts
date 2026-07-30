import {
  allocationFor,
  availableDays,
  carryForwardDays,
  halfDays,
  leaveDays,
  monthSpan,
  overlappingRanges,
  quotaVerdict,
  remainingDays,
  splitLeaveDays,
} from './leave.engine';

describe('leave.engine', () => {
  describe('leaveDays', () => {
    it('counts working days, not calendar days', () => {
      // Thu 2027-03-04 → Mon 2027-03-08; Friday is the weekly holiday, so
      // the calendar span of 5 days costs 4 days of quota.
      expect(
        leaveDays({
          workingDays: ['2027-03-04', '2027-03-06', '2027-03-07', '2027-03-08'],
          halfDay: false,
        }),
      ).toBe(4);
    });

    it('is 0.5 for a half day', () => {
      expect(leaveDays({ workingDays: ['2027-03-04'], halfDay: true })).toBe(
        0.5,
      );
    });

    it('is zero when the whole range is holidays', () => {
      expect(leaveDays({ workingDays: [], halfDay: false })).toBe(0);
      expect(leaveDays({ workingDays: [], halfDay: true })).toBe(0);
    });
  });

  describe('balances', () => {
    const balance = { allocated: 10, used: 3.5, carried: 2 };

    it('available = allocated + carried − used', () => {
      expect(availableDays(balance)).toBe(8.5);
    });

    it('floors what an employee is shown at zero', () => {
      expect(availableDays({ allocated: 5, used: 8, carried: 0 })).toBe(0);
    });

    it('but reports the real overdraft to the approver', () => {
      expect(remainingDays({ allocated: 5, used: 8, carried: 0 })).toBe(-3);
    });
  });

  describe('quotaVerdict', () => {
    it('passes a request that fits', () => {
      const verdict = quotaVerdict(3, { allocated: 10, used: 2, carried: 0 });
      expect(verdict.exceeded).toBe(false);
      expect(verdict.shortfall).toBe(0);
      expect(verdict.remaining).toBe(8);
    });

    it('reports how far past the quota a request goes', () => {
      const verdict = quotaVerdict(5, { allocated: 10, used: 8, carried: 0 });
      expect(verdict.exceeded).toBe(true);
      expect(verdict.shortfall).toBe(3);
    });

    it('exactly consuming the balance is not an overdraft', () => {
      expect(
        quotaVerdict(2, { allocated: 10, used: 8, carried: 0 }).exceeded,
      ).toBe(false);
    });

    it('an unlimited (unpaid) type is never exceeded', () => {
      const verdict = quotaVerdict(
        30,
        { allocated: 0, used: 0, carried: 0 },
        {
          unlimited: true,
        },
      );
      expect(verdict.exceeded).toBe(false);
      expect(verdict.shortfall).toBe(0);
    });
  });

  describe('overlappingRanges', () => {
    const existing = [
      { id: 'b', from: '2027-03-10', to: '2027-03-12' },
      { id: 'a', from: '2027-03-20', to: '2027-03-22' },
    ];

    it('finds a range that touches at the edge', () => {
      expect(
        overlappingRanges({ from: '2027-03-12', to: '2027-03-15' }, existing),
      ).toHaveLength(1);
    });

    it('ignores a range that only abuts it', () => {
      expect(
        overlappingRanges({ from: '2027-03-13', to: '2027-03-19' }, existing),
      ).toHaveLength(0);
    });

    it('finds every overlap regardless of id order (the M14 lesson)', () => {
      // Ids deliberately sort the "wrong" way against the dates. An engine
      // that de-duplicated by comparing ids would drop one of these.
      const hits = overlappingRanges(
        { from: '2027-03-01', to: '2027-03-31' },
        existing,
      );
      expect(hits.map((h) => h.id).sort()).toEqual(['a', 'b']);
    });

    it('excludes the row being edited', () => {
      expect(
        overlappingRanges(
          { from: '2027-03-10', to: '2027-03-12' },
          existing,
          'b',
        ),
      ).toHaveLength(0);
    });
  });

  describe('allocationFor', () => {
    const session = { sessionStart: '2027-01-01', sessionEnd: '2027-12-31' };

    it('grants the full quota to somebody already employed', () => {
      expect(
        allocationFor({
          ...session,
          annualQuota: 10,
          joiningDate: '2026-05-01',
          prorate: true,
        }),
      ).toBe(10);
    });

    it('grants the full quota when proration is off', () => {
      expect(
        allocationFor({
          ...session,
          annualQuota: 10,
          joiningDate: '2027-07-15',
          prorate: false,
        }),
      ).toBe(10);
    });

    it('prorates a mid-session joiner by whole months', () => {
      // Joins in July: six months of a twelve-month session remain.
      expect(
        allocationFor({
          ...session,
          annualQuota: 12,
          joiningDate: '2027-07-15',
          prorate: true,
        }),
      ).toBe(6);
    });

    it('counts the joining month itself, however late in it', () => {
      expect(
        allocationFor({
          ...session,
          annualQuota: 12,
          joiningDate: '2027-12-28',
          prorate: true,
        }),
      ).toBe(1);
    });

    it('grants nothing to somebody who joins after the session ends', () => {
      expect(
        allocationFor({
          ...session,
          annualQuota: 12,
          joiningDate: '2028-02-01',
          prorate: true,
        }),
      ).toBe(0);
    });

    it('rounds to the nearest half day', () => {
      expect(
        allocationFor({
          ...session,
          annualQuota: 10,
          joiningDate: '2027-08-01',
          prorate: true,
        }),
        // 5/12 of 10 = 4.166… → 4.0 (nearest half day)
      ).toBe(4);
    });
  });

  describe('carryForwardDays', () => {
    it('carries nothing when the type forbids it', () => {
      expect(
        carryForwardDays(
          { allocated: 20, used: 2, carried: 0 },
          { carryForward: false, maxCarry: 40 },
        ),
      ).toBe(0);
    });

    it('carries the unused balance up to the cap', () => {
      expect(
        carryForwardDays(
          { allocated: 20, used: 2, carried: 0 },
          { carryForward: true, maxCarry: 40 },
        ),
      ).toBe(18);
    });

    it('never carries past the cap', () => {
      expect(
        carryForwardDays(
          { allocated: 20, used: 0, carried: 30 },
          { carryForward: true, maxCarry: 40 },
        ),
      ).toBe(40);
    });

    it('carries nothing from an overdrawn balance', () => {
      expect(
        carryForwardDays(
          { allocated: 5, used: 9, carried: 0 },
          { carryForward: true, maxCarry: 40 },
        ),
      ).toBe(0);
    });
  });

  describe('splitLeaveDays', () => {
    const march = [
      '2027-03-01',
      '2027-03-02',
      '2027-03-03',
      '2027-03-04',
      '2027-03-07',
    ];

    it('counts only the month working days a span covers', () => {
      const split = splitLeaveDays(
        [
          {
            from: '2027-02-25',
            to: '2027-03-02',
            isPaid: true,
            halfDay: false,
          },
        ],
        march,
      );
      expect(split).toEqual({ paid: 2, unpaid: 0 });
    });

    it('separates paid from unpaid types', () => {
      const split = splitLeaveDays(
        [
          {
            from: '2027-03-01',
            to: '2027-03-02',
            isPaid: true,
            halfDay: false,
          },
          {
            from: '2027-03-03',
            to: '2027-03-04',
            isPaid: false,
            halfDay: false,
          },
        ],
        march,
      );
      expect(split).toEqual({ paid: 2, unpaid: 2 });
    });

    it('counts a day covered twice only once', () => {
      // Two approvals for the same Monday are one day off, not two — and
      // deducting twice would charge the employee for a data-entry slip.
      const split = splitLeaveDays(
        [
          {
            from: '2027-03-01',
            to: '2027-03-02',
            isPaid: false,
            halfDay: false,
          },
          {
            from: '2027-03-02',
            to: '2027-03-03',
            isPaid: false,
            halfDay: false,
          },
        ],
        march,
      );
      expect(split).toEqual({ paid: 0, unpaid: 3 });
    });

    it('lets a paid approval win over an unpaid one on the same day', () => {
      const split = splitLeaveDays(
        [
          {
            from: '2027-03-01',
            to: '2027-03-01',
            isPaid: false,
            halfDay: false,
          },
          {
            from: '2027-03-01',
            to: '2027-03-01',
            isPaid: true,
            halfDay: false,
          },
        ],
        march,
      );
      expect(split).toEqual({ paid: 1, unpaid: 0 });
    });

    it('counts a half day as half', () => {
      const split = splitLeaveDays(
        [
          {
            from: '2027-03-01',
            to: '2027-03-01',
            isPaid: false,
            halfDay: true,
          },
        ],
        march,
      );
      expect(split).toEqual({ paid: 0, unpaid: 0.5 });
    });
  });

  describe('helpers', () => {
    it('halfDays rounds to the nearest half', () => {
      expect(halfDays(2.24)).toBe(2);
      expect(halfDays(2.25)).toBe(2.5);
      expect(halfDays(2.76)).toBe(3);
    });

    it('monthSpan counts inclusively across a year boundary', () => {
      expect(monthSpan('2027-11-01', '2028-02-28')).toBe(4);
      expect(monthSpan('2027-03-01', '2027-03-31')).toBe(1);
    });
  });
});
