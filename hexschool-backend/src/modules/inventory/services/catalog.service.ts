import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Item, Prisma, Supplier } from '@prisma/client';
import { SupplierStatus } from '../../../common/constants';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { isBelowReorder } from '../calc/stock-report.engine';
import { toPackQty } from '../calc/unit.util';
import type {
  ItemQueryDto,
  SupplierQueryDto,
  UpsertCategoryDto,
  UpsertItemDto,
  UpsertSupplierDto,
} from '../dto';
import {
  ItemCategoriesRepository,
  ItemsRepository,
  SuppliersRepository,
  type CategoryNode,
} from '../repositories/catalog.repository';
import { StockService } from './stock.service';

export interface ItemView extends Item {
  categoryName: string | null;
  /** From the ledger, never from a column — there is no column. */
  balance: number;
  /** The same balance expressed in the pack a clerk buys in. */
  balanceInPacks: number | null;
  belowReorder: boolean;
}

/**
 * The catalogue: who the school buys from, how the store is filed, and
 * what is in it.
 *
 * Two rules run through all three halves:
 *
 *  - **A master in use is refused deletion with a count**, never
 *    cascaded (the M06 rule). Here it matters more than usual: an item
 *    with ledger rows behind it is the label on a stock history, and
 *    erasing it would make every register printed since then
 *    unreadable.
 *  - **A quantity is never stored on the item.** `balance` on the view
 *    comes from `StockService`, so the catalogue screen and the stock
 *    report cannot disagree — there is nothing for them to disagree
 *    about.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly suppliers: SuppliersRepository,
    private readonly categories: ItemCategoriesRepository,
    private readonly items: ItemsRepository,
    private readonly stock: StockService,
    private readonly audit: AuditContextService,
  ) {}

  // ── suppliers ───────────────────────────────────────────────────────

  async listSuppliers(query: SupplierQueryDto, actor: AccessTokenPayload) {
    return this.suppliers.paginate(query, {
      searchColumns: ['name', 'contactPerson', 'phone'],
      sortableColumns: ['name', 'createdAt'],
      schoolId: actor.schoolId,
      where: query.status ? { status: query.status } : {},
    });
  }

  async getSupplier(id: string, actor: AccessTokenPayload): Promise<Supplier> {
    return this.suppliers.findByIdOrFail(id, actor.schoolId);
  }

  async createSupplier(dto: UpsertSupplierDto, actor: AccessTokenPayload) {
    await this.assertSupplierNameFree(dto.name, actor.schoolId);
    this.assertBlacklistReason(dto);

    const created = await this.suppliers.create({
      schoolId: actor.schoolId,
      name: dto.name.trim(),
      contactPerson: dto.contactPerson?.trim() || null,
      phone: dto.phone?.trim() || null,
      email: dto.email?.trim().toLowerCase() || null,
      address: dto.address?.trim() || null,
      status: dto.status ?? SupplierStatus.ACTIVE,
      statusReason: dto.statusReason?.trim() || null,
      notes: dto.notes?.trim() || null,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'Supplier',
      entityId: created.id,
      newValues: { name: created.name, status: created.status },
    });
    return created;
  }

  async updateSupplier(
    id: string,
    dto: UpsertSupplierDto,
    actor: AccessTokenPayload,
  ) {
    const existing = await this.suppliers.findByIdOrFail(id, actor.schoolId);
    if (dto.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertSupplierNameFree(dto.name, actor.schoolId, id);
    }
    this.assertBlacklistReason(dto);

    const updated = await this.suppliers.update(id, {
      name: dto.name.trim(),
      contactPerson: dto.contactPerson?.trim() || null,
      phone: dto.phone?.trim() || null,
      email: dto.email?.trim().toLowerCase() || null,
      address: dto.address?.trim() || null,
      status: dto.status ?? existing.status,
      statusReason: dto.statusReason?.trim() || null,
      notes: dto.notes?.trim() || null,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'Supplier',
      entityId: id,
      oldValues: { name: existing.name, status: existing.status },
      newValues: { name: updated.name, status: updated.status },
    });
    return updated;
  }

  async removeSupplier(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.suppliers.findByIdOrFail(id, actor.schoolId);
    const purchases = await this.suppliers.countPurchases(id);
    if (purchases > 0) {
      throw new ConflictException(
        `${existing.name} has ${purchases} purchase(s) on file — set them to INACTIVE instead, so the delivery history keeps its supplier`,
      );
    }
    await this.suppliers.softDelete(id);
    this.audit.set({
      entityType: 'Supplier',
      entityId: id,
      oldValues: { name: existing.name },
    });
  }

  // ── categories ──────────────────────────────────────────────────────

  /**
   * The whole tree in one read, with per-node item counts. A store has
   * tens of categories, not thousands, so this is a full load rather than
   * a lazy expand — and it lets the cycle check below run in memory.
   */
  async categoryTree(schoolId: string): Promise<CategoryNode[]> {
    const [rows, counts] = await Promise.all([
      this.categories.findAllLive(schoolId),
      this.categories.itemCounts(schoolId),
    ]);

    const nodes = new Map<string, CategoryNode>(
      rows.map((row) => [
        row.id,
        { ...row, children: [], itemCount: counts.get(row.id) ?? 0 },
      ]),
    );

    const roots: CategoryNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async createCategory(dto: UpsertCategoryDto, actor: AccessTokenPayload) {
    const parentId = dto.parentId ?? null;
    if (parentId) {
      await this.categories.findByIdOrFail(parentId, actor.schoolId);
    }
    await this.assertSiblingNameFree(actor.schoolId, parentId, dto.name);

    const created = await this.categories.create({
      schoolId: actor.schoolId,
      parentId,
      name: dto.name.trim(),
      nameBn: dto.nameBn?.trim() || null,
      description: dto.description?.trim() || null,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'ItemCategory',
      entityId: created.id,
      newValues: { name: created.name, parentId },
    });
    return created;
  }

  async updateCategory(
    id: string,
    dto: UpsertCategoryDto,
    actor: AccessTokenPayload,
  ) {
    const existing = await this.categories.findByIdOrFail(id, actor.schoolId);
    const parentId = dto.parentId ?? null;

    if (parentId !== existing.parentId) {
      if (parentId) await this.assertNoCycle(id, parentId, actor.schoolId);
    }
    if (
      parentId !== existing.parentId ||
      dto.name.trim().toLowerCase() !== existing.name.toLowerCase()
    ) {
      await this.assertSiblingNameFree(actor.schoolId, parentId, dto.name, id);
    }

    const updated = await this.categories.update(id, {
      parentId,
      name: dto.name.trim(),
      nameBn: dto.nameBn?.trim() || null,
      description: dto.description?.trim() || null,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'ItemCategory',
      entityId: id,
      oldValues: { name: existing.name, parentId: existing.parentId },
      newValues: { name: updated.name, parentId },
    });
    return updated;
  }

  async removeCategory(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.categories.findByIdOrFail(id, actor.schoolId);
    const [children, items] = await Promise.all([
      this.categories.countChildren(id),
      this.categories.countItems(id),
    ]);
    if (children > 0) {
      throw new ConflictException(
        `"${existing.name}" has ${children} sub-categor(ies) — move or remove them first`,
      );
    }
    if (items > 0) {
      throw new ConflictException(
        `"${existing.name}" holds ${items} item(s) — re-file them before removing it`,
      );
    }
    await this.categories.softDelete(id);
    this.audit.set({
      entityType: 'ItemCategory',
      entityId: id,
      oldValues: { name: existing.name },
    });
  }

  // ── items ───────────────────────────────────────────────────────────

  async listItems(query: ItemQueryDto, actor: AccessTokenPayload) {
    const page = await this.items.paginate(query, {
      searchColumns: ['name', 'code'],
      sortableColumns: ['name', 'code', 'createdAt'],
      schoolId: actor.schoolId,
      where: {
        ...(query.type ? { type: query.type } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      },
    });

    const data = await this.decorate(actor.schoolId, page.data);
    // The low-stock filter is applied AFTER the balance is resolved,
    // because "below reorder level" is a fact about the ledger and the
    // ledger is not a column this query could have filtered on. The page
    // meta therefore describes the unfiltered page — which is why the
    // low-stock REPORT, not this filter, is what the alert job reads.
    return {
      ...page,
      data: query.lowStock ? data.filter((row) => row.belowReorder) : data,
    };
  }

  async getItem(id: string, actor: AccessTokenPayload): Promise<ItemView> {
    const item = await this.items.findDetail(id, actor.schoolId);
    if (!item) throw new NotFoundException(`Item ${id} not found`);
    const [view] = await this.decorate(actor.schoolId, [item]);
    return view;
  }

  async createItem(dto: UpsertItemDto, actor: AccessTokenPayload) {
    await this.assertItemCodeFree(dto.code, actor.schoolId);
    if (dto.categoryId) {
      await this.categories.findByIdOrFail(dto.categoryId, actor.schoolId);
    }

    const created = await this.items.create({
      schoolId: actor.schoolId,
      categoryId: dto.categoryId ?? null,
      code: dto.code.trim(),
      name: dto.name.trim(),
      nameBn: dto.nameBn?.trim() || null,
      type: dto.type,
      unit: dto.unit,
      description: dto.description?.trim() || null,
      packSize:
        dto.packSize === undefined ? null : new Prisma.Decimal(dto.packSize),
      packLabel: dto.packLabel?.trim() || null,
      reorderLevel:
        dto.reorderLevel === undefined
          ? null
          : new Prisma.Decimal(dto.reorderLevel),
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'Item',
      entityId: created.id,
      newValues: { code: created.code, name: created.name, type: created.type },
    });
    return created;
  }

  async updateItem(id: string, dto: UpsertItemDto, actor: AccessTokenPayload) {
    const existing = await this.items.findByIdOrFail(id, actor.schoolId);
    if (dto.code.trim().toLowerCase() !== existing.code.toLowerCase()) {
      await this.assertItemCodeFree(dto.code, actor.schoolId, id);
    }
    if (dto.categoryId) {
      await this.categories.findByIdOrFail(dto.categoryId, actor.schoolId);
    }

    // **The type may not change once stock has moved.** ASSET and
    // CONSUMABLE are two different shapes of history — one is tagged
    // units, the other is a balance — and flipping the flag under an
    // existing ledger would leave rows nothing can explain: a consumable
    // with asset units, or an asset whose quantity was issued to a room.
    if (dto.type !== existing.type) {
      const usage = await this.items.usage(id);
      if (usage.ledger > 0 || usage.assets > 0) {
        throw new ConflictException(
          `"${existing.name}" already has stock history, so it cannot change from ${existing.type} to ${dto.type}. Create a new item instead.`,
        );
      }
    }

    const updated = await this.items.update(id, {
      categoryId: dto.categoryId ?? null,
      code: dto.code.trim(),
      name: dto.name.trim(),
      nameBn: dto.nameBn?.trim() || null,
      type: dto.type,
      unit: dto.unit ?? existing.unit,
      description: dto.description?.trim() || null,
      packSize:
        dto.packSize === undefined ? null : new Prisma.Decimal(dto.packSize),
      packLabel: dto.packLabel?.trim() || null,
      reorderLevel:
        dto.reorderLevel === undefined
          ? null
          : new Prisma.Decimal(dto.reorderLevel),
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'Item',
      entityId: id,
      oldValues: { code: existing.code, name: existing.name },
      newValues: { code: updated.code, name: updated.name },
    });
    return updated;
  }

  async removeItem(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.items.findByIdOrFail(id, actor.schoolId);
    const usage = await this.items.usage(id);

    // An item with movements behind it is the LABEL on a stock history.
    // Soft-deleting it would leave every register printed since then
    // referring to a row the catalogue no longer shows — so the refusal
    // names what is holding it, the M06 rule.
    if (usage.ledger > 0) {
      throw new ConflictException(
        `"${existing.name}" has ${usage.ledger} stock movement(s) behind it — the ledger would stop being readable. Keep it in the catalogue instead.`,
      );
    }
    if (usage.assets > 0) {
      throw new ConflictException(
        `"${existing.name}" has ${usage.assets} tagged unit(s) in the asset register`,
      );
    }
    if (usage.purchases > 0 || usage.issues > 0) {
      throw new ConflictException(
        `"${existing.name}" appears on ${usage.purchases} purchase(s) and ${usage.issues} issue slip(s)`,
      );
    }

    await this.items.softDelete(id);
    this.audit.set({
      entityType: 'Item',
      entityId: id,
      oldValues: { code: existing.code, name: existing.name },
    });
  }

  /** Items with their live balances — the issue desk's picker. */
  async itemsWithBalances(
    schoolId: string,
    filter: Parameters<ItemsRepository['findManyLive']>[1] = {},
  ): Promise<ItemView[]> {
    const rows = await this.items.findManyLive(schoolId, filter);
    return this.decorate(schoolId, rows);
  }

  // ── internals ───────────────────────────────────────────────────────

  private async decorate<
    T extends Item & { category?: { name: string } | null },
  >(schoolId: string, rows: T[]): Promise<ItemView[]> {
    if (rows.length === 0) return [];
    const balances = await this.stock.balances(
      schoolId,
      rows.map((row) => row.id),
    );

    return rows.map((row) => {
      const balance = balances.get(row.id) ?? 0;
      const packSize = row.packSize === null ? null : Number(row.packSize);
      const reorderLevel =
        row.reorderLevel === null ? null : Number(row.reorderLevel);
      return {
        ...row,
        categoryName: row.category?.name ?? null,
        balance,
        balanceInPacks: packSize ? toPackQty(balance, packSize) : null,
        belowReorder: isBelowReorder(balance, reorderLevel),
      };
    });
  }

  private assertBlacklistReason(dto: UpsertSupplierDto): void {
    if (
      dto.status === SupplierStatus.BLACKLISTED &&
      !dto.statusReason?.trim()
    ) {
      throw new BadRequestException(
        'Blacklisting a supplier needs a reason — the office refusing their next delivery has to be able to say why',
      );
    }
  }

  private async assertSupplierNameFree(
    name: string,
    schoolId: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.suppliers.findByName(schoolId, name, excludeId);
    if (clash) {
      throw new ConflictException(`"${name.trim()}" is already a supplier`);
    }
  }

  private async assertItemCodeFree(
    code: string,
    schoolId: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.items.findByCode(schoolId, code, excludeId);
    if (clash) {
      throw new ConflictException(
        `Item code "${code.trim().toUpperCase()}" belongs to "${clash.name}"`,
      );
    }
  }

  private async assertSiblingNameFree(
    schoolId: string,
    parentId: string | null,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.categories.findSibling(
      schoolId,
      parentId,
      name,
      excludeId,
    );
    if (clash) {
      throw new ConflictException(
        `A category called "${name.trim()}" already sits in the same place`,
      );
    }
  }

  /**
   * Walking UP from the proposed parent is what catches a deep cycle —
   * `chk_item_categories_shape` only sees one row and can refuse
   * self-parenting, nothing more (the M20 `wouldCycle` situation).
   *
   * Bounded by the row count so a pre-existing cycle in the data cannot
   * spin here forever; the tree is loaded once and walked in memory.
   */
  private async assertNoCycle(
    id: string,
    proposedParentId: string,
    schoolId: string,
  ): Promise<void> {
    if (proposedParentId === id) {
      throw new BadRequestException('A category cannot be its own parent');
    }

    const rows = await this.categories.findAllLive(schoolId);
    const parentOf = new Map(rows.map((row) => [row.id, row.parentId]));

    let cursor: string | null | undefined = proposedParentId;
    for (let steps = 0; steps <= rows.length && cursor; steps++) {
      if (cursor === id) {
        throw new BadRequestException(
          'That would put the category inside one of its own sub-categories',
        );
      }
      cursor = parentOf.get(cursor) ?? null;
    }
  }
}
