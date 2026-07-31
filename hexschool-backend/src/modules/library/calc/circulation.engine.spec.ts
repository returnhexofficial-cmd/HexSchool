import {
  canIssue,
  canRenew,
  dueDateFor,
  renewedDueDate,
  type CopyState,
  type IssuePolicy,
  type MemberState,
  type RenewState,
} from './circulation.engine';

const MEMBER_ID = 'member-1';
const BOOK_ID = 'book-1';

const member = (over: Partial<MemberState> = {}): MemberState => ({
  status: 'ACTIVE',
  maxBooks: 2,
  openLoans: 0,
  outstandingFine: 0,
  overdueLoans: 0,
  heldBookIds: new Set<string>(),
  ...over,
});

const copy = (over: Partial<CopyState> = {}): CopyState => ({
  status: 'AVAILABLE',
  bookId: BOOK_ID,
  reservedForMemberId: null,
  ...over,
});

const policy = (over: Partial<IssuePolicy> = {}): IssuePolicy => ({
  enabled: true,
  fineBlockThreshold: 100,
  blockWhenOverdue: true,
  blockDuplicateTitle: true,
  ...over,
});

describe('canIssue', () => {
  it('allows a clean member to take an available copy', () => {
    expect(canIssue(member(), copy(), policy(), MEMBER_ID)).toEqual({
      allowed: true,
      code: null,
      reason: null,
      overridable: false,
    });
  });

  it('refuses everything when the module is switched off', () => {
    const verdict = canIssue(
      member(),
      copy(),
      policy({ enabled: false }),
      MEMBER_ID,
    );
    expect(verdict.code).toBe('LIBRARY_DISABLED');
    expect(verdict.overridable).toBe(false);
  });

  describe('structural refusals — never overridable', () => {
    it('refuses a copy already on loan', () => {
      const verdict = canIssue(
        member(),
        copy({ status: 'ISSUED' }),
        policy(),
        MEMBER_ID,
      );
      expect(verdict.code).toBe('COPY_UNAVAILABLE');
      expect(verdict.overridable).toBe(false);
    });

    it.each(['LOST', 'DAMAGED', 'WITHDRAWN'] as const)(
      'refuses a %s copy',
      (status) => {
        const verdict = canIssue(
          member(),
          copy({ status }),
          policy(),
          MEMBER_ID,
        );
        expect(verdict.code).toBe('COPY_UNAVAILABLE');
        expect(verdict.overridable).toBe(false);
      },
    );

    /**
     * A copy physically in somebody else's hands is a fact about the
     * world, and no permission changes it. Checking the copy before the
     * member is what makes the override-holder's error message honest —
     * the M13/M14 two-tier split, applied to a shelf.
     */
    it('reports the copy problem first, even for a member who is also over limit', () => {
      const verdict = canIssue(
        member({ openLoans: 5, maxBooks: 2 }),
        copy({ status: 'ISSUED' }),
        policy(),
        MEMBER_ID,
      );
      expect(verdict.code).toBe('COPY_UNAVAILABLE');
    });
  });

  describe('the reservation hold', () => {
    it('refuses a copy held for somebody else, but allows an override', () => {
      const verdict = canIssue(
        member(),
        copy({ status: 'RESERVED', reservedForMemberId: 'member-2' }),
        policy(),
        MEMBER_ID,
      );
      expect(verdict.code).toBe('COPY_RESERVED_FOR_OTHER');
      expect(verdict.overridable).toBe(true);
    });

    /** Issuing a held copy to its holder is fulfilment, not a breach. */
    it('allows the member the copy is held for to take it', () => {
      const verdict = canIssue(
        member(),
        copy({ status: 'RESERVED', reservedForMemberId: MEMBER_ID }),
        policy(),
        MEMBER_ID,
      );
      expect(verdict.allowed).toBe(true);
    });
  });

  describe('member policy — overridable', () => {
    it.each(['SUSPENDED', 'CLOSED'] as const)('refuses a %s card', (status) => {
      const verdict = canIssue(member({ status }), copy(), policy(), MEMBER_ID);
      expect(verdict.code).toBe('MEMBER_INACTIVE');
      expect(verdict.overridable).toBe(true);
    });

    it('refuses at the limit, not one past it', () => {
      expect(
        canIssue(
          member({ openLoans: 1, maxBooks: 2 }),
          copy(),
          policy(),
          MEMBER_ID,
        ).allowed,
      ).toBe(true);
      const verdict = canIssue(
        member({ openLoans: 2, maxBooks: 2 }),
        copy(),
        policy(),
        MEMBER_ID,
      );
      expect(verdict.code).toBe('MEMBER_LIMIT');
      expect(verdict.reason).toContain('maximum 2');
    });

    it('blocks at the fine threshold inclusively', () => {
      expect(
        canIssue(
          member({ outstandingFine: 99.99 }),
          copy(),
          policy(),
          MEMBER_ID,
        ).allowed,
      ).toBe(true);
      expect(
        canIssue(member({ outstandingFine: 100 }), copy(), policy(), MEMBER_ID)
          .code,
      ).toBe('MEMBER_FINE');
    });

    it('never blocks on fines when the threshold is 0', () => {
      const verdict = canIssue(
        member({ outstandingFine: 5000 }),
        copy(),
        policy({ fineBlockThreshold: 0 }),
        MEMBER_ID,
      );
      expect(verdict.allowed).toBe(true);
    });

    it('blocks a member holding an overdue book, when the school asks for it', () => {
      expect(
        canIssue(member({ overdueLoans: 1 }), copy(), policy(), MEMBER_ID).code,
      ).toBe('MEMBER_OVERDUE');
      expect(
        canIssue(
          member({ overdueLoans: 1 }),
          copy(),
          policy({ blockWhenOverdue: false }),
          MEMBER_ID,
        ).allowed,
      ).toBe(true);
    });

    it('refuses a second copy of a title the member already has', () => {
      const verdict = canIssue(
        member({ heldBookIds: new Set([BOOK_ID]) }),
        copy(),
        policy(),
        MEMBER_ID,
      );
      expect(verdict.code).toBe('DUPLICATE_TITLE');
      expect(
        canIssue(
          member({ heldBookIds: new Set(['other-book']) }),
          copy(),
          policy(),
          MEMBER_ID,
        ).allowed,
      ).toBe(true);
    });
  });
});

