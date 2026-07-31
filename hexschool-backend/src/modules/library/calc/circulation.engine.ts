/**
 * The circulation policy — **the single verdict every "can this go out"
 * question funnels through**, exactly as M22's `submission-window.engine`
 * is for "can they hand this in".
 *
 * That shape is deliberate and it is the M16 `deriveStatus` lesson: the
 * desk screen greys out the Issue button, the API returns a 409, and the
 * member's OPAC row shows "you have reached your limit" — three answers
 * to one question, and they must not be able to disagree. So each is a
 * rendering of the same `IssueVerdict`, and none of them re-derives it.
 *
 * Dependency-free: no Prisma types, no settings service, no dates
 * fetched. Everything the decision needs is an argument.
 */

export type IssueBlockCode =
  | 'LIBRARY_DISABLED'
  | 'MEMBER_INACTIVE'
  | 'MEMBER_LIMIT'
  | 'MEMBER_FINE'
  | 'MEMBER_OVERDUE'
  | 'COPY_UNAVAILABLE'
  | 'COPY_RESERVED_FOR_OTHER'
  | 'DUPLICATE_TITLE';

export type RenewBlockCode =
  | 'LIBRARY_DISABLED'
  | 'ALREADY_RETURNED'
  | 'RENEW_LIMIT'
  | 'OVERDUE'
  | 'RESERVED_BY_OTHER'
  | 'MEMBER_INACTIVE';

export interface IssueVerdict {
  allowed: boolean;
  /** `null` when allowed. */
  code: IssueBlockCode | null;
  /** What the desk shows and what the 409 says — one sentence, verbatim. */
  reason: string | null;
  /**
   * Whether `library.issue.override` can push past this. **Structural
   * refusals are never overridable** — the two-tier split M13 introduced
   * for the routine builder and M14 reused for exam clashes. A copy that
   * is physically in somebody else's hands cannot be issued by anybody,
   * however senior; a member two books over their limit is a judgement
   * call the librarian is allowed to make.
   */
  overridable: boolean;
}

export interface MemberState {
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  maxBooks: number;
  /** Loans currently out (not returned). */
  openLoans: number;
  /** Total unsettled fine across every loan, open or closed. */
  outstandingFine: number;
  /** Open loans already past their due date. */
  overdueLoans: number;
  /** Book ids this member already has out — the duplicate-title check. */
  heldBookIds: ReadonlySet<string>;
}

export interface CopyState {
  status:
    'AVAILABLE' | 'ISSUED' | 'RESERVED' | 'LOST' | 'DAMAGED' | 'WITHDRAWN';
  bookId: string;
  /**
   * When the copy is RESERVED, whose hold it is. Issuing a held copy to
   * the person it is held for is the *fulfilment* path, not a violation.
   */
  reservedForMemberId?: string | null;
}

export interface IssuePolicy {
  enabled: boolean;
  /** Unsettled fine at or above this blocks new loans. 0 = never blocks. */
  fineBlockThreshold: number;
  /** Refuse a new loan while the member is holding an overdue one. */
  blockWhenOverdue: boolean;
  /** Refuse a second copy of a title the member already has out. */
  blockDuplicateTitle: boolean;
}

const ok: IssueVerdict = {
  allowed: true,
  code: null,
  reason: null,
  overridable: false,
};

const no = (
  code: IssueBlockCode,
  reason: string,
  overridable: boolean,
): IssueVerdict => ({ allowed: false, code, reason, overridable });

/**
 * May `member` borrow `copy`?
 *
 * Order is not arbitrary. The **structural** refusals are checked first
 * so that an override-holder is told the truth about a book that is
 * physically unavailable rather than being offered a button that cannot
 * work. Only after the copy is known to be issuable do the member's
 * policy limits get a say, and those are the ones an override reaches.
 */
