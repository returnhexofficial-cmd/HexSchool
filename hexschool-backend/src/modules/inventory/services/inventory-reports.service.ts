import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AssetUnitStatus,
  InventoryHolderType,
  PurchaseStatus,
  StockTxnType,
} from '@prisma/client';
import { dhakaToday } from '../../../common/utils/clock.util';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { warrantyAlerts, warrantyStatus } from '../calc/asset.engine';
import { REF_TYPES } from '../calc/stock-ledger.engine';
import {
  consumptionByHolder,
  lowStockRows,
  summarizePurchases,
  valueStock,
  type ConsumptionInput,
  type StockRow,
} from '../calc/stock-report.engine';
import type { InventoryReportQueryDto, ItemLedgerQueryDto } from '../dto';
import {
  AssetUnitsRepository,
  ON_BOOKS,
} from '../repositories/assets.repository';
import { ItemsRepository } from '../repositories/catalog.repository';
import { InventoryDirectoryRepository } from '../repositories/inventory-directory.repository';
import { StockIssuesRepository } from '../repositories/issues.repository';
import { PurchasesRepository } from '../repositories/purchases.repository';
import { StockLedgerRepository } from '../repositories/stock.repository';
import { InventorySettingsService } from './inventory-settings.service';
import { StockService } from './stock.service';

/**
 * The six reports roadmap §4 asks for.
 *
 * The shapes are built here and `InventoryExportService` writes the same
 * objects into a spreadsheet — the M12 reports/export split, so the sheet
 * and the screen are the same numbers rather than two implementations
 * that will eventually disagree.
 *
 * All the arithmetic is in `stock-report.engine.ts`; this service is the
 * queries and the joins.
 */
@Injectable()
export class InventoryReportsService {
  constructor(
    private readonly items: ItemsRepository,
    private readonly ledger: StockLedgerRepository,
    private readonly purchases: PurchasesRepository,
    private readonly issues: StockIssuesRepository,
    private readonly assets: AssetUnitsRepository,
    private readonly directory: InventoryDirectoryRepository,
    private readonly stock: StockService,
    private readonly config: InventorySettingsService,
  ) {}

  /**
   * Current stock and its value (roadmap §4).
   *
   * The method is carried on the payload — `LAST_PRICE`, from the
   * settings — because "total stock value: 412,300" means nothing without
   * it, and a reader who has to guess will guess FIFO.
   */
  async stockValuation(schoolId: string, query: InventoryReportQueryDto = {}) {
    const cfg = await this.config.load(schoolId);
    const rows = await this.stockRows(schoolId, query);
    const report = valueStock(rows);
    return {
      ...report,
      valuationMethod: cfg.valuationMethod,
      valuationNote:
        'Stock is valued at the last unit price paid for each item (roadmap §4 "FIFO-simple"). It is a replacement value, not a cost-flow valuation.',
      generatedAt: new Date(),
    };
  }

  /** Roadmap §4's low-stock list — also what the weekly job reads. */
  async lowStock(schoolId: string) {
    const rows = await this.stockRows(schoolId);
    return { rows: lowStockRows(rows), generatedAt: new Date() };
  }

  /**
   * One item's movements with the stored running balance beside each row
   * (roadmap §4 "item ledger").
   *
   * The balance is READ, never recomputed — that is what storing it is
   * for — but the payload also carries `replayed`, the same history summed
   * from zero, so a reader (and the e2e suite) can see the two agree. A
   * disagreement means a writer skipped the row lock, which is worth
   * surfacing rather than papering over.
   */
  async itemLedger(
    schoolId: string,
    itemId: string,
    query: ItemLedgerQueryDto = {},
  ) {
    const item = await this.items.findDetail(itemId, schoolId);
    if (!item) throw new NotFoundException(`Item ${itemId} not found`);

    const range = {
      from: query.from ? parseDate(query.from) : undefined,
      to: query.to ? parseDate(query.to) : undefined,
    };
    const [rows, balance] = await Promise.all([
      this.stock.history(schoolId, itemId, range),
      this.stock.balanceFor(schoolId, itemId),
    ]);

    return {
      item: {
        id: item.id,
        code: item.code,
        name: item.name,
        unit: item.unit,
        type: item.type,
        categoryName: item.category?.name ?? null,
      },
      rows,
      balance,
      replayed: rows.reduce(
        (running, row) => StockService.qty(running + row.qtyIn - row.qtyOut),
        // Only meaningful over a full history; a windowed read starts
        // partway through, so the caller is told what the window was.
        0,
      ),
      windowed: Boolean(range.from || range.to),
      generatedAt: new Date(),
    };
  }

