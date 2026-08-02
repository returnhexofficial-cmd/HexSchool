import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssetUnit,
  AssetUnitStatus,
  InventoryHolderType,
  ItemType,
  Prisma,
  StockTxnType,
} from '@prisma/client';
import { dhakaToday } from '../../../common/utils/clock.util';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { SequenceService } from '../../sequence/sequence.service';
import {
  canTransition,
  normalizeAssetTag,
  warrantyStatus,
  type WarrantyStatus,
} from '../calc/asset.engine';
import { REF_TYPES } from '../calc/stock-ledger.engine';
import type {
  AssetQueryDto,
  AssignAssetDto,
  DisposeAssetDto,
  HolderDto,
  RepairAssetDto,
  UpsertAssetDto,
} from '../dto';
import {
  AssetUnitsRepository,
  type AssetWithRelations,
} from '../repositories/assets.repository';
import { ItemsRepository } from '../repositories/catalog.repository';
import { InventoryDirectoryRepository } from '../repositories/inventory-directory.repository';
import { InventorySettingsService } from './inventory-settings.service';
import { StockService } from './stock.service';

export interface AssetView extends AssetWithRelations {
  custodianName: string | null;
  warranty: WarrantyStatus;
}

/**
 * The asset register: tagged units, where they are, who has them, and
 * what happens when one breaks or disappears.
 *
 * **Every status move goes through `canTransition`**, so the lifecycle is
 * one table in one engine rather than a condition repeated in four
 * endpoints — and the transitions that are missing from it (anything out
 * of DISPOSED or LOST) are refusals no permission reaches, because a
 * write-off is an approved act with a name on it.
 *
 * **The custodian is resolved live, never snapshotted.** A register that
 * stored "Mr Rahman" would keep printing it after he left, and "who has
 * the projector" has to be a question about now.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly assets: AssetUnitsRepository,
    private readonly items: ItemsRepository,
    private readonly directory: InventoryDirectoryRepository,
    private readonly stock: StockService,
    private readonly sequences: SequenceService,
    private readonly schools: SchoolsRepository,
    private readonly config: InventorySettingsService,
    private readonly audit: AuditContextService,
  ) {}

  async list(query: AssetQueryDto, actor: AccessTokenPayload) {
    const page = await this.assets.paginate(query, {
      searchColumns: ['assetTag', 'serialNo', 'locationText'],
      sortableColumns: ['assetTag', 'status', 'createdAt'],
      schoolId: actor.schoolId,
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.onBooksOnly
          ? {
              status: {
                in: [
                  AssetUnitStatus.IN_STORE,
                  AssetUnitStatus.ASSIGNED,
                  AssetUnitStatus.UNDER_REPAIR,
                ],
              },
            }
          : {}),
        ...(query.itemId ? { itemId: query.itemId } : {}),
        ...(query.categoryId ? { item: { categoryId: query.categoryId } } : {}),
        ...(query.custodianType ? { custodianType: query.custodianType } : {}),
        ...(query.departmentId ? { custodianDeptId: query.departmentId } : {}),
        ...(query.personId ? { custodianPersonId: query.personId } : {}),
      },
    });

    const detailed = await this.assets.findManyLive(actor.schoolId, {
      status: query.status,
    });
    const byId = new Map(detailed.map((row) => [row.id, row]));

    const data: AssetView[] = [];
    for (const row of page.data) {
      const full = byId.get(row.id);
      if (full) data.push(await this.decorate(actor.schoolId, full));
    }
    return { ...page, data };
  }

  async get(id: string, actor: AccessTokenPayload): Promise<AssetView> {
    const asset = await this.assets.findDetail(id, actor.schoolId);
    if (!asset) throw new NotFoundException(`Asset ${id} not found`);
    return this.decorate(actor.schoolId, asset);
  }

  /**
   * Register a unit the school already owns — roadmap's adoption path,
   * since a delivery's units are generated at RECEIVE instead.
   *
   * A supplied tag is honoured (the furniture is already labelled); an
   * omitted one is claimed from the same sequence a receipt uses, so both
   * paths share one numbering and neither can collide with the other.
   */
  async create(dto: UpsertAssetDto, actor: AccessTokenPayload) {
    const item = await this.items.findByIdOrFail(dto.itemId, actor.schoolId);
    if (item.type !== ItemType.ASSET) {
      throw new BadRequestException(
        `"${item.name}" is a consumable — it is counted in the stock ledger, not tagged in the asset register`,
      );
    }
    this.assertWarrantyOrder(dto);

    if (dto.assetTag) await this.assertTagFree(dto.assetTag, actor.schoolId);
    if (dto.serialNo) await this.assertSerialFree(dto.serialNo, actor.schoolId);

    const cfg = await this.config.load(actor.schoolId);
    const school = await this.schools.findByIdOrFail(actor.schoolId);

    const created = await this.stock.withTransaction(async (tx) => {
      const assetTag = normalizeAssetTag(
        dto.assetTag ??
          (await this.sequences.nextDocumentNumber({
            schoolId: actor.schoolId,
            counterKey: 'inventory-asset',
            pattern: cfg.assetTagPattern,
            schoolCode: school.code,
            tx,
          })),
      );

      return this.assets.create(
        {
          schoolId: actor.schoolId,
          itemId: dto.itemId,
          assetTag,
          serialNo: dto.serialNo?.trim() || null,
          status: AssetUnitStatus.IN_STORE,
          condition: dto.condition,
          locationText: dto.locationText?.trim() || null,
          purchasePrice:
            dto.purchasePrice === undefined
              ? null
              : new Prisma.Decimal(dto.purchasePrice),
          purchaseDate: dto.purchaseDate ? parseDate(dto.purchaseDate) : null,
          warrantyUntil: dto.warrantyUntil
            ? parseDate(dto.warrantyUntil)
            : null,
          notes: dto.notes?.trim() || null,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );
    });

    this.audit.set({
      entityType: 'AssetUnit',
      entityId: created.id,
      newValues: { assetTag: created.assetTag, itemId: dto.itemId },
    });
    return this.get(created.id, actor);
  }

  async update(id: string, dto: UpsertAssetDto, actor: AccessTokenPayload) {
    const existing = await this.assets.findByIdOrFail(id, actor.schoolId);
    this.assertOnBooks(existing, 'edited');
    this.assertWarrantyOrder(dto);

    if (
      dto.assetTag &&
      normalizeAssetTag(dto.assetTag) !== normalizeAssetTag(existing.assetTag)
    ) {
      await this.assertTagFree(dto.assetTag, actor.schoolId, id);
    }
    if (
      dto.serialNo &&
      dto.serialNo.trim().toUpperCase() !== existing.serialNo?.toUpperCase()
    ) {
      await this.assertSerialFree(dto.serialNo, actor.schoolId, id);
    }

    const updated = await this.assets.update(id, {
      assetTag: dto.assetTag
        ? normalizeAssetTag(dto.assetTag)
        : existing.assetTag,
      serialNo: dto.serialNo?.trim() || null,
      condition: dto.condition ?? existing.condition,
      locationText: dto.locationText?.trim() || null,
      purchasePrice:
        dto.purchasePrice === undefined
          ? null
          : new Prisma.Decimal(dto.purchasePrice),
      purchaseDate: dto.purchaseDate ? parseDate(dto.purchaseDate) : null,
      warrantyUntil: dto.warrantyUntil ? parseDate(dto.warrantyUntil) : null,
      notes: dto.notes?.trim() || null,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'AssetUnit',
      entityId: id,
      oldValues: { assetTag: existing.assetTag, condition: existing.condition },
      newValues: { assetTag: updated.assetTag, condition: updated.condition },
    });
    return this.get(id, actor);
  }

  /**
   * Assign or transfer — roadmap §4's "asset assignment/transfer
   * (custodian history via audit)".
   *
   * Both are the same call, because a transfer IS an assignment to
   * somebody else: `canTransition` allows ASSIGNED → ASSIGNED for exactly
   * that reason. The custodian *history* is the audit log (§4 says so),
   * which is why the old and new custodians are written into the diff
   * rather than into a table this module does not have.
   */
  async assign(id: string, dto: AssignAssetDto, actor: AccessTokenPayload) {
    const existing = await this.assets.findByIdOrFail(id, actor.schoolId);
    const verdict = canTransition(existing.status, AssetUnitStatus.ASSIGNED);
    if (!verdict.allowed) throw new ConflictException(verdict.reason);

    await this.assertHolder(dto.custodian, actor.schoolId);
    const previous = await this.custodianLabel(actor.schoolId, existing);

    const updated = await this.assets.update(id, {
      status: AssetUnitStatus.ASSIGNED,
      ...this.custodianColumns(dto.custodian),
      locationText: dto.locationText?.trim() || existing.locationText || null,
      updatedBy: actor.sub,
    });

    const next = await this.custodianLabel(actor.schoolId, updated);
    this.audit.set({
      entityType: 'AssetUnit',
      entityId: id,
      oldValues: { status: existing.status, custodian: previous },
      newValues: {
        status: AssetUnitStatus.ASSIGNED,
        custodian: next,
        remarks: dto.remarks?.trim() || null,
      },
    });

    return this.get(id, actor);
  }

  /** Back to the store — the custodian columns are cleared to all-NULL,
   *  which is the branch `chk_asset_units_custodian` keeps for "held by
   *  nobody". */
  async returnToStore(id: string, actor: AccessTokenPayload) {
    const existing = await this.assets.findByIdOrFail(id, actor.schoolId);
    const verdict = canTransition(existing.status, AssetUnitStatus.IN_STORE);
    if (!verdict.allowed) throw new ConflictException(verdict.reason);

    const previous = await this.custodianLabel(actor.schoolId, existing);
    await this.assets.update(id, {
      status: AssetUnitStatus.IN_STORE,
      ...this.clearedCustodian(),
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'AssetUnit',
      entityId: id,
      oldValues: { status: existing.status, custodian: previous },
      newValues: { status: AssetUnitStatus.IN_STORE, custodian: null },
    });
    return this.get(id, actor);
  }

  /** Into the workshop. The custodian is KEPT: the projector is still the
   *  science department's, it is merely away being fixed, and clearing it
   *  would lose who to give it back to. */
  async sendForRepair(
    id: string,
    dto: RepairAssetDto,
    actor: AccessTokenPayload,
  ) {
    const existing = await this.assets.findByIdOrFail(id, actor.schoolId);
    const verdict = canTransition(
      existing.status,
      AssetUnitStatus.UNDER_REPAIR,
    );
    if (!verdict.allowed) throw new ConflictException(verdict.reason);

    await this.assets.update(id, {
      status: AssetUnitStatus.UNDER_REPAIR,
      ...(dto.condition ? { condition: dto.condition } : {}),
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'AssetUnit',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: {
        status: AssetUnitStatus.UNDER_REPAIR,
        remarks: dto.remarks?.trim() || null,
      },
    });
    return this.get(id, actor);
  }

  /** Out of the workshop — back to whoever had it, or to the store. */
  async completeRepair(
    id: string,
    dto: RepairAssetDto,
    actor: AccessTokenPayload,
  ) {
    const existing = await this.assets.findByIdOrFail(id, actor.schoolId);
    if (existing.status !== AssetUnitStatus.UNDER_REPAIR) {
      throw new ConflictException(
        `${existing.assetTag} is not in for repair — it is ${existing.status}`,
      );
    }

    if (dto.returnTo) {
      await this.assertHolder(dto.returnTo, actor.schoolId);
      await this.assets.update(id, {
        status: AssetUnitStatus.ASSIGNED,
        ...this.custodianColumns(dto.returnTo),
        ...(dto.condition ? { condition: dto.condition } : {}),
        updatedBy: actor.sub,
      });
    } else if (existing.custodianType) {
      // It kept its custodian while it was away, so completing the repair
      // simply hands it back — no re-assignment step for the office.
      await this.assets.update(id, {
        status: AssetUnitStatus.ASSIGNED,
        ...(dto.condition ? { condition: dto.condition } : {}),
        updatedBy: actor.sub,
      });
    } else {
      await this.assets.update(id, {
        status: AssetUnitStatus.IN_STORE,
        ...(dto.condition ? { condition: dto.condition } : {}),
        updatedBy: actor.sub,
      });
    }

    this.audit.set({
      entityType: 'AssetUnit',
      entityId: id,
      oldValues: { status: AssetUnitStatus.UNDER_REPAIR },
      newValues: { repaired: true, remarks: dto.remarks?.trim() || null },
    });
    return this.get(id, actor);
  }

  /**
   * Roadmap §6: "disposal needs approval permission". The controller
   * carries `inventory.asset.dispose`, which the Office Staff baseline
   * deliberately lacks — writing a projector off is a decision with a
   * name on it, and `disposed_by` is where the name goes.
   *
   * A disposal also writes a **DISPOSE row in the stock ledger** when the
   * unit's item still carries a balance, so the two registers agree that
   * the school has one fewer of the thing. Assets are counted by rows
   * rather than by balance, so a school that never ran its assets through
   * the ledger simply has nothing to reverse — hence the guard rather
   * than an unconditional movement.
   */
  async dispose(id: string, dto: DisposeAssetDto, actor: AccessTokenPayload) {
    if (
      dto.status !== AssetUnitStatus.DISPOSED &&
      dto.status !== AssetUnitStatus.LOST
    ) {
      throw new BadRequestException(
        'A write-off is recorded as DISPOSED or LOST',
      );
    }

    const existing = await this.assets.findByIdOrFail(id, actor.schoolId);
    const verdict = canTransition(existing.status, dto.status);
    if (!verdict.allowed) throw new ConflictException(verdict.reason);

    const disposedAt = parseDate(dto.disposedAt);
    if (existing.purchaseDate && disposedAt < existing.purchaseDate) {
      throw new BadRequestException(
        `${existing.assetTag} cannot be written off on ${dto.disposedAt}, before it was bought on ${isoDate(existing.purchaseDate)}`,
      );
    }

    await this.stock.withTransaction(async (tx) => {
      await tx.assetUnit.update({
        where: { id },
        data: {
          status: dto.status,
          disposedAt,
          disposalReason: dto.reason.trim(),
          disposedBy: actor.sub,
          // A written-off unit is held by nobody. Leaving the custodian
          // set would keep it in "what does the science department
          // hold?", which is the report a disposal exists to correct.
          ...this.clearedCustodian(),
          updatedBy: actor.sub,
        },
      });

      const balance = await this.stock.balanceFor(
        actor.schoolId,
        existing.itemId,
      );
      if (balance >= 1) {
        await this.stock.record(tx, actor.schoolId, actor.sub, {
          itemId: existing.itemId,
          txn: StockTxnType.DISPOSE,
          quantity: 1,
          refType: REF_TYPES.ASSET,
          refId: id,
          remarks: `${existing.assetTag} ${dto.status.toLowerCase()}: ${dto.reason.trim()}`,
        });
      }
    });

    this.audit.set({
      entityType: 'AssetUnit',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: {
        status: dto.status,
        reason: dto.reason.trim(),
        disposedAt: dto.disposedAt,
      },
    });
    return this.get(id, actor);
  }

  /** Roadmap §4's warranty-expiring report. */
  async warrantyAlerts(schoolId: string, days?: number) {
    const cfg = await this.config.load(schoolId);
    const window = days ?? cfg.warrantyAlertDays;
    const today = dhakaToday();

    const rows = await this.assets.findManyLive(schoolId, {
      onBooksOnly: true,
    });
    return rows
      .map((row) => ({
        id: row.id,
        assetTag: row.assetTag,
        itemName: row.item.name,
        status: row.status,
        locationText: row.locationText,
        warranty: warrantyStatus(
          row.warrantyUntil ? isoDate(row.warrantyUntil) : null,
          today,
          window,
        ),
      }))
      .filter((row) => row.warranty.state !== 'ACTIVE');
  }

  // ── internals ───────────────────────────────────────────────────────

  private assertOnBooks(asset: AssetUnit, verb: string): void {
    if (
      asset.status === AssetUnitStatus.DISPOSED ||
      asset.status === AssetUnitStatus.LOST
    ) {
      throw new ConflictException(
        `${asset.assetTag} was recorded as ${asset.status.toLowerCase()} and can no longer be ${verb}`,
      );
    }
  }

  private assertWarrantyOrder(dto: UpsertAssetDto): void {
    if (
      dto.warrantyUntil &&
      dto.purchaseDate &&
      parseDate(dto.warrantyUntil) < parseDate(dto.purchaseDate)
    ) {
      throw new BadRequestException(
        `A warranty ending ${dto.warrantyUntil} would have expired before the purchase on ${dto.purchaseDate}`,
      );
    }
  }

  private async assertTagFree(
    assetTag: string,
    schoolId: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.assets.findByTag(schoolId, assetTag, excludeId);
    if (clash) {
      // The index ignores soft deletes, so the clash may be a row nobody
      // can see. Saying so is the difference between a usable message and
      // "that tag exists but I cannot show it to you".
      throw new ConflictException(
        clash.deletedAt
          ? `Tag ${normalizeAssetTag(assetTag)} was used by a unit that has since been removed. Asset tags are never reused — a label already stuck to something must not name a second thing.`
          : `Tag ${normalizeAssetTag(assetTag)} is already on another unit`,
      );
    }
  }

  private async assertSerialFree(
    serialNo: string,
    schoolId: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.assets.findBySerial(schoolId, serialNo, excludeId);
    if (clash) {
      throw new ConflictException(
        `Serial ${serialNo.trim()} is already registered as ${clash.assetTag}`,
      );
    }
  }

  private async assertHolder(
    holder: HolderDto,
    schoolId: string,
  ): Promise<void> {
    if (holder.type === InventoryHolderType.DEPARTMENT) {
      if (!holder.departmentId) {
        throw new BadRequestException(
          'Choose the department that will hold it',
        );
      }
      if (
        !(await this.directory.departmentExists(schoolId, holder.departmentId))
      ) {
        throw new NotFoundException(
          `Department ${holder.departmentId} not found`,
        );
      }
      return;
    }
    if (holder.type === InventoryHolderType.PERSON) {
      if (!holder.personType || !holder.personId) {
        throw new BadRequestException('Choose the person who will hold it');
      }
      if (
        !(await this.directory.lookup(
          schoolId,
          holder.personType,
          holder.personId,
        ))
      ) {
        throw new NotFoundException('That employee record was not found');
      }
      return;
    }
    if (!holder.room?.trim()) {
      throw new BadRequestException('Name the room it will live in');
    }
  }

  private custodianColumns(holder: HolderDto) {
    return {
      custodianType: holder.type,
      custodianDeptId:
        holder.type === InventoryHolderType.DEPARTMENT
          ? (holder.departmentId ?? null)
          : null,
      custodianPersonType:
        holder.type === InventoryHolderType.PERSON
          ? (holder.personType ?? null)
          : null,
      custodianPersonId:
        holder.type === InventoryHolderType.PERSON
          ? (holder.personId ?? null)
          : null,
      custodianRoom:
        holder.type === InventoryHolderType.ROOM
          ? (holder.room?.trim() ?? null)
          : null,
    };
  }

  /** The all-NULL branch of `chk_asset_units_custodian`. */
  private clearedCustodian() {
    return {
      custodianType: null,
      custodianDeptId: null,
      custodianPersonType: null,
      custodianPersonId: null,
      custodianRoom: null,
    };
  }

  private async custodianLabel(
    schoolId: string,
    asset: AssetUnit,
  ): Promise<string | null> {
    if (!asset.custodianType) return null;
    if (asset.custodianType === InventoryHolderType.ROOM) {
      return asset.custodianRoom;
    }
    if (asset.custodianType === InventoryHolderType.DEPARTMENT) {
      if (!asset.custodianDeptId) return null;
      const departments = await this.directory.departments(schoolId);
      return (
        departments.find((d) => d.id === asset.custodianDeptId)?.name ?? null
      );
    }
    if (!asset.custodianPersonType || !asset.custodianPersonId) return null;
    const person = await this.directory.lookup(
      schoolId,
      asset.custodianPersonType,
      asset.custodianPersonId,
    );
    return person ? `${person.name} (${person.reference})` : null;
  }

  private async decorate(
    schoolId: string,
    asset: AssetWithRelations,
  ): Promise<AssetView> {
    const cfg = await this.config.load(schoolId);
    return {
      ...asset,
      custodianName:
        asset.custodianType === InventoryHolderType.DEPARTMENT
          ? (asset.custodianDept?.name ?? null)
          : await this.custodianLabel(schoolId, asset),
      warranty: warrantyStatus(
        asset.warrantyUntil ? isoDate(asset.warrantyUntil) : null,
        dhakaToday(),
        cfg.warrantyAlertDays,
      ),
    };
  }
}
