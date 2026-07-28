import { money } from '../../fee/calc/money.util';
import { naturalSide, signedMovement } from './voucher.engine';

/**
 * Running-balance arithmetic (roadmap M20 §4 "General Ledger (per
 * account, running balance)"), dependency-free.
 *
 * The subtlety this engine exists to contain: **a balance has a side.**
 * A cash account 5,000 in hand is `5000 DEBIT`; a loan of 5,000 owed is
 * `5000 CREDIT`. Both are positive numbers that mean opposite things, and
 * carrying them as a bare signed number is how a ledger ends up printing
 * a negative liability. Every balance here is a `{ amount, side }` pair,
 * and the ledger row keeps both so the UI never has to guess.
 */

export interface LedgerMovement {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  voucherId: string;
  voucherNo: string;
  voucherType: string;
  narration: string;
  reference?: string | null;
  /** The other accounts on the voucher — "particulars" in a paper ledger. */
  contra?: string[];
  debit: number;
  credit: number;
}

export interface LedgerRow extends LedgerMovement {
  /** Running balance AFTER this movement, in the account's own direction. */
  balance: number;
  balanceSide: 'DEBIT' | 'CREDIT';
}

export interface LedgerResult {
  openingBalance: number;
  openingSide: 'DEBIT' | 'CREDIT';
  rows: LedgerRow[];
  debitTotal: number;
  creditTotal: number;
  closingBalance: number;
  closingSide: 'DEBIT' | 'CREDIT';
}

/**
 * Present a signed movement (positive = the account's natural side) as an
 * amount plus the side it actually sits on. A debit-normal account driven
 * negative is reported as a CREDIT balance, which is what a bank overdraft
 * genuinely is.
 */
export function asSidedBalance(
  group: string,
  signed: number,
): { amount: number; side: 'DEBIT' | 'CREDIT' } {
  const natural = naturalSide(group);
  const rounded = money(signed);
  if (rounded >= 0) return { amount: rounded, side: natural };
  return {
    amount: money(-rounded),
    side: natural === 'DEBIT' ? 'CREDIT' : 'DEBIT',
  };
}

/**
 * Build the ledger for one account.
 *
 * `opening` is the account's own `opening_balance` PLUS every movement
 * before the window — the caller supplies it already signed in the
 * account's natural direction, because that sum is a database question,
 * not an arithmetic one.
 */
export function buildLedger(params: {
  group: string;
  opening: number;
  movements: LedgerMovement[];
}): LedgerResult {
  const opening = asSidedBalance(params.group, params.opening);

  let running = money(params.opening);
  let debits = 0;
  let credits = 0;

  const rows: LedgerRow[] = params.movements.map((movement) => {
    debits = money(debits + movement.debit);
    credits = money(credits + movement.credit);
    running = money(
      running + signedMovement(params.group, movement.debit, movement.credit),
    );
    const sided = asSidedBalance(params.group, running);
    return {
      ...movement,
      debit: money(movement.debit),
      credit: money(movement.credit),
      balance: sided.amount,
      balanceSide: sided.side,
    };
  });

  const closing = asSidedBalance(params.group, running);

  return {
    openingBalance: opening.amount,
    openingSide: opening.side,
    rows,
    debitTotal: debits,
    creditTotal: credits,
    closingBalance: closing.amount,
    closingSide: closing.side,
  };
}

/**
 * Cash/bank book shape: the same movements, but a book keeps *receipts*
 * and *payments* rather than debits and credits, because that is the
 * language of the column headings a cashier actually reads. For a
 * debit-normal funds account a debit IS a receipt.
 */
export interface BookRow {
  date: string;
  voucherNo: string;
  narration: string;
  particulars: string;
  receipt: number;
  payment: number;
  balance: number;
}

export function buildBook(params: {
  opening: number;
  movements: LedgerMovement[];
}): {
  openingBalance: number;
  rows: BookRow[];
  receiptTotal: number;
  paymentTotal: number;
  closingBalance: number;
} {
  let running = money(params.opening);
  let receipts = 0;
  let payments = 0;

  const rows: BookRow[] = params.movements.map((movement) => {
    const receipt = money(movement.debit);
    const payment = money(movement.credit);
    receipts = money(receipts + receipt);
    payments = money(payments + payment);
    running = money(running + receipt - payment);
    return {
      date: movement.date,
      voucherNo: movement.voucherNo,
      narration: movement.narration,
      particulars: (movement.contra ?? []).join(', '),
      receipt,
      payment,
      balance: running,
    };
  });

  return {
    openingBalance: money(params.opening),
    rows,
    receiptTotal: receipts,
    paymentTotal: payments,
    closingBalance: running,
  };
}