  /**
   * Purchases by supplier and period (roadmap §4).
   *
   * **RECEIVED only.** A DRAFT is something somebody is still typing and a
   * CANCELLED one is a delivery that did not happen; counting either as
   * spending would make this report disagree with the ledger it exists to
   * explain — the M20 lesson about a status that means "superseded"
   * rather than "never happened", read from the other side.
   */
  async purchaseSummary(schoolId: string, query: InventoryReportQueryDto = {}) {
    const rows = await this.purchases.findManyLive(schoolId, {
      status: PurchaseStatus.RECEIVED,
      supplierId: query.supplierId,
      from: query.from ? parseDate(query.from) : undefined,
      to: query.to ? parseDate(query.to) : undefined,
    });

    const summary = summarizePurchases(
      rows.map((row) => ({
        supplierId: row.supplierId,
        supplierName: row.supplier?.name ?? 'No supplier recorded',
        purchaseId: row.id,
        purchaseNo: row.purchaseNo,
        date: isoDate(row.date),
        total: Number(row.total),
        status: row.status,
      })),
    );

    return {
      ...summary,
      purchaseList: rows.map((row) => ({
        id: row.id,
        purchaseNo: row.purchaseNo,
        date: isoDate(row.date),
        supplierName: row.supplier?.name ?? null,
        invoiceRef: row.invoiceRef,
        lines: row.items.length,
        total: Number(row.total),
      })),
      generatedAt: new Date(),
    };
  }

