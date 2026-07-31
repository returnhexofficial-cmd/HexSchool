/**
 * What the fleet costs (roadmap M25 §4 "vehicle expense summary (per km
 * if odometer)").
 *
 * Dependency-free and golden-tested; reuses M16's `money.util` like every
 * other money engine in this codebase.
 *
 * The interesting part is the per-kilometre figure, and it is interesting
 * because the obvious implementation is wrong in a way that looks right:
 *
 *   - **Distance comes from the gaps between readings, not from the
 *     readings themselves.** `max − min` over a vehicle's whole history
 *     silently includes kilometres covered before the first receipt was
 *     entered, so the cost per km comes out too low, which is the
 *     direction that makes a school keep an expensive bus.
 *   - **A reading that goes backwards breaks the chain rather than
 *     producing a negative distance.** Odometers are re-entered wrongly,
 *     replaced, and roll over; one typo must not turn a 12,000 km year
 *     into a negative one.
 *   - **Only FUEL drives it.** A gearbox rebuild is not a running cost,
 *     and dividing it across the same kilometres would make the figure
 *     jump the month it happened. Both figures are returned so a report
 *     can print either.
 */

import { money, sumMoney } from '../../fee/calc/money.util';

export type ExpenseKind = 'FUEL' | 'MAINTENANCE' | 'REPAIR' | 'TOLL' | 'OTHER';

export interface ExpenseRow {
  /** `YYYY-MM-DD`. */
  date: string;
  type: ExpenseKind;
  amount: number;
  /** Kilometres on the clock when it was spent; `null` when not recorded. */
  odometer: number | null;
  vehicleId?: string;
}

export interface ExpenseTypeTotal {
  type: ExpenseKind;
  total: number;
  count: number;
  /** Percentage of the whole, one decimal. */
  share: number;
}

export interface DistanceResult {
  /** Kilometres covered between consecutive readings. */
  km: number;
  /** Readings that were used (a chain of N gives N−1 gaps). */
  readings: number;
  /** Gaps dropped because the odometer went backwards. */
  brokenChains: number;
}

/**
 * Distance from a list of readings. Readings are sorted by date, then by
 * value, so two receipts on the same day compare in the order the bus
 * actually drove.
 */
export function distanceCovered(rows: ExpenseRow[]): DistanceResult {
  const readings = rows
    .filter((row) => row.odometer !== null && Number.isFinite(row.odometer))
    .map((row) => ({ date: row.date, odometer: row.odometer as number }))
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.odometer - b.odometer,
    );

  let km = 0;
  let brokenChains = 0;
  for (let i = 1; i < readings.length; i++) {
    const gap = readings[i].odometer - readings[i - 1].odometer;
    if (gap < 0) {
      brokenChains++;
      continue;
    }
    km += gap;
  }
  return { km, readings: readings.length, brokenChains };
}

export interface ExpenseSummary {
  total: number;
  count: number;
  byType: ExpenseTypeTotal[];
  fuelTotal: number;
  distance: DistanceResult;
  /** Fuel cost ÷ km; `null` with fewer than two usable readings. */
  fuelCostPerKm: number | null;
  /** Everything ÷ km, for the "what does this bus really cost" line. */
  totalCostPerKm: number | null;
}

const KINDS: ExpenseKind[] = ['FUEL', 'MAINTENANCE', 'REPAIR', 'TOLL', 'OTHER'];

export function summarizeExpenses(rows: ExpenseRow[]): ExpenseSummary {
  const total = sumMoney(rows.map((row) => row.amount));
  const distance = distanceCovered(rows);

  const byType: ExpenseTypeTotal[] = KINDS.map((type) => {
    const matching = rows.filter((row) => row.type === type);
    const typeTotal = sumMoney(matching.map((row) => row.amount));
    return {
      type,
      total: typeTotal,
      count: matching.length,
      share: total === 0 ? 0 : Math.round((typeTotal / total) * 1000) / 10,
    };
  }).filter((row) => row.count > 0);

  const fuelTotal = sumMoney(
    rows.filter((row) => row.type === 'FUEL').map((row) => row.amount),
  );

  // Two readings are the minimum that describe a distance; one reading
  // describes a moment.
  const measurable = distance.readings >= 2 && distance.km > 0;

  return {
    total,
    count: rows.length,
    byType,
    fuelTotal,
    distance,
    fuelCostPerKm: measurable ? money(fuelTotal / distance.km) : null,
    totalCostPerKm: measurable ? money(total / distance.km) : null,
  };
}

export interface MonthlyExpensePoint {
  /** `YYYY-MM`. */
  month: string;
  total: number;
  fuel: number;
  count: number;
}

/**
 * The monthly series the expense chart plots. **Months with no spending
 * are emitted as zero rows** when a range is given — the inverse of the
 * M18 attendance rule, and for the opposite reason: an unmarked
 * attendance day is *unknown*, while a month with no fuel receipts is a
 * month the school genuinely spent nothing, and dropping it would draw a
 * line straight over a gap that means something.
 */
export function monthlySeries(
  rows: ExpenseRow[],
  range?: { from: string; to: string },
): MonthlyExpensePoint[] {
  const buckets = new Map<string, MonthlyExpensePoint>();

  const ensure = (month: string) => {
    if (!buckets.has(month)) {
      buckets.set(month, { month, total: 0, fuel: 0, count: 0 });
    }
    return buckets.get(month)!;
  };

  if (range) {
    for (const month of monthsBetween(range.from, range.to)) ensure(month);
  }

  for (const row of rows) {
    const month = row.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const bucket = ensure(month);
    bucket.total = money(bucket.total + money(row.amount));
    if (row.type === 'FUEL')
      bucket.fuel = money(bucket.fuel + money(row.amount));
    bucket.count++;
  }

  return [...buckets.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}

/** Inclusive `YYYY-MM` list between two `YYYY-MM(-DD)` bounds. */
export function monthsBetween(from: string, to: string): string[] {
  const start = from.slice(0, 7);
  const end = to.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end)) return [];
  if (start > end) return [];

  const months: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  // A hard stop: a mis-typed range must not spin for ever.
  for (let guard = 0; guard < 600; guard++) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    months.push(key);
    if (key === end) break;
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return months;
}
