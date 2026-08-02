import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssetCondition,
  ItemType,
  Prisma,
  PurchaseStatus,
  StockTxnType,
  SupplierStatus,
} from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { SequenceService } from '../../sequence/sequence.service';
import { normalizeAssetTag } from '../calc/asset.engine';
import { REF_TYPES } from '../calc/stock-ledger.engine';
import { purchaseTotal } from '../calc/stock-report.engine';
import {
  qty,
  toBaseQty,
  unitCostPerBase,
  validateQty,
} from '../calc/unit.util';
import type {
  CancelPurchaseDto,
  PurchaseQueryDto,
  ReceivePurchaseDto,
  UpsertPurchaseDto,
} from '../dto';
import { AssetUnitsRepository } from '../repositories/assets.repository';
import { ItemsRepository } from '../repositories/catalog.repository';
import {
  PurchasesRepository,
  type PurchaseWithLines,
} from '../repositories/purchases.repository';
import { InventoryPostingService } from './inventory-posting.service';
import { InventorySettingsService } from './inventory-settings.service';
import { StockService } from './stock.service';

/** What `buildLines` hands back: the rows to store and the header total
 *  the CHECK cannot compute (a CHECK sees one row, this sums siblings —
 *  the M20 Σdebit = Σcredit split). */
interface BuiltLines {
  rows: Array<
    Omit<Prisma.PurchaseItemUncheckedCreateInput, 'purchaseId'> & {
      purchaseId: string;
    }
  >;
  total: number;
}

