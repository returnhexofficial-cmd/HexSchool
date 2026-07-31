import { money } from '../../fee/calc/money.util';
import type { DraftEntry } from './voucher.engine';

/**
 * Turning a fee payment into a balanced voucher (roadmap M20 §4
 * "Auto-posting listeners: `payment.success` → Dr Cash/Bank-or-Gateway,
 * Cr Fee Income (per head→account mapping table)").
 *
 * The whole difficulty is one line of arithmetic done wrong: a payment
 * of 3,000 against an invoice billing tuition 2,500 + transport 1,000
 * (partly paid) has to be split across two income accounts, and the two
 * credits **must sum to exactly 3,000**. Allocating each head its own
 * rounded share is the obvious way to do it and it is wrong — three
 * heads at 1/3 of 100 gives 33.33 × 3 = 99.99, and the voucher will not
 * post.
 *
 * So the split uses the **largest-remainder** method: floor every share
 * to the paisa, then hand the leftover paisa out one at a time to the
 * heads with the largest fractional remainder. The total is exact by
 * construction, and the paisa lands where it is most deserved rather than
 * always on the first or last line.
 */

/** System posting slots, resolved by slug through the posting map. */
export const SYSTEM_SLOTS = {
  /** Where a fee whose head has no mapping is credited. */
  FEE_INCOME_DEFAULT: 'FEE_INCOME_DEFAULT',
  /** Late fines — income, but not a fee head. */
  LATE_FINE_INCOME: 'LATE_FINE_INCOME',
  /** Where a payment lands when its method has no mapping. */
  CASH_DEFAULT: 'CASH_DEFAULT',
  /** Gateway fees deducted at settlement (§8). */
  GATEWAY_CHARGES: 'GATEWAY_CHARGES',
  /** The balancing side of the opening-balance journal (§8). */
  OPENING_EQUITY: 'OPENING_EQUITY',
  // ── M21 payroll ─────────────────────────────────────────────────────
  // Registered here rather than in a payroll-owned registry because the
  // posting map is the ledger's contract with the rest of the system, and
  // `PostingMapKind.SYSTEM` was designed append-only for exactly this.
  /** Salaries and allowances actually earned. */
  SALARY_EXPENSE: 'SALARY_EXPENSE',
  /** Festival/performance bonus, kept off the salary line so a school can
   *  see what a festival cost it. */
  BONUS_EXPENSE: 'BONUS_EXPENSE',
  /** The school's own provident-fund contribution — an expense. */
  PF_EXPENSE: 'PF_EXPENSE',
  /** Both sides of the provident fund, owed until it is remitted. */
  PF_PAYABLE: 'PF_PAYABLE',
  /** Tax deducted at source, owed to the revenue board. */
  TAX_PAYABLE: 'TAX_PAYABLE',
  /** Unpaid salary — where a HELD payslip's money waits, if a school
   *  chooses to accrue it rather than simply not post it. */
  SALARY_PAYABLE: 'SALARY_PAYABLE',
  // ── M23 library ─────────────────────────────────────────────────────
  /** Overdue fines and lost/damaged recoveries. Kept off
   *  `LATE_FINE_INCOME` (which is the *fee* late fine) so a school can
   *  see what its library earns without it being buried in tuition
   *  arrears — two different stories about two different problems. */
  LIBRARY_FINE_INCOME: 'LIBRARY_FINE_INCOME',
  // ── M25 transport ───────────────────────────────────────────────────
  /** Fuel, maintenance, repairs, tolls — what running the fleet costs.
   *  The first slot that is spent rather than received, which is why its
   *  voucher is a DEBIT one. Transport fee INCOME needs no slot: it is a
   *  fee head like any other and posts through the head → account map. */
  TRANSPORT_EXPENSE: 'TRANSPORT_EXPENSE',
} as const;

export type SystemSlot = (typeof SYSTEM_SLOTS)[keyof typeof SYSTEM_SLOTS];

/** One billed component of the invoice the payment settles. */
export interface BilledPortion {
  /** `null` for the fine portion, which belongs to no fee head. */
  feeHeadId: string | null;
  label: string;
  /** Net of discount — what the payer is actually being asked for. */
  amount: number;
}

export interface HeadShare extends BilledPortion {
  share: number;
}

/**
 * Split `amount` across `portions` in proportion to their net values,
 * exactly. See the module doc for why this is largest-remainder and not
 * a rounded pro-rata.
 *
 * Degenerate inputs are handled deliberately rather than by accident: no
 * portions, or portions summing to zero, put everything on the first
 * portion (or produce nothing at all when there is none), because
 * refusing to post a real payment because an invoice was oddly shaped
 * would strand money outside the ledger.
 */
export function allocateAcrossHeads(
  amount: number,
  portions: BilledPortion[],
): HeadShare[] {
  const total = money(amount);
  if (portions.length === 0 || total === 0) return [];

  const weights = portions.map((portion) => Math.max(0, money(portion.amount)));
  const weightTotal = money(weights.reduce((sum, value) => sum + value, 0));

  if (weightTotal === 0) {
    return portions.map((portion, index) => ({
      ...portion,
      share: index === 0 ? total : 0,
    }));
  }

  // Work in paisa so "one leftover unit" is an integer, not a float.
  const totalPaisa = Math.round(total * 100);
  const exact = weights.map((weight) => (totalPaisa * weight) / weightTotal);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = totalPaisa - floors.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    // Ties break on the earlier line, so the split is deterministic —
    // an auto-posted voucher must be reproducible, or a re-run of the
    // reconciliation sweep would produce a different document.
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const paisa = [...floors];
  for (const { index } of order) {
    if (remainder <= 0) break;
    paisa[index] += 1;
    remainder -= 1;
  }

  return portions.map((portion, index) => ({
    ...portion,
    share: money(paisa[index] / 100),
  }));
}