export function canIssue(
  member: MemberState,
  copy: CopyState,
  policy: IssuePolicy,
  memberId: string,
): IssueVerdict {
  if (!policy.enabled) {
    return no(
      'LIBRARY_DISABLED',
      'The library module is switched off for this school',
      false,
    );
  }

  // ── structural: about the physical book ─────────────────────────────
  if (copy.status === 'ISSUED') {
    return no(
      'COPY_UNAVAILABLE',
      'This copy is already on loan — return it before issuing it again',
      false,
    );
  }
  if (
    copy.status === 'LOST' ||
    copy.status === 'DAMAGED' ||
    copy.status === 'WITHDRAWN'
  ) {
    return no(
      'COPY_UNAVAILABLE',
      `This copy is marked ${copy.status.toLowerCase()} and is out of circulation`,
      false,
    );
  }
  if (copy.status === 'RESERVED' && copy.reservedForMemberId !== memberId) {
    return no(
      'COPY_RESERVED_FOR_OTHER',
      'This copy is being held for another member',
      // Overridable: a hold that has clearly lapsed, or a member standing
      // at the desk who needs it now, is the librarian's call. The hold
      // is a courtesy, not a property right.
      true,
    );
  }

  // ── policy: about the member ────────────────────────────────────────
  if (member.status !== 'ACTIVE') {
    return no(
      'MEMBER_INACTIVE',
      `This card is ${member.status.toLowerCase()} and cannot borrow`,
      true,
    );
  }
  if (member.openLoans >= member.maxBooks) {
    return no(
      'MEMBER_LIMIT',
      `Already holding ${member.openLoans} of a maximum ${member.maxBooks} book(s)`,
      true,
    );
  }
  if (
    policy.fineBlockThreshold > 0 &&
    member.outstandingFine >= policy.fineBlockThreshold
  ) {
    return no(
      'MEMBER_FINE',
      `Unpaid fine of ${member.outstandingFine.toFixed(2)} BDT is at or above the ${policy.fineBlockThreshold.toFixed(2)} limit`,
      true,
    );
  }
  if (policy.blockWhenOverdue && member.overdueLoans > 0) {
    return no(
      'MEMBER_OVERDUE',
      `Holding ${member.overdueLoans} overdue book(s) — return them first`,
      true,
    );
  }
  if (policy.blockDuplicateTitle && member.heldBookIds.has(copy.bookId)) {
    return no(
      'DUPLICATE_TITLE',
      'This member already has a copy of this title on loan',
      true,
    );
  }

  return ok;
}

export interface RenewState {
  returnedAt: Date | null;
  dueAt: Date;
  renewCount: number;
  memberStatus: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  /** ACTIVE holds on the title placed by somebody other than the holder. */
  reservationsByOthers: number;
}

export interface RenewVerdict {
  allowed: boolean;
  code: RenewBlockCode | null;
  reason: string | null;
  overridable: boolean;
}

/**
 * Roadmap §4/§6: "renew (limit + no-reservation check)", "renew blocked
 * if overdue".
 *
 * The overdue block is not a punishment, it is what makes the fine
 * calculable: renewing an overdue loan would move `due_at` forward and
 * erase the lateness that was already earned. A member who is late
 * returns the book, settles what is owed, and borrows it again — which
 * leaves two honest loan records instead of one that quietly forgave
 * itself.
 */
export function canRenew(
  state: RenewState,
  maxRenews: number,
  now: Date,
  enabled = true,
): RenewVerdict {
  if (!enabled) {
    return {
      allowed: false,
      code: 'LIBRARY_DISABLED',
      reason: 'The library module is switched off for this school',
      overridable: false,
    };
  }
  if (state.returnedAt !== null) {
    return {
      allowed: false,
      code: 'ALREADY_RETURNED',
      reason: 'This book has already been returned',
      overridable: false,
    };
  }
  if (state.memberStatus !== 'ACTIVE') {
    return {
      allowed: false,
      code: 'MEMBER_INACTIVE',
      reason: `This card is ${state.memberStatus.toLowerCase()} and cannot renew`,
      overridable: true,
    };
  }
  if (state.dueAt.getTime() < now.getTime()) {
    return {
      allowed: false,
      code: 'OVERDUE',
      reason:
        'This loan is already overdue — return it and settle the fine before borrowing again',
      overridable: true,
    };
  }
  if (state.renewCount >= maxRenews) {
    return {
      allowed: false,
      code: 'RENEW_LIMIT',
      reason: `Already renewed ${state.renewCount} time(s), the maximum is ${maxRenews}`,
      overridable: true,
    };
  }
  if (state.reservationsByOthers > 0) {
    return {
      allowed: false,
      code: 'RESERVED_BY_OTHER',
      reason: `${state.reservationsByOthers} other member(s) are waiting for this title`,
      overridable: true,
    };
  }
  return { allowed: true, code: null, reason: null, overridable: false };
}

/**
 * When a loan falls due. Loan length is per member type (roadmap §3
 * "student 7 / teacher 14"), and the clock starts at the moment the book
 * leaves the desk — the M22 instant-not-date reasoning: a book handed
 * over at 15:00 is due at 15:00, not at midnight, so a same-afternoon
 * return on the seventh day is not late.
 */
export function dueDateFor(
  issuedAt: Date,
  loanDays: number,
  renewals = 0,
): Date {
  const days = Math.max(1, Math.round(loanDays)) * (1 + Math.max(0, renewals));
  return new Date(issuedAt.getTime() + days * 86_400_000);
}

/**
 * Extending an existing loan. The new date runs from **today**, not from
 * the old due date — a member who renews on the last day gets the full
 * new loan period, which is what "renew" means to the person at the
 * desk, and a member renewing early does not silently lose the days they
 * had left. Renewing early is rare; being surprised by it is not.
 */
export function renewedDueDate(now: Date, loanDays: number): Date {
  return new Date(
    now.getTime() + Math.max(1, Math.round(loanDays)) * 86_400_000,
  );
}