/**
 * Purchases: entering a delivery, receiving it into stock, and cancelling
 * one that should not have been received.
 *
 * **RECEIVE is the moment everything happens** (roadmap §4) and it is one
 * transaction: the ledger rows, the asset units, the item's last cost,
 * the status flip. If any part fails the whole delivery stays DRAFT,
 * because a purchase that is half-received is a store nobody can count.
 *
 * **A RECEIVED purchase is immutable** (roadmap §6). No edit, no delete —
 * the correction is `cancel`, which writes reversing ledger entries and
 * leaves the original standing. That is the M20 voucher rule, and it has
 * the same consequence: a school that has already issued the paper it is
 * trying to un-receive genuinely cannot, and finding that out is the
 * point.
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly purchases: PurchasesRepository,
    private readonly items: ItemsRepository,
    private readonly assets: AssetUnitsRepository,
    private readonly stock: StockService,
    private readonly sequences: SequenceService,
    private readonly schools: SchoolsRepository,
    private readonly config: InventorySettingsService,
    private readonly posting: InventoryPostingService,
    private readonly audit: AuditContextService,
  ) {}

  async list(query: PurchaseQueryDto, actor: AccessTokenPayload) {
    return this.purchases.paginate(query, {
      searchColumns: ['purchaseNo', 'invoiceRef'],
      sortableColumns: ['date', 'purchaseNo', 'total', 'createdAt'],
      schoolId: actor.schoolId,
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...(query.from || query.to
          ? {
              date: {
                ...(query.from ? { gte: parseDate(query.from) } : {}),
                ...(query.to ? { lte: parseDate(query.to) } : {}),
              },
            }
          : {}),
      },
    });
  }

  async get(id: string, actor: AccessTokenPayload): Promise<PurchaseWithLines> {
    const purchase = await this.purchases.findDetail(id, actor.schoolId);
    if (!purchase) throw new NotFoundException(`Purchase ${id} not found`);
    return purchase;
  }

  async create(dto: UpsertPurchaseDto, actor: AccessTokenPayload) {
    const school = await this.schools.findByIdOrFail(actor.schoolId);
    const cfg = await this.config.load(actor.schoolId);
    const { rows, total } = await this.buildLines(dto, actor.schoolId);

    return this.stock.withTransaction(async (tx) => {
      await this.assertSupplierUsable(dto.supplierId, actor.schoolId, tx);

      // Claimed INSIDE the transaction, so a rolled-back create never
      // burns a number — the M07 gap-free guarantee.
      const purchaseNo = await this.sequences.nextDocumentNumber({
        schoolId: actor.schoolId,
        counterKey: `inventory-purchase:${new Date().getUTCFullYear() % 100}`,
        pattern: cfg.purchaseNoPattern,
        schoolCode: school.code,
        tx,
      });

      const created = await this.purchases.create(
        {
          schoolId: actor.schoolId,
          supplierId: dto.supplierId ?? null,
          purchaseNo,
          date: parseDate(dto.date),
          invoiceRef: dto.invoiceRef?.trim() || null,
          total: new Prisma.Decimal(total),
          status: PurchaseStatus.DRAFT,
          remarks: dto.remarks?.trim() || null,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );

      await this.purchases.replaceLines(
        created.id,
        rows.map((line) => ({ ...line, purchaseId: created.id })),
        tx,
      );

      this.audit.set({
        entityType: 'Purchase',
        entityId: created.id,
        newValues: { purchaseNo, total: Number(created.total) },
      });

      return this.purchases.findDetail(created.id, actor.schoolId, tx);
    });
  }

  async update(id: string, dto: UpsertPurchaseDto, actor: AccessTokenPayload) {
    const existing = await this.get(id, actor);
    this.assertDraft(existing, 'edited');
    const { rows, total } = await this.buildLines(dto, actor.schoolId);

    return this.stock.withTransaction(async (tx) => {
      await this.assertSupplierUsable(dto.supplierId, actor.schoolId, tx);

      await this.purchases.setStatus(
        id,
        {
          supplierId: dto.supplierId ?? null,
          date: parseDate(dto.date),
          invoiceRef: dto.invoiceRef?.trim() || null,
          total: new Prisma.Decimal(total),
          remarks: dto.remarks?.trim() || null,
          updatedBy: actor.sub,
        },
        tx,
      );

      await this.purchases.replaceLines(
        id,
        rows.map((line) => ({ ...line, purchaseId: id })),
        tx,
      );

      this.audit.set({
        entityType: 'Purchase',
        entityId: id,
        oldValues: { total: Number(existing.total) },
        newValues: { total },
      });

      return this.purchases.findDetail(id, actor.schoolId, tx);
    });
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.get(id, actor);
    this.assertDraft(existing, 'deleted');
    await this.purchases.softDelete(id);
    this.audit.set({
      entityType: 'Purchase',
      entityId: id,
      oldValues: { purchaseNo: existing.purchaseNo },
    });
  }

  /**
   * **Receive** — roadmap §4's "RECEIVE → ledger in + asset_units
   * generation for ASSET items with tag sequence".
   *
   * One transaction, in this order, and the order matters:
   *
   *  1. the ledger rows (which may refuse — nothing else has happened
   *     yet),
   *  2. the item's `last_unit_cost`, so the valuation report reflects
   *     this delivery,
   *  3. the asset units, tags claimed from the same sequence service,
   *  4. the status flip with its `received_at` evidence.
   *
   * The M20 voucher is posted **after the commit**, deliberately: a
   * misconfigured chart of accounts must not be able to refuse a delivery
   * that physically arrived. A posting failure is logged and the stock
   * still moved — the M20/M21/M25 rule, third module running.
   */
  async receive(
    id: string,
    dto: ReceivePurchaseDto,
    actor: AccessTokenPayload,
  ) {
    const existing = await this.get(id, actor);
    if (existing.status !== PurchaseStatus.DRAFT) {
      throw new ConflictException(
        existing.status === PurchaseStatus.RECEIVED
          ? `${existing.purchaseNo} was already received on ${isoDate(existing.receivedAt ?? new Date())}`
          : `${existing.purchaseNo} was cancelled and cannot be received`,
      );
    }
    if (existing.items.length === 0) {
      throw new BadRequestException(
        `${existing.purchaseNo} has no lines to receive`,
      );
    }

    const cfg = await this.config.load(actor.schoolId);
    const school = await this.schools.findByIdOrFail(actor.schoolId);

    // Roadmap §7: a warranty may not predate the purchase. Checked here
    // so the message names the dates; `chk_asset_units_warranty` holds.
    if (dto.warrantyUntil && parseDate(dto.warrantyUntil) < existing.date) {
      throw new BadRequestException(
        `A warranty ending ${dto.warrantyUntil} would have expired before the delivery on ${isoDate(existing.date)}`,
      );
    }

    const assetLines = existing.items.filter(
      (line) => line.item.type === ItemType.ASSET,
    );
    const unitsToGenerate = assetLines.reduce(
      (total, line) => total + Math.round(Number(line.baseQty)),
      0,
    );
    if (unitsToGenerate > cfg.maxAssetUnitsPerReceipt) {
      throw new BadRequestException(
        `This delivery would generate ${unitsToGenerate} tagged units, above the ${cfg.maxAssetUnitsPerReceipt} allowed in one receipt. Split the purchase.`,
      );
    }
    // An asset bought in a fractional quantity has no meaning — you
    // cannot tag half a chair — and the batch below would silently round
    // it. Refused here rather than at `Math.round`.
    for (const line of assetLines) {
      const base = Number(line.baseQty);
      if (!Number.isInteger(qty(base))) {
        throw new BadRequestException(
          `"${line.item.name}" is an asset, so it cannot be received in a fractional quantity (${base})`,
        );
      }
    }

    await this.stock.withTransaction(async (tx) => {
      const receivedAt = new Date();

      for (const line of existing.items) {
        const baseQty = Number(line.baseQty);
        const unitCost = unitCostPerBase(
          Number(line.unitPrice),
          Number(line.packSize),
        );

        await this.stock.record(tx, actor.schoolId, actor.sub, {
          itemId: line.itemId,
          txn: StockTxnType.PURCHASE,
          quantity: baseQty,
          refType: REF_TYPES.PURCHASE,
          refId: existing.id,
          unitCost,
          remarks: `${existing.purchaseNo}${existing.invoiceRef ? ` (${existing.invoiceRef})` : ''}`,
        });

        // The valuation figure. Written per line, so a delivery that
        // repriced three items reprices exactly those three.
        await tx.item.update({
          where: { id: line.itemId },
          data: { lastUnitCost: new Prisma.Decimal(unitCost) },
        });
      }

      for (const line of assetLines) {
        await this.generateAssetUnits(tx, {
          schoolId: actor.schoolId,
          schoolCode: school.code,
          pattern: cfg.assetTagPattern,
          line,
          purchaseDate: existing.date,
          dto,
          actorId: actor.sub,
        });
      }

      return this.purchases.setStatus(
        id,
        {
          status: PurchaseStatus.RECEIVED,
          receivedAt,
          receivedBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );
    });

    this.audit.set({
      entityType: 'Purchase',
      entityId: id,
      oldValues: { status: PurchaseStatus.DRAFT },
      newValues: {
        status: PurchaseStatus.RECEIVED,
        assetUnits: unitsToGenerate,
      },
    });

    // After the commit — see the doc comment.
    const voucherId = cfg.autoPostAccounting
      ? await this.posting.postPurchase({
          schoolId: actor.schoolId,
          purchaseId: id,
          purchaseNo: existing.purchaseNo,
          date: existing.date,
          supplierName: existing.supplier?.name ?? null,
          actorId: actor.sub,
          lines: existing.items.map((line) => ({
            itemCategoryId: line.item.categoryId,
            itemType: line.item.type,
            amount: Number(line.total),
            label: line.item.name,
          })),
        })
      : null;

    if (voucherId) {
      await this.purchases.update(id, { voucherId });
    }

    return {
      purchase: await this.get(id, actor),
      assetUnitsGenerated: unitsToGenerate,
      voucherId,
    };
  }

  /**
   * **Cancel** — roadmap §6's "cancel = reversal entries".
   *
   * A DRAFT simply becomes CANCELLED. A RECEIVED one writes an ADJUST-out
   * row per line, which faces the same non-negative rule as every other
   * movement: if the school has already issued the stock, the reversal is
   * refused and says so. That is correct — the paper is genuinely gone,
   * and the honest correction is a counted adjustment with a reason on
   * it, not a delivery the ledger pretends never happened.
   *
   * Asset units generated by the receipt are soft-deleted with it. Their
   * TAGS are not freed: `uq_asset_units_tag` ignores `deleted_at` on
   * purpose, so a label already stuck to a chair is never handed to a
   * different chair.
   */
  async cancel(id: string, dto: CancelPurchaseDto, actor: AccessTokenPayload) {
    const existing = await this.get(id, actor);
    if (existing.status === PurchaseStatus.CANCELLED) {
      throw new ConflictException(
        `${existing.purchaseNo} is already cancelled`,
      );
    }

    const wasReceived = existing.status === PurchaseStatus.RECEIVED;

    await this.stock.withTransaction(async (tx) => {
      if (wasReceived) {
        // Sorted by item id inside `recordMany` — the deadlock ordering
        // rule. A single-item purchase does not care; a twelve-line one
        // cancelled by two people at once does.
        await this.stock.recordMany(
          tx,
          actor.schoolId,
          actor.sub,
          existing.items.map((line) => ({
            itemId: line.itemId,
            txn: StockTxnType.ADJUST,
            quantity: Number(line.baseQty),
            direction: 'OUT' as const,
            refType: REF_TYPES.PURCHASE,
            refId: existing.id,
            remarks: `Cancelled ${existing.purchaseNo}: ${dto.reason.trim()}`,
          })),
        );

        const units = await this.assets.findForPurchase(id, tx);
        if (units.length > 0) {
          await tx.assetUnit.updateMany({
            where: { id: { in: units.map((unit) => unit.id) } },
            data: { deletedAt: new Date(), updatedBy: actor.sub },
          });
        }
      }

      await this.purchases.setStatus(
        id,
        {
          status: PurchaseStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: dto.reason.trim(),
          updatedBy: actor.sub,
        },
        tx,
      );
    });

    this.audit.set({
      entityType: 'Purchase',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: {
        status: PurchaseStatus.CANCELLED,
        reason: dto.reason.trim(),
      },
    });

    return {
      purchase: await this.get(id, actor),
      stockReversed: wasReceived,
      // Deliberately NOT cancelled here. `voucher.cancel` is a permission
      // the store does not hold, and silently reversing a posted entry
      // from a stores screen is exactly the quiet restatement M20 exists
      // to prevent — the M25 precedent, verbatim.
      voucherStanding:
        wasReceived && existing.voucherId ? existing.voucherId : null,
    };
  }

  // ── internals ───────────────────────────────────────────────────────

  private assertDraft(purchase: PurchaseWithLines, verb: string): void {
    if (purchase.status !== PurchaseStatus.DRAFT) {
      throw new ConflictException(
        `${purchase.purchaseNo} is ${purchase.status} and can no longer be ${verb} — a received delivery is corrected by cancelling it, which reverses its stock`,
      );
    }
  }

  private async assertSupplierUsable(
    supplierId: string | undefined,
    schoolId: string,
    tx: PrismaClientLike,
  ): Promise<void> {
    if (!supplierId) return;
    const supplier = await tx.supplier.findFirst({
      where: { id: supplierId, schoolId, deletedAt: null },
    });
    if (!supplier) {
      throw new NotFoundException(`Supplier ${supplierId} not found`);
    }
    if (supplier.status === SupplierStatus.BLACKLISTED) {
      throw new ConflictException(
        `${supplier.name} is blacklisted${supplier.statusReason ? `: ${supplier.statusReason}` : ''}`,
      );
    }
  }

  /**
   * Validate the lines and compute both stored quantities.
   *
   * `packSize` is **snapshotted** from the item, so a school that later
   * redefines a box as 24 does not silently restate last year's
   * deliveries (the M14/M15/M21 snapshot rule), and `baseQty` is derived
   * here once — `chk_purchase_items_base_qty` is what refuses the write
   * if any future path computes it differently.
   */
  private async buildLines(
    dto: UpsertPurchaseDto,
    schoolId: string,
  ): Promise<BuiltLines> {
    const itemIds = dto.lines.map((line) => line.itemId);
    const unique = new Set(itemIds);
    if (unique.size !== itemIds.length) {
      throw new BadRequestException(
        'An item may appear only once on a purchase — combine the quantities',
      );
    }

    const items = await this.items.findManyLive(schoolId, { ids: itemIds });
    const byId = new Map(items.map((item) => [item.id, item]));

    const rows = dto.lines.map((line) => {
      const item = byId.get(line.itemId);
      if (!item) {
        throw new NotFoundException(
          `Item ${line.itemId} is not in the catalogue`,
        );
      }

      const packSize = item.packSize === null ? 1 : Number(item.packSize);
      const baseQty = toBaseQty(line.qty, packSize);

      // The entered quantity is in PACKS when the item has one, so it is
      // the BASE quantity that has to satisfy the unit's fractional rule
      // — three boxes of a counted item is fine, 3.5 pieces is not.
      const validated = validateQty(baseQty, item.unit);
      if (!validated.ok) {
        throw new BadRequestException(`"${item.name}": ${validated.reason}`);
      }

      return {
        schoolId,
        purchaseId: '',
        itemId: item.id,
        qty: new Prisma.Decimal(qty(line.qty)),
        packSize: new Prisma.Decimal(packSize),
        baseQty: new Prisma.Decimal(validated.qty),
        unitPrice: new Prisma.Decimal(line.unitPrice),
        total: new Prisma.Decimal(
          purchaseTotal([{ qty: line.qty, unitPrice: line.unitPrice }]),
        ),
        remarks: line.remarks?.trim() || null,
      };
    });

    return {
      rows,
      // Computed from the DTO's plain numbers, not from the Decimal
      // columns above — `purchaseTotal` rounds each line before summing,
      // which is what keeps the header equal to the sum of the stored
      // (already-rounded) line totals rather than to the rounding of an
      // exact sum. A paisa of disagreement there is a voucher that will
      // not post.
      total: purchaseTotal(dto.lines),
    };
  }

  /**
   * One tagged row per unit bought (roadmap §4). Tags come from
   * `SequenceService` one at a time inside the transaction, so a
   * rolled-back receipt burns none — the same guarantee the purchase
   * number has, and the reason the batch is capped by a setting.
   */
  private async generateAssetUnits(
    tx: PrismaClientLike,
    input: {
      schoolId: string;
      schoolCode: string;
      pattern: string;
      line: PurchaseWithLines['items'][number];
      purchaseDate: Date;
      dto: ReceivePurchaseDto;
      actorId: string | null;
    },
  ): Promise<void> {
    const count = Math.round(Number(input.line.baseQty));
    if (count <= 0) return;

    const unitPrice = unitCostPerBase(
      Number(input.line.unitPrice),
      Number(input.line.packSize),
    );

    const rows: Prisma.AssetUnitUncheckedCreateInput[] = [];
    for (let index = 0; index < count; index++) {
      const assetTag = normalizeAssetTag(
        await this.sequences.nextDocumentNumber({
          schoolId: input.schoolId,
          counterKey: 'inventory-asset',
          pattern: input.pattern,
          schoolCode: input.schoolCode,
          tx,
        }),
      );

      rows.push({
        schoolId: input.schoolId,
        itemId: input.line.itemId,
        purchaseItemId: input.line.id,
        assetTag,
        status: 'IN_STORE',
        condition: input.dto.condition ?? AssetCondition.NEW,
        locationText: input.dto.locationText?.trim() || null,
        // A received batch goes to the store, not to a custodian — the
        // custodian columns stay NULL until somebody signs for it, which
        // is what `chk_asset_units_custodian`'s all-NULL branch is for.
        // The department on the receipt dialog is the *location* hint,
        // and assigning is a separate, audited act.
        purchasePrice: new Prisma.Decimal(unitPrice),
        purchaseDate: input.purchaseDate,
        warrantyUntil: input.dto.warrantyUntil
          ? parseDate(input.dto.warrantyUntil)
          : null,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      });
    }

    await this.assets.createMany(rows, tx);
  }
}
