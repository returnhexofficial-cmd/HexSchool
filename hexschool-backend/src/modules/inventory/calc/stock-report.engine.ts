/**
 * The reports (roadmap M24 §4: "current stock (valuation FIFO-simple:
 * last price × qty — document simplification), item ledger, purchases by
 * supplier/period, asset register, warranty-expiring, consumption by
 * department").
 *
 * Dependency-free and golden-tested. The repositories fetch rows, this
 * file turns them into the numbers, and `InventoryExportService` writes
 * the same numbers into a spreadsheet — the M12 reports/export split, so
 * the sheet and the screen cannot disagree.
 *
 * **The valuation simplification, stated once.** Roadmap §4 asks for
 * "last price × qty" and calls it FIFO-simple. It is not FIFO: a school
 * that paid 300 for a ream in January and 380 in June values its whole
 * remaining stock at 380. Real FIFO needs a cost layer per receipt and a
 * consumption algorithm that walks them, which is a different module and
 * a different set of bugs. The figure here is honest about what it is —
 * *replacement* value at the last price paid — and the report labels it
 * so, because a valuation whose method nobody can state is worse than a
 * rough one whose method is on the page.
 */

import { qty } from './unit.util';

/** Money at the `NUMERIC(12,2)` contract — M16's rule, restated locally
 *  so this file stays dependency-free of FeeModule's types. */
function money(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

// ── current stock ────────────────────────────────────────────────────

export interface StockRow {
  itemId: string;
  itemCode: string;
  itemName: string;
  categoryId: string | null;
  categoryName: string | null;
  unit: string;
  type: string;
  balance: number;
  reorderLevel: number | null;
  lastUnitCost: number | null;
}

export interface ValuedStockRow extends StockRow {
  /** `balance × lastUnitCost`, or `null` when the item has never been
   *  bought through the system — a zero would understate the school's
   *  stock and look like a real number while doing it. */
  value: number | null;
  belowReorder: boolean;
}

export interface StockValuation {
  rows: ValuedStockRow[];
  /** Summed over the rows that HAVE a cost. */
  totalValue: number;
  /** How many rows could not be valued — printed beside the total, so a
   *  reader knows what the number does not include. */
  unvaluedItems: number;
  itemsInStock: number;
  belowReorder: number;
}

export function valueStock(rows: StockRow[]): StockValuation {
  const valued: ValuedStockRow[] = rows.map((row) => {
    const balance = qty(row.balance);
    const cost = row.lastUnitCost;
    return {
      ...row,
      balance,
      value: cost === null || cost === undefined ? null : money(balance * cost),
      belowReorder: isBelowReorder(balance, row.reorderLevel),
    };
  });

  return {
    rows: valued,
    totalValue: money(
      valued.reduce((total, row) => total + (row.value ?? 0), 0),
    ),
    unvaluedItems: valued.filter((row) => row.value === null && row.balance > 0)
      .length,
    itemsInStock: valued.filter((row) => row.balance > 0).length,
    belowReorder: valued.filter((row) => row.belowReorder).length,
  };
}

/**
 * Roadmap §4's low-stock trigger.
 *
 * `reorderLevel === null` means the school explicitly does not want to be
 * told about this item, which is **not** the same as a level of zero —
 * zero would alert on every empty shelf, and a store keeper who is
 * alerted about everything is alerted about nothing. The comparison is
 * `<=` rather than `<` because "we are down to our reorder level" is the
 * moment to reorder, not the moment after.
 */
export function isBelowReorder(
  balance: number,
  reorderLevel: number | null | undefined,
): boolean {
  if (reorderLevel === null || reorderLevel === undefined) return false;
  return qty(balance) <= qty(reorderLevel);
}

export interface LowStockRow extends StockRow {
  shortfall: number;
}

/** The alert list and the dashboard widget read the SAME function, so the
 *  badge count and the email cannot disagree (the M25 alerts rule). */
export function lowStockRows(rows: StockRow[]): LowStockRow[] {
  return rows
    .filter((row) => isBelowReorder(row.balance, row.reorderLevel))
    .map((row) => ({
      ...row,
      shortfall: qty((row.reorderLevel ?? 0) - row.balance),
    }))
    .sort(
      (a, b) =>
        b.shortfall - a.shortfall || a.itemName.localeCompare(b.itemName),
    );
}

// ── consumption ──────────────────────────────────────────────────────

export interface ConsumptionInput {
  /** Holder label — a department name, a person's name, a room. */
  holder: string;
  holderKey: string;
  itemId: string;
  itemName: string;
  /** Base units that went OUT, net of returns. */
  quantity: number;
  /** Per base unit at issue time; `null` when the item was never costed. */
  unitCost: number | null;
}

export interface ConsumptionGroup {
  holderKey: string;
  holder: string;
  quantity: number;
  value: number;
  items: Array<{
    itemId: string;
    itemName: string;
    quantity: number;
    value: number;
  }>;
}

/**
 * "Consumption by department" (roadmap §4).
 *
 * **Net of returns**, which is the whole reason the caller passes a
 * signed quantity: a department that took twenty reams and sent eight
 * back consumed twelve, and a report that says twenty is one a head of
 * department will (correctly) refuse to accept. Rows that net to zero are
 * dropped — they describe a mistake that was corrected, not a
 * consumption.
 */
export function consumptionByHolder(
  rows: ConsumptionInput[],
): ConsumptionGroup[] {
  const groups = new Map<string, ConsumptionGroup>();

  for (const row of rows) {
    const group = groups.get(row.holderKey) ?? {
      holderKey: row.holderKey,
      holder: row.holder,
      quantity: 0,
      value: 0,
      items: [],
    };

    const value = money(row.quantity * (row.unitCost ?? 0));
    const existing = group.items.find((item) => item.itemId === row.itemId);
    if (existing) {
      existing.quantity = qty(existing.quantity + row.quantity);
      existing.value = money(existing.value + value);
    } else {
      group.items.push({
        itemId: row.itemId,
        itemName: row.itemName,
        quantity: qty(row.quantity),
        value,
      });
    }

    group.quantity = qty(group.quantity + row.quantity);
    group.value = money(group.value + value);
    groups.set(row.holderKey, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => item.quantity !== 0)
        .sort((a, b) => b.quantity - a.quantity),
    }))
    .filter((group) => group.quantity !== 0)
    .sort((a, b) => b.value - a.value || b.quantity - a.quantity);
}

