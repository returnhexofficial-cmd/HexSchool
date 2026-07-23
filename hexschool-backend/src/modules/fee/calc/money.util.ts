/**
 * Money arithmetic for the fee module.
 *
 * Every amount in this system is `NUMERIC(12,2)` BDT. JavaScript numbers
 * are binary floats, so `0.1 + 0.2 !== 0.3` and a long chain of
 * discounts drifts — which on an invoice means a `chk_invoices_payable`
 * violation, or worse, a bill that is off by a paisa and reconciles
 * against nothing.
 *
 * The rule here: **round to 2 decimals at every step**, not just at the
 * end. Two-decimal values are exactly representable well beyond any
 * school's fee scale, so rounding eagerly keeps every intermediate value
 * on the grid the database stores.
 *
 * Deliberately not a decimal library: `Prisma.Decimal` exists but drags
 * the client into the engines, and these must stay dependency-free and
 * golden-testable (PROJECT_CONTEXT §4).
 */

/** Round to 2 decimals, half away from zero — how a cashier rounds. */
export function money(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = value * 100;
  // Round the MAGNITUDE, then restore the sign — `Math.round` breaks ties
  // toward +∞, so rounding a negative directly gives -1.00 where a
  // cashier writes -1.01. The epsilon nudge is what stops
  // `1.005 * 100 = 100.49999999999999` from rounding down.
  const magnitude = Math.abs(scaled);
  const rounded = Math.round(magnitude + Number.EPSILON * magnitude);
  return (scaled < 0 ? -rounded : rounded) / 100;
}

/** Sum a list of amounts, rounding as it goes. */
export function sumMoney(values: number[]): number {
  return money(values.reduce((total, value) => total + money(value), 0));
}

/** `value` percent of `amount`, rounded to paisa. */
export function percentOf(amount: number, percent: number): number {
  return money((money(amount) * percent) / 100);
}

/** Clamp to [0, max] after rounding — a discount never exceeds its line. */
export function clampMoney(value: number, max: number): number {
  const rounded = money(value);
  if (rounded < 0) return 0;
  const ceiling = money(max);
  return rounded > ceiling ? ceiling : rounded;
}

/** True when two amounts are the same to the paisa. */
export function equalMoney(a: number, b: number): boolean {
  return money(a) === money(b);
}

/** Parse whatever Prisma handed back (Decimal | string | number). */
export function toMoney(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return money(Number(value));
}

/** `1234.5` → `"1,234.50"` — the format receipts and reports print. */
export function formatMoney(value: number): string {
  return money(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
