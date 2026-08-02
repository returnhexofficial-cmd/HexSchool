/**
 * Quantities (roadmap M24 §7 "qty > 0 integers, or 3-decimal for
 * LITER/KG", §8 "item bought in BOX issued in PCS → conversion factor on
 * the item, ledger normalized to base unit").
 *
 * Dependency-free and golden-tested. It exists because **the ledger only
 * ever speaks base units**, and every path into the ledger — a purchase
 * entered in boxes, an issue typed in pieces, a stock-count correction —
 * has to arrive there through the same conversion. Doing that
 * multiplication at three call sites is how a school ends up with 4 in a
 * column that means 48.
 *
 * The other half is precision. Stock is `NUMERIC(14,3)`, so a quantity
 * that carries more than three decimals is not a rounding preference —
 * Postgres will round it on the way in and the balance the service just
 * computed will disagree with the balance the database stored. Every
 * quantity leaving this file is already at the column's precision.
 */

import type { StockUnit } from './types';

/** The `NUMERIC(14,3)` contract. */
export const QTY_SCALE = 3;
const QTY_FACTOR = 10 ** QTY_SCALE;

/**
 * Units measured by weight or volume, and therefore the only ones a
 * fractional quantity makes sense for. Half a litre of phenyl is a real
 * issue slip; half a chair is a data-entry error, and roadmap §7 draws
 * exactly that line.
 */
const FRACTIONAL_UNITS: ReadonlySet<StockUnit> = new Set<StockUnit>([
  'LITER',
  'KG',
]);

export function allowsFraction(unit: StockUnit): boolean {
  return FRACTIONAL_UNITS.has(unit);
}

/**
 * Round to the column's scale. Uses the ×1000 / round / ÷1000 detour
 * rather than `toFixed`, because `toFixed` is a string round-trip and
 * the M16 `money.util` house style is arithmetic.
 *
 * `Math.round` on the scaled value gives half-up, which matches
 * Postgres's `NUMERIC` rounding for positive quantities — and quantities
 * here are never negative (the ledger's one-sided CHECK sees to that).
 */
export function qty(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * QTY_FACTOR) / QTY_FACTOR;
}

/** Sum a list at the column's precision, rounding once at the end. */
export function qtySum(values: number[]): number {
  return qty(values.reduce((total, value) => total + value, 0));
}

export interface QtyProblem {
  ok: false;
  reason: string;
}
export interface QtyOk {
  ok: true;
  qty: number;
}
export type QtyVerdict = QtyOk | QtyProblem;

/**
 * Is this a quantity the school can actually record for this item?
 *
 * Returns the *normalized* value on success rather than a boolean, so a
 * caller cannot validate one number and then store a different one — the
 * same reason `canIssue` (M23) and `capacityVerdict` (M25) return the
 * decision rather than a flag.
 */
export function validateQty(value: number, unit: StockUnit): QtyVerdict {
  if (!Number.isFinite(value)) {
    return { ok: false, reason: 'Quantity must be a number.' };
  }
  if (value <= 0) {
    return { ok: false, reason: 'Quantity must be greater than zero.' };
  }

  const rounded = qty(value);
  if (rounded !== value) {
    return {
      ok: false,
      reason: `Quantity may carry at most ${QTY_SCALE} decimal places.`,
    };
  }
  if (!allowsFraction(unit) && !Number.isInteger(rounded)) {
    return {
      ok: false,
      reason: `${unit} is counted in whole units — ${rounded} is not a quantity the store can hand over.`,
    };
  }
  return { ok: true, qty: rounded };
}

/**
 * §8's conversion, in one place. `packSize` is how many BASE units are in
 * one pack; `null` (and, defensively, a non-positive value a hand-edited
 * row could carry) means the item has no pack and the two are the same.
 *
 * The defensive branch matters more than it looks: a `packSize` of 0
 * would make a purchase of four boxes arrive as nothing, and the school
 * would find out at the next stock-take rather than at the keyboard.
 */
export function toBaseQty(
  enteredQty: number,
  packSize?: number | null,
): number {
  const factor = packSize && packSize > 0 ? packSize : 1;
  return qty(enteredQty * factor);
}

/** The inverse, for showing a base balance in the unit a clerk buys in. */
export function toPackQty(baseQty: number, packSize?: number | null): number {
  const factor = packSize && packSize > 0 ? packSize : 1;
  return qty(baseQty / factor);
}

/**
 * Per-base-unit cost from a purchase line. The line's `unitPrice` is per
 * *entered* unit (what the supplier's invoice says), so a box of 12 pens
 * at 240 BDT costs 20 per pen — and 20 is the number the valuation report
 * and the consumption report both need, because both count pens.
 *
 * Kept at four decimals (`NUMERIC(12,4)`, unlike money's two) because
 * dividing a two-decimal price by a pack of 12 or 500 produces a real
 * fraction, and rounding it to paisa here would make a ream of paper
 * valued at 500 × 0.30 disagree with the 150 that was actually paid.
 */
export function unitCostPerBase(
  unitPrice: number,
  packSize?: number | null,
): number {
  const factor = packSize && packSize > 0 ? packSize : 1;
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return 0;
  return Math.round((unitPrice / factor) * 10_000) / 10_000;
}

/**
 * How a quantity reads on a screen or a printed slip: trailing zeros
 * dropped, because "12" is what a store keeper wrote in the register and
 * "12.000" is what a database column looks like.
 */
export function formatQty(value: number, unit?: StockUnit): string {
  const rounded = qty(value);
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : String(rounded).replace(/0+$/, '').replace(/\.$/, '');
  return unit ? `${text} ${unit}` : text;
}
