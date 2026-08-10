import { Injectable } from '@nestjs/common';
import { InventoryReportsService } from '../../../inventory/services/inventory-reports.service';
import type { ReportTable } from '../../calc/types';
import {
  defaultWindow,
  str,
  type ReportContext,
  type ReportExecutor,
  type ReportExecutorProvider,
} from '../executor.types';

/** M24's six report shapes. */
@Injectable()
export class InventoryReportExecutors implements ReportExecutorProvider {
  constructor(private readonly reports: InventoryReportsService) {}

  executors(): Record<string, ReportExecutor> {
    return {
      'inventory.stock': (ctx) => this.stock(ctx),
      'inventory.ledger': (ctx) => this.ledger(ctx),
      'inventory.purchases': (ctx) => this.purchases(ctx),
      'inventory.assets': (ctx) => this.assets(ctx),
      'inventory.warranty': (ctx) => this.warranty(ctx),
      'inventory.consumption': (ctx) => this.consumption(ctx),
    };
  }

  private async stock(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.reports.stockValuation(ctx.schoolId);
    return {
      title: 'Current stock & valuation',
      columns: [
        { key: 'itemCode', label: 'Code' },
        { key: 'itemName', label: 'Item', width: 32 },
        { key: 'categoryName', label: 'Category' },
        { key: 'unit', label: 'Unit' },
        { key: 'balance', label: 'Balance', type: 'number' },
        { key: 'reorderLevel', label: 'Reorder level', type: 'number' },
        { key: 'lastUnitCost', label: 'Last unit cost', type: 'money' },
        { key: 'value', label: 'Value', type: 'money' },
        { key: 'belowReorder', label: 'Below reorder' },
      ],
      rows: report.rows.map((row) => ({ ...row })),
      summary: [
        { label: 'Items in stock', value: report.itemsInStock },
        { label: 'Total value', value: report.totalValue },
        { label: 'Unvalued items', value: report.unvaluedItems },
        { label: 'Below reorder', value: report.belowReorder },
      ],
      notes: [
        `Valuation method: ${report.valuationMethod}. An item never bought through the system has no cost, so it is left blank rather than valued at zero — and ${report.unvaluedItems} row(s) are excluded from the total for that reason.`,
      ],
    };
  }

  private async ledger(ctx: ReportContext): Promise<ReportTable> {
    const itemId = str(ctx.params, 'itemId');
    if (!itemId) throw new Error('itemId is required');
    const window = defaultWindow(ctx.params);
    const report = await this.reports.itemLedger(ctx.schoolId, itemId, {
      from: window.from,
      to: window.to,
    });

    return {
      title: `Item ledger — ${report.item.code} ${report.item.name}`,
      subtitle: `${window.from} to ${window.to}`,
      columns: [
        { key: 'createdAt', label: 'When' },
        { key: 'txn', label: 'Movement' },
        { key: 'refType', label: 'Document' },
        { key: 'qtyIn', label: 'In', type: 'number' },
        { key: 'qtyOut', label: 'Out', type: 'number' },
        { key: 'balanceAfter', label: 'Balance', type: 'number' },
        { key: 'unitCost', label: 'Unit cost', type: 'money' },
        { key: 'remarks', label: 'Remarks', width: 32 },
      ],
      rows: report.rows.map((row) => ({ ...row })),
      summary: [
        { label: 'Current balance', value: report.balance },
        { label: 'Unit', value: report.item.unit },
      ],
      notes: report.windowed
        ? [
            'This is a windowed read: the running balance is the stored one and continues an earlier history, so the movements shown do not sum to it.',
          ]
        : [],
    };
  }