// ── purchases ────────────────────────────────────────────────────────

export interface PurchaseRow {
  supplierId: string | null;
  supplierName: string;
  purchaseId: string;
  purchaseNo: string;
  date: string;
  total: number;
  status: string;
}

export interface SupplierSpend {
  supplierId: string | null;
  supplierName: string;
  purchases: number;
  total: number;
}

export interface PurchaseSummary {
  bySupplier: SupplierSpend[];
  byMonth: Array<{ month: string; purchases: number; total: number }>;
  total: number;
  purchases: number;
}

/**
 * "Purchases by supplier / period" (roadmap §4).
 *
 * The caller filters to RECEIVED rows before this sees them: a DRAFT is
 * something somebody is still typing and a CANCELLED one is a delivery
 * that did not happen, and counting either as spending would make the
 * report disagree with the ledger it is supposed to explain — the M20
 * lesson about a status that means "superseded" rather than "never
 * happened", read from the other side.
 *
 * The monthly series emits a row only for months that had a purchase.
 * Unlike M25's expense chart (which emits a zero for a quiet month,
 * because a fleet costs money every month and a gap would read as missing
 * data), a school buys furniture twice a year and a run of zeroes would
 * be noise.
 */
export function summarizePurchases(rows: PurchaseRow[]): PurchaseSummary {
  const bySupplier = new Map<string, SupplierSpend>();
  const byMonth = new Map<
    string,
    { month: string; purchases: number; total: number }
  >();
  let total = 0;

  for (const row of rows) {
    const key = row.supplierId ?? '';
    const supplier = bySupplier.get(key) ?? {
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      purchases: 0,
      total: 0,
    };
    supplier.purchases += 1;
    supplier.total = money(supplier.total + row.total);
    bySupplier.set(key, supplier);

    const month = row.date.slice(0, 7);
    const bucket = byMonth.get(month) ?? { month, purchases: 0, total: 0 };
    bucket.purchases += 1;
    bucket.total = money(bucket.total + row.total);
    byMonth.set(month, bucket);

    total = money(total + row.total);
  }

  return {
    bySupplier: [...bySupplier.values()].sort((a, b) => b.total - a.total),
    byMonth: [...byMonth.values()].sort((a, b) =>
      a.month.localeCompare(b.month),
    ),
    total,
    purchases: rows.length,
  };
}

// ── purchase arithmetic ──────────────────────────────────────────────

export interface PurchaseLineInput {
  qty: number;
  unitPrice: number;
}

/**
 * A purchase's total from its lines.
 *
 * This is the number `chk_purchases_status_evidence` cannot check, for
 * the M20 reason: a CHECK sees one row and the total sums its children.
 * So the service recomputes it on every line change and this function is
 * what the golden tests pin — which is exactly the split M20 made for
 * Σdebit = Σcredit, one ledger over.
 */
export function purchaseTotal(lines: PurchaseLineInput[]): number {
  return money(
    lines.reduce((total, line) => total + money(line.qty * line.unitPrice), 0),
  );
}

// ── stock take (roadmap §8) ──────────────────────────────────────────

export interface CountSheetRow {
  itemId: string;
  itemName: string;
  itemCode: string;
  unit: string;
  expected: number;
  counted: number;
}

export interface CountDiff extends CountSheetRow {
  difference: number;
  direction: 'IN' | 'OUT';
}

/**
 * Roadmap §8's "physical count mismatch → bulk adjustment wizard from
 * count sheet import".
 *
 * Rows that match are dropped: an adjustment of zero is a ledger row
 * saying nothing happened, and a stock take of four hundred items would
 * otherwise bury the eleven real differences under them. The direction is
 * derived rather than passed, because a count sheet says what is on the
 * shelf and the *ledger* is what decides whether that is a gain or a
 * loss.
 */
export function countSheetDiff(rows: CountSheetRow[]): CountDiff[] {
  return rows
    .map((row): CountDiff => {
      const difference = qty(row.counted - row.expected);
      return {
        ...row,
        expected: qty(row.expected),
        counted: qty(row.counted),
        difference,
        direction: difference > 0 ? 'IN' : 'OUT',
      };
    })
    .filter((row) => row.difference !== 0)
    .map((row) => ({ ...row, difference: Math.abs(row.difference) }))
    .sort((a, b) => b.difference - a.difference);
}