export interface PaymentPostingInput {
  amount: number;
  /** Account the money landed in (cash, bank, or a gateway clearing account). */
  fundsAccountId: string;
  /** The billed components of the invoice, fine included. */
  portions: BilledPortion[];
  /** feeHeadId → income account id. */
  headAccounts: Map<string, string>;
  /** Fallback income account for an unmapped head. */
  defaultIncomeAccountId: string;
  /** Income account for the fine portion. */
  fineIncomeAccountId: string;
}

/**
 * Dr funds / Cr income, one credit line per distinct income account.
 *
 * Lines are merged by account so a school that maps six fee heads to one
 * "Tuition Income" account gets one readable credit line rather than six
 * identical ones — and the merge happens AFTER allocation, so the exact
 * total is preserved.
 */
export function buildPaymentEntries(input: PaymentPostingInput): DraftEntry[] {
  const amount = money(input.amount);
  const shares = allocateAcrossHeads(amount, input.portions);

  const creditByAccount = new Map<
    string,
    { amount: number; labels: string[] }
  >();
  for (const share of shares) {
    if (share.share === 0) continue;
    const accountId =
      share.feeHeadId === null
        ? input.fineIncomeAccountId
        : (input.headAccounts.get(share.feeHeadId) ??
          input.defaultIncomeAccountId);
    const bucket = creditByAccount.get(accountId) ?? { amount: 0, labels: [] };
    bucket.amount = money(bucket.amount + share.share);
    bucket.labels.push(share.label);
    creditByAccount.set(accountId, bucket);
  }

  const credits: DraftEntry[] = [...creditByAccount.entries()].map(
    ([accountId, bucket]) => ({
      accountId,
      debit: 0,
      credit: bucket.amount,
      narration: bucket.labels.join(', ').slice(0, 300),
    }),
  );

  // If every portion rounded to nothing (an invoice of zero taking a
  // payment — possible with an adjustment), fall back to a single credit
  // so the voucher still balances instead of being silently one-sided.
  if (credits.length === 0 && amount > 0) {
    credits.push({
      accountId: input.defaultIncomeAccountId,
      debit: 0,
      credit: amount,
      narration: 'Fee receipt',
    });
  }

  return [
    { accountId: input.fundsAccountId, debit: amount, credit: 0 },
    ...credits,
  ];
}

/**
 * The gateway settlement entry (roadmap M20 §8): bKash pays out T+1 net
 * of its commission, so the clearing account holds the gross while the
 * bank receives the net, and the difference is a real expense the school
 * must recognise. Without this, the clearing account grows by the
 * commission every single day and nobody notices for a year.
 *
 *   Dr Bank            net
 *   Dr Gateway charges charges
 *     Cr Clearing      gross
 */
export function buildSettlementEntries(params: {
  clearingAccountId: string;
  bankAccountId: string;
  chargeAccountId: string;
  gross: number;
  charges: number;
}): DraftEntry[] {
  const gross = money(params.gross);
  const charges = money(params.charges);
  const net = money(gross - charges);

  const entries: DraftEntry[] = [
    {
      accountId: params.bankAccountId,
      debit: net,
      credit: 0,
      narration: 'Gateway settlement (net)',
    },
  ];
  if (charges > 0) {
    entries.push({
      accountId: params.chargeAccountId,
      debit: charges,
      credit: 0,
      narration: 'Gateway commission',
    });
  }
  entries.push({
    accountId: params.clearingAccountId,
    debit: 0,
    credit: gross,
    narration: 'Clearing account settled',
  });
  return entries;
}

/**
 * The opening-balance journal (roadmap M20 §8): a school adopting the
 * system mid-year types in what each account already holds, and the
 * difference between the debit and credit sides is by definition the
 * accumulated fund it started with — so it goes to the opening-equity
 * account rather than being refused. That balancing line is what makes a
 * partial, honestly-incomplete opening set postable at all.
 */
export function buildOpeningEntries(params: {
  lines: Array<{ accountId: string; debit: number; credit: number }>;
  equityAccountId: string;
}): DraftEntry[] {
  const entries: DraftEntry[] = params.lines
    .map((line) => ({
      accountId: line.accountId,
      debit: money(line.debit),
      credit: money(line.credit),
      narration: 'Opening balance',
    }))
    .filter((entry) => entry.debit > 0 || entry.credit > 0);

  const debits = entries.reduce((sum, entry) => money(sum + entry.debit), 0);
  const credits = entries.reduce((sum, entry) => money(sum + entry.credit), 0);
  const difference = money(debits - credits);

  if (difference !== 0) {
    entries.push({
      accountId: params.equityAccountId,
      debit: difference < 0 ? money(-difference) : 0,
      credit: difference > 0 ? difference : 0,
      narration: 'Accumulated fund brought forward',
    });
  }

  return entries;
}