  private async purchases(ctx: ReportContext): Promise<ReportTable> {
    const window = defaultWindow(ctx.params);
    const report = await this.reports.purchaseSummary(ctx.schoolId, {
      supplierId: str(ctx.params, 'supplierId'),
      from: window.from,
      to: window.to,
    });

    return {
      title: `Purchases — ${window.from} to ${window.to}`,
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'purchaseNo', label: 'Purchase no' },
        { key: 'supplierName', label: 'Supplier', width: 28 },
        { key: 'invoiceRef', label: 'Invoice ref' },
        { key: 'lines', label: 'Lines', type: 'number' },
        { key: 'total', label: 'Total', type: 'money' },
      ],
      rows: report.purchaseList.map((row) => ({ ...row })),
      summary: [
        { label: 'Deliveries', value: report.purchases },
        { label: 'Total', value: report.total },
        ...report.bySupplier.slice(0, 5).map((s) => ({
          label: s.supplierName,
          value: s.total,
        })),
      ],
      notes: [
        'RECEIVED deliveries only — a draft is still being typed and a cancelled one did not happen.',
      ],
    };
  }

  private async assets(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.reports.assetRegister(ctx.schoolId);
    return {
      title: 'Asset register',
      columns: [
        { key: 'assetTag', label: 'Asset tag' },
        { key: 'itemName', label: 'Item', width: 30 },
        { key: 'serialNo', label: 'Serial no' },
        { key: 'categoryName', label: 'Category' },
        { key: 'status', label: 'Status' },
        { key: 'condition', label: 'Condition' },
        { key: 'location', label: 'Location', width: 22 },
        { key: 'custodian', label: 'Custodian', width: 26 },
        { key: 'purchaseDate', label: 'Purchased', type: 'date' },
        { key: 'purchasePrice', label: 'Cost', type: 'money' },
        { key: 'warrantyState', label: 'Warranty' },
      ],
      rows: report.rows.map((row) => ({
        assetTag: row.assetTag,
        itemName: row.itemName,
        serialNo: row.serialNo,
        categoryName: row.categoryName,
        status: row.status,
        condition: row.condition,
        location: row.location,
        custodian: row.custodian,
        purchaseDate: row.purchaseDate,
        purchasePrice: row.purchasePrice,
        warrantyState: row.warranty.state,
      })),
      summary: [
        { label: 'On books', value: report.counts.onBooks },
        { label: 'In store', value: report.counts.inStore },
        { label: 'Assigned', value: report.counts.assigned },
        { label: 'Under repair', value: report.counts.underRepair },
        { label: 'Disposed', value: report.counts.disposed },
        { label: 'Lost', value: report.counts.lost },
        { label: 'Cost value', value: Math.round(report.value * 100) / 100 },
      ],
      notes: [
        `Written-off units are excluded from the register (roadmap M24 §6); ${report.writtenOff.length} are recorded separately so an audit can still be told what happened to them.`,
      ],
    };
  }

  private async warranty(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.reports.warranty(ctx.schoolId);
    return {
      title: 'Warranties expiring',
      columns: [
        { key: 'assetTag', label: 'Asset tag' },
        { key: 'itemName', label: 'Item', width: 30 },
        { key: 'status', label: 'Status' },
        { key: 'location', label: 'Location', width: 22 },
        { key: 'warrantyUntil', label: 'Warranty until', type: 'date' },
        { key: 'state', label: 'State' },
        { key: 'daysLeft', label: 'Days left', type: 'number' },
        { key: 'message', label: 'Note', width: 34 },
      ],
      rows: report.rows.map((row) => ({ ...row })),
      notes: [
        `Alert window: ${report.windowDays} days. An asset with no warranty date recorded reports UNKNOWN rather than passing — a missing date is not a valid one.`,
      ],
    };
  }

  private async consumption(ctx: ReportContext): Promise<ReportTable> {
    const window = defaultWindow(ctx.params);
    const report = await this.reports.consumption(ctx.schoolId, {
      from: window.from,
      to: window.to,
    });

    // One row per (holder, item): the question this report answers is
    // "what did each department get through", and a holder-level total
    // alone cannot be checked against a stores ledger.
    const rows = report.groups.flatMap((group) =>
      group.items.map((item) => ({
        holder: group.holder,
        itemName: item.itemName,
        quantity: item.quantity,
        value: item.value,
      })),
    );

    return {
      title: `Consumption — ${window.from} to ${window.to}`,
      columns: [
        { key: 'holder', label: 'Department / person / room', width: 30 },
        { key: 'itemName', label: 'Item', width: 30 },
        { key: 'quantity', label: 'Quantity', type: 'number' },
        { key: 'value', label: 'Value', type: 'money' },
      ],
      rows,
      summary: [
        { label: 'Holders', value: report.groups.length },
        { label: 'Total value', value: report.total },
      ],
      notes: [
        'Net of returns, read from the stock ledger rather than from the issue slips — a department that took twenty reams and sent eight back consumed twelve, even when the return crosses the window.',
      ],
    };
  }
}
