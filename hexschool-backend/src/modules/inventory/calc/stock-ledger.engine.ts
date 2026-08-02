/**
 * The stock ledger (roadmap M24 §3, §6 "the ledger is the source of
 * truth; stock balance is never edited directly"; §9 "unit: ledger
 * balance math incl. adjustments/reversals").
 *
 * Dependency-free and golden-tested. Every movement in the module — a
 * receipt, an issue, a return, a count correction, a disposal — becomes a
 * row here, and this file is the arithmetic that decides what the row
 * says. Nothing in the module may compute a balance any other way, which
 * is the property that makes "how did we get to 12 reams" answerable at
 * all.
 *
 * Three decisions live here and are worth stating, because each one has
 * an obvious wrong alternative:
 *
 *  1. **A movement is one-sided.** `qtyIn` or `qtyOut`, never both, never
 *     a signed `qty`. A signed column reads fine until somebody writes
 *     −5 with `txn = 'PURCHASE'` and the purchase report starts
 *     subtracting. The M20 `chk_voucher_entries_one_sided` shape, applied
 *     to things instead of money.
 *  2. **`balanceAfter` is stored, not derived on read.** Summing the
 *     whole history on every screen is the obvious implementation and it
 *     gets slower every term; worse, it makes an item ledger unable to
 *     show a running balance beside each row without an O(n²) scan. The
 *     cost is that the writer must hold a lock — see `StockService`.
 *  3. **An ADJUST is expressed as the movement it implies, not as a new
 *     balance.** A stock count that finds 8 where the ledger says 12
 *     writes `qtyOut: 4`, not `balance: 8`. That keeps every row a
 *     *movement*, so the column always adds up, and it is what makes
 *     roadmap §8's count-sheet wizard a list of differences rather than a
 *     list of overwrites.
 */

import type { StockTxn } from './types';
import { qty } from './unit.util';

/** Which direction each transaction type moves stock. */
const INBOUND: ReadonlySet<StockTxn> = new Set<StockTxn>([
  'PURCHASE',
  'RETURN',
]);
const OUTBOUND: ReadonlySet<StockTxn> = new Set<StockTxn>(['ISSUE', 'DISPOSE']);

/**
 * ADJUST is the only type that can go either way — it is the stock-take
 * correction, and a count can find more than the ledger expected as
 * easily as less (a delivery somebody forgot to receive).
 */
export function isAdjustment(txn: StockTxn): boolean {
  return txn === 'ADJUST';
}

export interface MovementInput {
  txn: StockTxn;
  /** Base units, always positive. Direction comes from `txn`. */
  quantity: number;
  /** Only meaningful for ADJUST, where the sign is the caller's. */
  direction?: 'IN' | 'OUT';
}

export interface Movement {
  txn: StockTxn;
  qtyIn: number;
  qtyOut: number;
}

export interface MovementError {
  ok: false;
  reason: string;
}
export interface MovementOk {
  ok: true;
  movement: Movement;
  balanceAfter: number;
}
export type MovementVerdict = MovementOk | MovementError;

/**
 * Turn "issue 5 reams" into the row the ledger stores, against the
 * balance that is there right now.
 *
 * **This is the single verdict** every write path funnels through — the
 * M16 `deriveStatus` / M23 `canIssue` / M25 `capacityVerdict` rule. The
 * issue desk's preview, the issue endpoint and the adjustment wizard all
 * call it, so a greyed button, a 409 and a warning banner are three
 * renderings of one answer rather than three implementations that will
 * eventually disagree.
 *
 * Going below zero is refused here **and** by `chk_stock_ledger_one_sided`
 * at the database. That is not belt-and-braces for its own sake: the
 * service can say *why* ("only 3 reams on hand"), and the CHECK is what
 * holds when a future write path forgets to ask.
 */
export function applyMovement(
  balance: number,
  input: MovementInput,
): MovementVerdict {
  const quantity = qty(input.quantity);
  if (!(quantity > 0)) {
    return { ok: false, reason: 'Quantity must be greater than zero.' };
  }

  const current = qty(balance);
  const direction = movementDirection(input);
  if (!direction) {
    return {
      ok: false,
      reason: 'An adjustment must say whether stock went up or down.',
    };
  }

  if (direction === 'IN') {
    return {
      ok: true,
      movement: { txn: input.txn, qtyIn: quantity, qtyOut: 0 },
      balanceAfter: qty(current + quantity),
    };
  }

  if (quantity > current) {
    return {
      ok: false,
      reason: `Only ${qty(current)} in stock — ${quantity} cannot go out.`,
    };
  }
  return {
    ok: true,
    movement: { txn: input.txn, qtyIn: 0, qtyOut: quantity },
    balanceAfter: qty(current - quantity),
  };
}

function movementDirection(input: MovementInput): 'IN' | 'OUT' | null {
  if (INBOUND.has(input.txn)) return 'IN';
  if (OUTBOUND.has(input.txn)) return 'OUT';
  // ADJUST — the caller decides, because only they know what the count
  // sheet said.
  return input.direction ?? null;
}

export interface LedgerRow {
  qtyIn: number;
  qtyOut: number;
}

/**
 * Replay a history from zero. Used by the verification path and by the
 * tests, never on a hot read — the stored `balanceAfter` is what the
 * screens use.
 *
 * Its real job is to be the **second opinion**: if a replay ever
 * disagrees with the last row's stored balance, a writer somewhere
 * skipped the lock, and that is a defect worth failing loudly over rather
 * than a number worth quietly preferring.
 */
export function replayBalance(rows: LedgerRow[]): number {
  return qty(
    rows.reduce((balance, row) => balance + row.qtyIn - row.qtyOut, 0),
  );
}

export interface LedgerLine extends LedgerRow {
  balanceAfter: number;
}

/**
 * Does the stored running balance agree with the movements beside it?
 * Returns the first row where it does not, so the message can name it.
 */
export function findBalanceBreak(rows: LedgerLine[]): number | null {
  let running = 0;
  for (let index = 0; index < rows.length; index++) {
    running = qty(running + rows[index].qtyIn - rows[index].qtyOut);
    if (running !== qty(rows[index].balanceAfter)) return index;
  }
  return null;
}

/**
 * The reversal of a received purchase (roadmap §6: "purchase RECEIVED is
 * immutable — cancel = reversal entries").
 *
 * A cancellation writes ADJUST-out rows rather than deleting the PURCHASE
 * rows, for the M20 reason: the delivery *happened*, and a ledger that
 * can be made to forget it is not a ledger. It also means the reversal
 * hits the same non-negative CHECK as everything else — which is the
 * correct behaviour, because a school that has already issued the paper
 * it is now trying to un-receive genuinely cannot un-receive it, and
 * finding that out is the point.
 */
export interface ReversalLine {
  itemId: string;
  baseQty: number;
}

export function reversalMovements(
  lines: ReversalLine[],
): Array<{ itemId: string; input: MovementInput }> {
  return lines
    .filter((line) => qty(line.baseQty) > 0)
    .map((line) => ({
      itemId: line.itemId,
      input: {
        txn: 'ADJUST' as const,
        quantity: qty(line.baseQty),
        direction: 'OUT' as const,
      },
    }));
}

/** What a movement points at, so the register can drill through. */
export interface MovementRef {
  refType: string;
  refId: string;
}

export const REF_TYPES = {
  PURCHASE: 'PURCHASE',
  ISSUE: 'ISSUE',
  RETURN: 'RETURN',
  ADJUSTMENT: 'ADJUSTMENT',
  ASSET: 'ASSET',
} as const;
