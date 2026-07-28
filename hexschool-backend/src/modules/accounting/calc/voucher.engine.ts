import { money, sumMoney } from '../../fee/calc/money.util';

/**
 * The double-entry rules (roadmap M20 §6/§7), as a dependency-free
 * engine. Everything here is arithmetic and shape checking over plain
 * objects — no Prisma, no Nest — so it is golden-testable and importable
 * from anywhere (the M15/M16/M17/M19 engine convention).
 *
 * The one rule the whole module rests on: **Σdebit = Σcredit, exactly.**
 * Not "close enough" — the trial balance is the report that proves a
 * school's books are internally consistent, and a one-paisa drift there
 * is indistinguishable from a real error, so it destroys the report's
 * only purpose. `money()` rounds every step to paisa (the M16 rule), so
 * the comparison is between two values already on the stored grid.
 */

export type EntrySide = 'DEBIT' | 'CREDIT';

/** One line, as the engine sees it. */
export interface DraftEntry {
  accountId: string;
  debit: number;
  credit: number;
  narration?: string | null;
}

/** What the engine needs to know about an account to judge a line. */
export interface AccountFacts {
  id: string;
  isGroup: boolean;
  isActive: boolean;
  code: string;
  name: string;
}

export type VoucherKind = 'DEBIT' | 'CREDIT' | 'JOURNAL' | 'CONTRA';

export interface EntryProblem {
  index: number;
  accountId: string;
  code:
    | 'BOTH_SIDES'
    | 'EMPTY'
    | 'NEGATIVE'
    | 'UNKNOWN_ACCOUNT'
    | 'GROUP_NODE'
    | 'INACTIVE';
  message: string;
}

export interface VoucherProblems {
  /** Per-line failures, all of them — never just the first. */
  entries: EntryProblem[];
  /** Voucher-level failure, if any. */
  balance: BalanceError | null;
  /** Shape rule for the voucher's declared type, if violated. */
  shape: string | null;
}

export interface BalanceError {
  debitTotal: number;
  creditTotal: number;
  difference: number;
}

/** Debit total, rounded per line then summed (the M16 money rule). */
export function debitTotal(entries: DraftEntry[]): number {
  return sumMoney(entries.map((entry) => entry.debit));
}

export function creditTotal(entries: DraftEntry[]): number {
  return sumMoney(entries.map((entry) => entry.credit));
}

/**
 * `null` when the voucher balances. The difference is returned signed
 * (debit − credit) because the entry screen shows the operator which way
 * they are out, and by how much.
 */
export function balanceError(entries: DraftEntry[]): BalanceError | null {
  const debits = debitTotal(entries);
  const credits = creditTotal(entries);
  const difference = money(debits - credits);
  if (difference === 0) return null;
  return { debitTotal: debits, creditTotal: credits, difference };
}

/** Which side a line sits on. Assumes the line already passed `validateEntry`. */
export function sideOf(entry: DraftEntry): EntrySide {
  return money(entry.debit) > 0 ? 'DEBIT' : 'CREDIT';
}

/**
 * Per-line validation. The DB CHECK `chk_voucher_entries_one_sided`
 * covers the arithmetic half of this; the account rules (leaf-only,
 * active) need a join and so can only live here — which is exactly the
 * split PROJECT_CONTEXT §16 records for the M15 mark bounds.
 */
export function validateEntries(
  entries: DraftEntry[],
  accounts: Map<string, AccountFacts>,
): EntryProblem[] {
  const problems: EntryProblem[] = [];

  entries.forEach((entry, index) => {
    const debit = money(entry.debit);
    const credit = money(entry.credit);
    const account = accounts.get(entry.accountId);

    if (debit < 0 || credit < 0) {
      problems.push({
        index,
        accountId: entry.accountId,
        code: 'NEGATIVE',
        message:
          'An amount cannot be negative — a negative debit is a credit, and it would slip past the balance test',
      });
    } else if (debit > 0 && credit > 0) {
      problems.push({
        index,
        accountId: entry.accountId,
        code: 'BOTH_SIDES',
        message: 'A line is either a debit or a credit, never both',
      });
    } else if (debit === 0 && credit === 0) {
      problems.push({
        index,
        accountId: entry.accountId,
        code: 'EMPTY',
        message: 'A line must carry an amount',
      });
    }

    if (!account) {
      problems.push({
        index,
        accountId: entry.accountId,
        code: 'UNKNOWN_ACCOUNT',
        message: 'No such account in this school',
      });
      return;
    }
    if (account.isGroup) {
      problems.push({
        index,
        accountId: entry.accountId,
        code: 'GROUP_NODE',
        message: `${account.code} ${account.name} is a heading — post to one of its child accounts`,
      });
    }
    if (!account.isActive) {
      problems.push({
        index,
        accountId: entry.accountId,
        code: 'INACTIVE',
        message: `${account.code} ${account.name} is inactive`,
      });
    }
  });

  return problems;
}