  /**
   * The asset register (roadmap §4: "by location/custodian/status").
   *
   * Written-off units are excluded from the counts by §6 and included in
   * a separate `writtenOff` block — a school still has to be able to say
   * what happened to the projector, and dropping the rows entirely would
   * make the register unable to answer the one question an audit asks.
   */
  async assetRegister(schoolId: string, query: InventoryReportQueryDto = {}) {
    const cfg = await this.config.load(schoolId);
    const today = dhakaToday();

    const all = await this.assets.findManyLive(schoolId, {
      categoryId: query.categoryId,
    });
    const onBooks = all.filter((row) => ON_BOOKS.includes(row.status));

    const personIds = {
      TEACHER: onBooks
        .filter((row) => row.custodianPersonType === 'TEACHER')
        .map((row) => row.custodianPersonId as string),
      STAFF: onBooks
        .filter((row) => row.custodianPersonType === 'STAFF')
        .map((row) => row.custodianPersonId as string),
    };
    const [teachers, staff] = await Promise.all([
      this.directory.lookupMany(schoolId, 'TEACHER', personIds.TEACHER),
      this.directory.lookupMany(schoolId, 'STAFF', personIds.STAFF),
    ]);

    const custodianOf = (row: (typeof onBooks)[number]): string => {
      if (row.custodianType === InventoryHolderType.DEPARTMENT) {
        return row.custodianDept?.name ?? 'Department';
      }
      if (row.custodianType === InventoryHolderType.ROOM) {
        return row.custodianRoom ?? 'Room';
      }
      if (row.custodianType === InventoryHolderType.PERSON) {
        const map = row.custodianPersonType === 'TEACHER' ? teachers : staff;
        const person = row.custodianPersonId
          ? map.get(row.custodianPersonId)
          : undefined;
        return person ? `${person.name} (${person.reference})` : 'Person';
      }
      return 'In store';
    };

    const rows = onBooks.map((row) => ({
      id: row.id,
      assetTag: row.assetTag,
      serialNo: row.serialNo,
      itemName: row.item.name,
      itemCode: row.item.code,
      categoryName: row.item.category?.name ?? null,
      status: row.status,
      condition: row.condition,
      location: row.locationText,
      custodian: custodianOf(row),
      custodianType: row.custodianType,
      purchaseDate: row.purchaseDate ? isoDate(row.purchaseDate) : null,
      purchasePrice:
        row.purchasePrice === null ? null : Number(row.purchasePrice),
      warranty: warrantyStatus(
        row.warrantyUntil ? isoDate(row.warrantyUntil) : null,
        today,
        cfg.warrantyAlertDays,
      ),
    }));

    const byStatus = new Map<AssetUnitStatus, number>();
    for (const row of all) {
      byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
    }

    return {
      rows,
      counts: {
        onBooks: onBooks.length,
        // Reported, never counted in the register total (roadmap §6).
        disposed: byStatus.get(AssetUnitStatus.DISPOSED) ?? 0,
        lost: byStatus.get(AssetUnitStatus.LOST) ?? 0,
        inStore: byStatus.get(AssetUnitStatus.IN_STORE) ?? 0,
        assigned: byStatus.get(AssetUnitStatus.ASSIGNED) ?? 0,
        underRepair: byStatus.get(AssetUnitStatus.UNDER_REPAIR) ?? 0,
      },
      value: rows.reduce((total, row) => total + (row.purchasePrice ?? 0), 0),
      writtenOff: all
        .filter((row) => !ON_BOOKS.includes(row.status))
        .map((row) => ({
          id: row.id,
          assetTag: row.assetTag,
          itemName: row.item.name,
          status: row.status,
          disposedAt: row.disposedAt ? isoDate(row.disposedAt) : null,
          reason: row.disposalReason,
        })),
      generatedAt: new Date(),
    };
  }

  /** Roadmap §4's warranty-expiring report. */
  async warranty(schoolId: string, days?: number) {
    const cfg = await this.config.load(schoolId);
    const window = days ?? cfg.warrantyAlertDays;
    const today = dhakaToday();

    const rows = await this.assets.findManyLive(schoolId, {
      onBooksOnly: true,
    });
    const decorated = rows.map((row) => ({
      id: row.id,
      assetTag: row.assetTag,
      itemName: row.item.name,
      status: row.status,
      location: row.locationText,
      warrantyUntil: row.warrantyUntil ? isoDate(row.warrantyUntil) : null,
      // The engine's shape, so `warrantyAlerts` can rank them — expired
      // first, then expiring, then the ones with no date recorded at all.
      warranty: warrantyStatus(
        row.warrantyUntil ? isoDate(row.warrantyUntil) : null,
        today,
        window,
      ),
    }));

    const ranked = warrantyAlerts(
      decorated.map((row) => ({ id: row.id, status: row.warranty })),
    );
    const byId = new Map(decorated.map((row) => [row.id, row]));

    return {
      windowDays: window,
      rows: ranked.map((row) => {
        const full = byId.get(row.id);
        return {
          id: row.id,
          assetTag: full?.assetTag ?? '',
          itemName: full?.itemName ?? '',
          status: full?.status ?? null,
          location: full?.location ?? null,
          warrantyUntil: full?.warrantyUntil ?? null,
          state: row.status.state,
          daysLeft: row.status.daysLeft,
          message: row.status.message,
        };
      }),
      generatedAt: new Date(),
    };
  }