describe('canRenew', () => {
  const now = new Date('2026-03-10T10:00:00Z');
  const state = (over: Partial<RenewState> = {}): RenewState => ({
    returnedAt: null,
    dueAt: new Date('2026-03-15T10:00:00Z'),
    renewCount: 0,
    memberStatus: 'ACTIVE',
    reservationsByOthers: 0,
    ...over,
  });

  it('allows a first renewal on a live loan', () => {
    expect(canRenew(state(), 2, now).allowed).toBe(true);
  });

  it('refuses a loan that has already come back', () => {
    const verdict = canRenew(
      state({ returnedAt: new Date('2026-03-09T10:00:00Z') }),
      2,
      now,
    );
    expect(verdict.code).toBe('ALREADY_RETURNED');
    expect(verdict.overridable).toBe(false);
  });

  /**
   * Roadmap §6 — and the reason is arithmetic, not discipline: renewing
   * an overdue loan moves `due_at` forward and erases lateness that has
   * already been earned, so the fine the member owes would silently
   * disappear.
   */
  it('refuses to renew an overdue loan', () => {
    const verdict = canRenew(
      state({ dueAt: new Date('2026-03-09T10:00:00Z') }),
      2,
      now,
    );
    expect(verdict.code).toBe('OVERDUE');
  });

  it('refuses once the renewal limit is reached', () => {
    expect(canRenew(state({ renewCount: 1 }), 2, now).allowed).toBe(true);
    expect(canRenew(state({ renewCount: 2 }), 2, now).code).toBe('RENEW_LIMIT');
  });

  it('refuses while somebody else is waiting for the title', () => {
    const verdict = canRenew(state({ reservationsByOthers: 2 }), 2, now);
    expect(verdict.code).toBe('RESERVED_BY_OTHER');
    expect(verdict.reason).toContain('2 other member(s)');
  });

  it('refuses on a suspended card', () => {
    expect(canRenew(state({ memberStatus: 'SUSPENDED' }), 2, now).code).toBe(
      'MEMBER_INACTIVE',
    );
  });

  it('refuses when the module is off', () => {
    expect(canRenew(state(), 2, now, false).code).toBe('LIBRARY_DISABLED');
  });
});

describe('dueDateFor / renewedDueDate', () => {
  const issued = new Date('2026-03-01T15:00:00Z');

  it('adds whole loan days to the issue instant, keeping the time of day', () => {
    expect(dueDateFor(issued, 7).toISOString()).toBe(
      '2026-03-08T15:00:00.000Z',
    );
  });

  it('treats a zero or negative loan length as one day', () => {
    expect(dueDateFor(issued, 0).toISOString()).toBe(
      '2026-03-02T15:00:00.000Z',
    );
    expect(dueDateFor(issued, -5).toISOString()).toBe(
      '2026-03-02T15:00:00.000Z',
    );
  });

  /**
   * A renewal runs from today, not from the old due date, so a member
   * renewing on the last day gets the full new period — which is what
   * "renew" means to the person standing at the desk.
   */
  it('runs a renewal forward from now', () => {
    const now = new Date('2026-03-07T09:00:00Z');
    expect(renewedDueDate(now, 7).toISOString()).toBe(
      '2026-03-14T09:00:00.000Z',
    );
  });
});