/**
 * The shape a voucher type promises.
 *
 * These are conventions a BD school's cash book actually keeps, not
 * arbitrary strictness: a CONTRA voucher moves the school's own money
 * between its own cash and bank, so if it touched an income account it
 * would be a receipt wearing the wrong name and the cash book would
 * double-count it. DEBIT/CREDIT vouchers are payment/receipt vouchers
 * and must touch a cash or bank account on the matching side; JOURNAL is
 * deliberately unconstrained — it is the "everything else" document.
 */
export function shapeError(
  type: VoucherKind,
  entries: DraftEntry[],
  accountTypes: Map<string, string>,
): string | null {
  const kindOf = (entry: DraftEntry): string =>
    accountTypes.get(entry.accountId) ?? 'OTHER';
  const isFunds = (entry: DraftEntry): boolean =>
    kindOf(entry) === 'CASH' || kindOf(entry) === 'BANK';

  if (type === 'CONTRA') {
    const offenders = entries.filter((entry) => !isFunds(entry));
    if (offenders.length > 0) {
      return 'A contra voucher moves money between the school’s own cash and bank accounts — every line must be a CASH or BANK account';
    }
    return null;
  }

  if (type === 'CREDIT') {
    // Money in: cash/bank is debited.
    const funded = entries.some(
      (entry) => isFunds(entry) && money(entry.debit) > 0,
    );
    return funded
      ? null
      : 'A receipt (credit voucher) must debit a cash or bank account — that is where the money arrived';
  }

  if (type === 'DEBIT') {
    // Money out: cash/bank is credited.
    const funded = entries.some(
      (entry) => isFunds(entry) && money(entry.credit) > 0,
    );
    return funded
      ? null
      : 'A payment (debit voucher) must credit a cash or bank account — that is where the money left from';
  }

  return null;
}

/** Everything wrong with a draft, in one pass — the M15 all-at-once rule. */
export function validateVoucher(params: {
  type: VoucherKind;
  entries: DraftEntry[];
  accounts: Map<string, AccountFacts>;
  accountTypes: Map<string, string>;
}): VoucherProblems {
  const entries = validateEntries(params.entries, params.accounts);
  return {
    entries,
    // Only judge balance and shape once the lines themselves make sense;
    // a "both sides" line makes both downstream verdicts meaningless.
    balance: entries.length === 0 ? balanceError(params.entries) : null,
    shape:
      entries.length === 0
        ? shapeError(params.type, params.entries, params.accountTypes)
        : null,
  };
}

export function hasProblems(problems: VoucherProblems): boolean {
  return (
    problems.entries.length > 0 ||
    problems.balance !== null ||
    problems.shape !== null
  );
}

/** First human-readable message, for the 409 the API throws. */
export function firstProblemMessage(problems: VoucherProblems): string {
  if (problems.entries.length > 0) return problems.entries[0].message;
  if (problems.balance) {
    const { debitTotal: d, creditTotal: c, difference } = problems.balance;
    return `Debits (${d.toFixed(2)}) and credits (${c.toFixed(2)}) differ by ${Math.abs(difference).toFixed(2)} — a voucher must balance exactly before it can be posted`;
  }
  return problems.shape ?? 'Invalid voucher';
}

/**
 * The reversal of a posted voucher: the same accounts and amounts with
 * the two sides swapped.
 *
 * This is the *only* correction mechanism for a POSTED voucher (roadmap
 * M20 §6). Editing one in place would rewrite a number that has already
 * been reported, printed and reconciled against; a reversal leaves both
 * documents standing, which is what makes an audit trail an audit trail.
 * A reversal balances by construction — swapping the sides of a balanced
 * set cannot unbalance it — and the engine keeps line order so the two
 * documents read as mirror images side by side.
 */
export function reverseEntries(entries: DraftEntry[]): DraftEntry[] {
  return entries.map((entry) => ({
    accountId: entry.accountId,
    debit: money(entry.credit),
    credit: money(entry.debit),
    narration: entry.narration ?? null,
  }));
}

/**
 * The voucher type a reversal should carry. A payment's reversal is a
 * receipt and vice versa; a journal reverses as a journal, a contra as a
 * contra — because both of those are already symmetric.
 */
export function reversalType(type: VoucherKind): VoucherKind {
  if (type === 'DEBIT') return 'CREDIT';
  if (type === 'CREDIT') return 'DEBIT';
  return type;
}

/**
 * How much a set of entries moves an account, in the account's own
 * natural direction. Assets and expenses are debit-normal, so a debit
 * increases them; liabilities, equity and income are credit-normal, so a
 * credit does.
 *
 * Getting this backwards is the classic accounting bug: income would
 * report as a negative number, the balance sheet would fail to balance,
 * and every figure would be individually defensible.
 */
export function naturalSide(group: string): EntrySide {
  return group === 'ASSET' || group === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
}

export function signedMovement(
  group: string,
  debit: number,
  credit: number,
): number {
  return naturalSide(group) === 'DEBIT'
    ? money(money(debit) - money(credit))
    : money(money(credit) - money(debit));
}
