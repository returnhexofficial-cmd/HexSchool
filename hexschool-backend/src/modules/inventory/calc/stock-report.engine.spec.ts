import {
  consumptionByHolder,
  countSheetDiff,
  isBelowReorder,
  lowStockRows,
  purchaseTotal,
  summarizePurchases,
  valueStock,
  type StockRow,
} from './stock-report.engine';

const stock = (over: Partial<StockRow> = {}): StockRow => ({
  itemId: 'i1',
  itemCode: 'STA-001',
  itemName: 'A4 Paper',
  categoryId: 'c1',
  categoryName: 'Stationery',
  unit: 'REAM',
  type: 'CONSUMABLE',
  balance: 20,
  reorderLevel: 10,
  lastUnitCost: 300,
  ...over,
});

describe('stock-report.engine', () => {
  describe('valueStock — the documented "last price × qty" simplification', () => {
    it('values a row at the last price paid', () => {
      const report = valueStock([stock({ balance: 20, lastUnitCost: 300 })]);
      expect(report.rows[0].value).toBe(6000);
      expect(report.totalValue).toBe(6000);
    });

    it('values the WHOLE balance at the latest price, not per receipt', () => {
      // This is the simplification, stated as a test: a school that paid
      // 300 in January and 380 in June values everything at 380. Real FIFO
      // needs a cost layer per receipt.
      const report = valueStock([stock({ balance: 10, lastUnitCost: 380 })]);
      expect(report.totalValue).toBe(3800);
    });

    it('leaves an uncosted item null rather than zero, and counts it', () => {
      // A zero would understate the school's stock while looking like a
      // real number.
      const report = valueStock([
        stock({ itemId: 'i1', lastUnitCost: null, balance: 5 }),
        stock({ itemId: 'i2', lastUnitCost: 100, balance: 2 }),
      ]);
      expect(report.rows[0].value).toBeNull();
      expect(report.totalValue).toBe(200);
      expect(report.unvaluedItems).toBe(1);
    });

    it('does not count an uncosted item with no stock as unvalued', () => {
      const report = valueStock([stock({ lastUnitCost: null, balance: 0 })]);
      expect(report.unvaluedItems).toBe(0);
    });

    it('counts items in stock and items below reorder', () => {
      const report = valueStock([
        stock({ itemId: 'i1', balance: 20, reorderLevel: 10 }),
        stock({ itemId: 'i2', balance: 5, reorderLevel: 10 }),
        stock({ itemId: 'i3', balance: 0, reorderLevel: 10 }),
      ]);
      expect(report.itemsInStock).toBe(2);
      expect(report.belowReorder).toBe(2);
    });

    it('keeps money at two decimals', () => {
      const report = valueStock([stock({ balance: 3, lastUnitCost: 33.3333 })]);
      expect(report.rows[0].value).toBe(100);
    });
  });

  describe('isBelowReorder', () => {
    it('triggers AT the reorder level, not one below it', () => {
      expect(isBelowReorder(10, 10)).toBe(true);
      expect(isBelowReorder(11, 10)).toBe(false);
      expect(isBelowReorder(9, 10)).toBe(true);
    });

    it('**null is "do not tell me", which is not the same as zero**', () => {
      // A reorder level of 0 alerts on every empty shelf, and a store
      // keeper alerted about everything is alerted about nothing.
      expect(isBelowReorder(0, null)).toBe(false);
      expect(isBelowReorder(0, undefined)).toBe(false);
      expect(isBelowReorder(0, 0)).toBe(true);
    });
  });

  describe('lowStockRows', () => {
    it('lists only items at or below their level, biggest shortfall first', () => {
      const rows = lowStockRows([
        stock({
          itemId: 'i1',
          itemName: 'Paper',
          balance: 8,
          reorderLevel: 10,
        }),
        stock({
          itemId: 'i2',
          itemName: 'Chalk',
          balance: 1,
          reorderLevel: 50,
        }),
        stock({
          itemId: 'i3',
          itemName: 'Pens',
          balance: 99,
          reorderLevel: 10,
        }),
        stock({
          itemId: 'i4',
          itemName: 'Ink',
          balance: 0,
          reorderLevel: null,
        }),
      ]);
      expect(rows.map((r) => r.itemName)).toEqual(['Chalk', 'Paper']);
      expect(rows[0].shortfall).toBe(49);
      expect(rows[1].shortfall).toBe(2);
    });

    it('breaks a shortfall tie by name, so the list is stable', () => {
      const rows = lowStockRows([
        stock({ itemId: 'i1', itemName: 'Zinc', balance: 5, reorderLevel: 10 }),
        stock({ itemId: 'i2', itemName: 'Acid', balance: 5, reorderLevel: 10 }),
      ]);
      expect(rows.map((r) => r.itemName)).toEqual(['Acid', 'Zinc']);
    });
  });

  describe('consumptionByHolder', () => {
    it('groups by holder and totals quantity and value', () => {
      const groups = consumptionByHolder([
        {
          holderKey: 'd1',
          holder: 'Science',
          itemId: 'i1',
          itemName: 'Paper',
          quantity: 10,
          unitCost: 300,
        },
        {
          holderKey: 'd1',
          holder: 'Science',
          itemId: 'i2',
          itemName: 'Chalk',
          quantity: 20,
          unitCost: 5,
        },
      ]);
      expect(groups).toHaveLength(1);
      expect(groups[0].quantity).toBe(30);
      expect(groups[0].value).toBe(3100);
      expect(groups[0].items).toHaveLength(2);
    });

    it('**nets returns off consumption**', () => {
      // A department that took twenty reams and sent eight back consumed
      // twelve; a report that says twenty is one a head of department
      // will correctly refuse to accept.
      const groups = consumptionByHolder([
        {
          holderKey: 'd1',
          holder: 'Science',
          itemId: 'i1',
          itemName: 'Paper',
          quantity: 20,
          unitCost: 300,
        },
        {
          holderKey: 'd1',
          holder: 'Science',
          itemId: 'i1',
          itemName: 'Paper',
          quantity: -8,
          unitCost: 300,
        },
      ]);
      expect(groups[0].quantity).toBe(12);
      expect(groups[0].value).toBe(3600);
      expect(groups[0].items[0].quantity).toBe(12);
    });

    it('drops a holder whose issues all came back', () => {
      const groups = consumptionByHolder([
        {
          holderKey: 'd1',
          holder: 'Science',
          itemId: 'i1',
          itemName: 'Paper',
          quantity: 5,
          unitCost: 100,
        },
        {
          holderKey: 'd1',
          holder: 'Science',
          itemId: 'i1',
          itemName: 'Paper',
          quantity: -5,
          unitCost: 100,
        },
      ]);
      expect(groups).toEqual([]);
    });

    it('treats an uncosted item as zero value without dropping its quantity', () => {
      const groups = consumptionByHolder([
        {
          holderKey: 'd1',
          holder: 'Science',
          itemId: 'i1',
          itemName: 'Paper',
          quantity: 5,
          unitCost: null,
        },
      ]);
      expect(groups[0].quantity).toBe(5);
      expect(groups[0].value).toBe(0);
    });

    it('sorts the costliest department first', () => {
      const groups = consumptionByHolder([
        {
          holderKey: 'd1',
          holder: 'Science',
          itemId: 'i1',
          itemName: 'Paper',
          quantity: 1,
          unitCost: 10,
        },
        {
          holderKey: 'd2',
          holder: 'Office',
          itemId: 'i1',
          itemName: 'Paper',
          quantity: 1,
          unitCost: 900,
        },
      ]);
      expect(groups.map((g) => g.holder)).toEqual(['Office', 'Science']);
    });

    it('returns nothing for no rows', () => {
      expect(consumptionByHolder([])).toEqual([]);
    });
  });

  describe('summarizePurchases', () => {
    const row = (
      over: Partial<Parameters<typeof summarizePurchases>[0][0]> = {},
    ) => ({
      supplierId: 's1',
      supplierName: 'Karim Traders',
      purchaseId: 'p1',
      purchaseNo: 'PO-26-00001',
      date: '2026-03-10',
      total: 5000,
      status: 'RECEIVED',
      ...over,
    });

    it('totals per supplier, biggest first', () => {
      const summary = summarizePurchases([
        row({ supplierId: 's1', supplierName: 'Karim', total: 5000 }),
        row({ supplierId: 's2', supplierName: 'Rahim', total: 9000 }),
        row({ supplierId: 's1', supplierName: 'Karim', total: 1000 }),
      ]);
      expect(summary.bySupplier.map((s) => s.supplierName)).toEqual([
        'Rahim',
        'Karim',
      ]);
      expect(summary.bySupplier[1].total).toBe(6000);
      expect(summary.bySupplier[1].purchases).toBe(2);
      expect(summary.total).toBe(15000);
      expect(summary.purchases).toBe(3);
    });

    it('groups a supplier-less purchase under one bucket rather than dropping it', () => {
      const summary = summarizePurchases([
        row({ supplierId: null, supplierName: 'Local shop', total: 200 }),
        row({ supplierId: null, supplierName: 'Local shop', total: 300 }),
      ]);
      expect(summary.bySupplier).toHaveLength(1);
      expect(summary.bySupplier[0].total).toBe(500);
    });

    it('emits a month row only for months that had a purchase', () => {
      // Unlike M25's fleet chart, a school buys furniture twice a year and
      // a run of zeroes would be noise.
      const summary = summarizePurchases([
        row({ date: '2026-01-05', total: 100 }),
        row({ date: '2026-06-20', total: 200 }),
      ]);
      expect(summary.byMonth.map((m) => m.month)).toEqual([
        '2026-01',
        '2026-06',
      ]);
    });

    it('sorts months chronologically', () => {
      const summary = summarizePurchases([
        row({ date: '2026-06-20', total: 200 }),
        row({ date: '2026-01-05', total: 100 }),
      ]);
      expect(summary.byMonth[0].month).toBe('2026-01');
    });

    it('is empty for no purchases', () => {
      const summary = summarizePurchases([]);
      expect(summary).toEqual({
        bySupplier: [],
        byMonth: [],
        total: 0,
        purchases: 0,
      });
    });
  });

  describe('purchaseTotal', () => {
    it('sums the lines to the paisa', () => {
      expect(
        purchaseTotal([
          { qty: 4, unitPrice: 240 },
          { qty: 2, unitPrice: 150.5 },
        ]),
      ).toBe(1261);
    });

    it('rounds each line before summing, matching the stored column', () => {
      // Each line's `total` is a NUMERIC(12,2) pinned by CHECK, so the
      // purchase total has to be the sum of the ROUNDED lines rather than
      // the rounding of an exact sum — otherwise the header and the grid
      // disagree by a paisa and the voucher will not post.
      expect(
        purchaseTotal([
          { qty: 3, unitPrice: 0.335 },
          { qty: 3, unitPrice: 0.335 },
        ]),
      ).toBe(2.02);
    });

    it('is zero for no lines', () => {
      expect(purchaseTotal([])).toBe(0);
    });
  });

  describe('countSheetDiff — roadmap §8 bulk adjustment wizard', () => {
    const row = (
      over: Partial<Parameters<typeof countSheetDiff>[0][0]> = {},
    ) => ({
      itemId: 'i1',
      itemName: 'A4 Paper',
      itemCode: 'STA-001',
      unit: 'REAM',
      expected: 12,
      counted: 12,
      ...over,
    });

    it('drops rows that match — an adjustment of zero says nothing happened', () => {
      expect(countSheetDiff([row(), row({ itemId: 'i2' })])).toEqual([]);
    });

    it('derives the direction from the ledger, not from the count sheet', () => {
      const diffs = countSheetDiff([
        row({ itemId: 'short', expected: 12, counted: 8 }),
        row({ itemId: 'over', expected: 12, counted: 15 }),
      ]);
      const short = diffs.find((d) => d.itemId === 'short');
      const over = diffs.find((d) => d.itemId === 'over');
      expect(short).toMatchObject({ direction: 'OUT', difference: 4 });
      expect(over).toMatchObject({ direction: 'IN', difference: 3 });
    });

    it('reports the difference as a magnitude, so the movement is one-sided', () => {
      const [diff] = countSheetDiff([row({ expected: 12, counted: 8 })]);
      expect(diff.difference).toBeGreaterThan(0);
    });

    it('sorts the biggest discrepancy first', () => {
      const diffs = countSheetDiff([
        row({ itemId: 'a', expected: 12, counted: 11 }),
        row({ itemId: 'b', expected: 100, counted: 40 }),
      ]);
      expect(diffs.map((d) => d.itemId)).toEqual(['b', 'a']);
    });

    it('handles fractional counts', () => {
      const [diff] = countSheetDiff([
        row({ unit: 'LITER', expected: 2.5, counted: 2.25 }),
      ]);
      expect(diff).toMatchObject({ direction: 'OUT', difference: 0.25 });
    });
  });
});