  /**
   * Consumption by department, person and room (roadmap §4).
   *
   * Built from the LEDGER rather than from the issue slips, because the
   * ledger is where a return is recorded as a movement — which is what
   * makes the figure net (a department that took twenty reams and sent
   * eight back consumed twelve). The slip's `returned_qty` would give the
   * same answer for a simple case and the wrong one the moment a return
   * crosses a reporting window.
   */
  async consumption(schoolId: string, query: InventoryReportQueryDto = {}) {
    const range = {
      from: query.from ? parseDate(query.from) : undefined,
      to: query.to ? parseDate(query.to) : undefined,
    };

    const movements = await this.ledger.movementsByRef(
      schoolId,
      [REF_TYPES.ISSUE, REF_TYPES.RETURN],
      range,
    );
    if (movements.length === 0) {
      return { groups: [], total: 0, generatedAt: new Date() };
    }

    const issueIds = [
      ...new Set(movements.map((row) => row.refId).filter(Boolean)),
    ] as string[];
    const slips = await this.issues.findManyLive(schoolId, {});
    const byIssueId = new Map(
      slips
        .filter((slip) => issueIds.includes(slip.id))
        .map((slip) => [slip.id, slip]),
    );

    const teacherIds: string[] = [];
    const staffIds: string[] = [];
    for (const slip of byIssueId.values()) {
      if (slip.issuedToType !== InventoryHolderType.PERSON) continue;
      if (!slip.issuedToPersonId) continue;
      (slip.issuedToPersonType === 'TEACHER' ? teacherIds : staffIds).push(
        slip.issuedToPersonId,
      );
    }
    const [teachers, staff] = await Promise.all([
      this.directory.lookupMany(schoolId, 'TEACHER', teacherIds),
      this.directory.lookupMany(schoolId, 'STAFF', staffIds),
    ]);

    const itemNames = new Map(
      (await this.items.findManyLive(schoolId)).map((item) => [
        item.id,
        item.name,
      ]),
    );

    const rows: ConsumptionInput[] = [];
    for (const movement of movements) {
      if (!movement.refId) continue;
      const slip = byIssueId.get(movement.refId);
      if (!slip) continue;

      let holderKey = slip.issuedToRoom ?? 'unknown';
      let holder = slip.issuedToRoom ?? 'Unrecorded';
      if (slip.issuedToType === InventoryHolderType.DEPARTMENT) {
        holderKey = slip.issuedToDeptId ?? 'unknown';
        holder = slip.issuedToDept?.name ?? 'Department';
      } else if (slip.issuedToType === InventoryHolderType.PERSON) {
        holderKey = slip.issuedToPersonId ?? 'unknown';
        const map = slip.issuedToPersonType === 'TEACHER' ? teachers : staff;
        const person = slip.issuedToPersonId
          ? map.get(slip.issuedToPersonId)
          : undefined;
        holder = person ? `${person.name} (${person.reference})` : 'Person';
      }

      // An ISSUE is consumption, a RETURN is negative consumption — which
      // is exactly what makes `consumptionByHolder` net.
      const signed =
        movement.txn === StockTxnType.RETURN
          ? -Number(movement.qtyIn)
          : Number(movement.qtyOut);

      rows.push({
        holderKey,
        holder,
        itemId: movement.itemId,
        itemName: itemNames.get(movement.itemId) ?? '',
        quantity: signed,
        unitCost: movement.unitCost === null ? null : Number(movement.unitCost),
      });
    }

    const groups = consumptionByHolder(rows);
    return {
      groups,
      total: groups.reduce((sum, group) => sum + group.value, 0),
      generatedAt: new Date(),
    };
  }

  // ── internals ───────────────────────────────────────────────────────

  private async stockRows(
    schoolId: string,
    query: InventoryReportQueryDto = {},
  ): Promise<StockRow[]> {
    const items = await this.items.findManyLive(schoolId, {
      type: query.type,
      categoryId: query.categoryId,
    });
    const balances = await this.stock.balances(
      schoolId,
      items.map((item) => item.id),
    );

    return items.map((item) => ({
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      categoryId: item.categoryId,
      categoryName: item.category?.name ?? null,
      unit: item.unit,
      type: item.type,
      balance: balances.get(item.id) ?? 0,
      reorderLevel:
        item.reorderLevel === null ? null : Number(item.reorderLevel),
      lastUnitCost:
        item.lastUnitCost === null ? null : Number(item.lastUnitCost),
    }));
  }
}
