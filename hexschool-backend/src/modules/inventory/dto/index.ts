import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  AssetCondition,
  AssetUnitStatus,
  InventoryHolderType,
  InventoryPersonType,
  ItemType,
  ItemUnit,
  PurchaseStatus,
  StockIssueStatus,
  SupplierStatus,
} from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Money: two decimals, the NUMERIC(12,2) contract. */
const MONEY = {
  maxDecimalPlaces: 2,
  allowNaN: false,
  allowInfinity: false,
} as const;

/** Quantity: three decimals, the NUMERIC(14,3) contract (roadmap §7). */
const QUANTITY = {
  maxDecimalPlaces: 3,
  allowNaN: false,
  allowInfinity: false,
} as const;

/** BD mobile, the PROJECT_CONTEXT §12 shape. */
const BD_PHONE = /^01[3-9]\d{8}$/;

/**
 * A line grid is bounded. 200 is the same ceiling M23 put on bulk copy
 * generation and for the same reason: an unbounded loop claiming sequence
 * numbers inside one transaction is the M20 transaction-budget lesson.
 */
const MAX_LINES = 200;

// ── suppliers ─────────────────────────────────────────────────────────

export class UpsertSupplierDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactPerson?: string;

  @IsOptional()
  @Matches(BD_PHONE, { message: 'phone must be a valid BD mobile number' })
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsEnum(SupplierStatus)
  status?: SupplierStatus;

  /**
   * Mandatory when the status is BLACKLISTED — enforced in the service so
   * the message can say why, and by `chk_suppliers_shape` so a future
   * write path cannot skip it (the M07 status-reason rule).
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  statusReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class SupplierQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(SupplierStatus)
  status?: SupplierStatus;
}

// ── categories ────────────────────────────────────────────────────────

export class UpsertCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameBn?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

// ── items ─────────────────────────────────────────────────────────────

export class UpsertItemDto {
  /**
   * The school's own catalogue label. Free-form (a BD school writes
   * "STA-01", "স্টেশনারি-১" or "12/A"), unique among live rows — the
   * uniqueness is what the module needs and that is a database index.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  nameBn?: string;

  @IsEnum(ItemType)
  type!: ItemType;

  @IsOptional()
  @IsEnum(ItemUnit)
  unit?: ItemUnit;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** §8's `box_size`: base units per pack. Omit for an unpacked item. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber(QUANTITY)
  @Min(0.001)
  @Max(100000)
  packSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  packLabel?: string;

  /** Omit to opt out of low-stock alerts — which is NOT the same as 0. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber(QUANTITY)
  @Min(0)
  reorderLevel?: number;
}

export class ItemQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ItemType)
  type?: ItemType;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** Only items at or under their reorder level. */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  lowStock?: boolean;
}

// ── purchases ─────────────────────────────────────────────────────────

export class PurchaseLineDto {
  @IsUUID()
  itemId!: string;

  /** As entered — in packs when the item has one. */
  @Type(() => Number)
  @IsNumber(QUANTITY)
  @Min(0.001)
  qty!: number;

  /** Per ENTERED unit, matching the supplier's invoice. */
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}

export class UpsertPurchaseDto {
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsISO8601()
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  invoiceRef?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  lines!: PurchaseLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

export class PurchaseQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(PurchaseStatus)
  status?: PurchaseStatus;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class ReceivePurchaseDto {
  /**
   * ASSET lines generate one tagged unit per base quantity at RECEIVE
   * (roadmap §4). These are the optional details the store keeper can
   * give the batch — the tags themselves come from `SequenceService`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  locationText?: string;

  @IsOptional()
  @IsUUID()
  custodianDeptId?: string;

  @IsOptional()
  @IsISO8601()
  warrantyUntil?: string;

  @IsOptional()
  @IsEnum(AssetCondition)
  condition?: AssetCondition;
}

export class CancelPurchaseDto {
  /**
   * Mandatory. Cancelling a RECEIVED purchase writes reversing ledger
   * entries against stock a school may already have issued, so "why" is
   * the first question anybody reading the register will ask.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

// ── the holder shape, shared by issues and asset custody ──────────────

/**
 * One shape for "who has it", used by the issue recipient and the asset
 * custodian. `chk_stock_issues_recipient` and `chk_asset_units_custodian`
 * are the database's copy of these rules; the service checks first so the
 * message can name the missing field rather than surfacing a constraint.
 */
export class HolderDto {
  @IsEnum(InventoryHolderType)
  type!: InventoryHolderType;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsEnum(InventoryPersonType)
  personType?: InventoryPersonType;

  @IsOptional()
  @IsUUID()
  personId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  room?: string;
}

// ── issues ────────────────────────────────────────────────────────────

export class IssueLineDto {
  @IsUUID()
  itemId!: string;

  /**
   * In the item's BASE unit. The desk converts before it posts, because
   * the ledger only ever speaks base units and a slip that meant boxes
   * would be a second place that conversion could go wrong.
   */
  @Type(() => Number)
  @IsNumber(QUANTITY)
  @Min(0.001)
  qty!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}

export class CreateIssueDto {
  @IsISO8601()
  issueDate!: string;

  @ValidateNested()
  @Type(() => HolderDto)
  issuedTo!: HolderDto;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => IssueLineDto)
  lines!: IssueLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  purpose?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

export class ReturnLineDto {
  /** The issue LINE, not the item — a return credits a specific row. */
  @IsUUID()
  issueItemId!: string;

  @Type(() => Number)
  @IsNumber(QUANTITY)
  @Min(0.001)
  qty!: number;
}

export class ReturnIssueDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines!: ReturnLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}

export class IssueQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(StockIssueStatus)
  status?: StockIssueStatus;

  @IsOptional()
  @IsEnum(InventoryHolderType)
  issuedToType?: InventoryHolderType;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

// ── adjustments ───────────────────────────────────────────────────────

export class AdjustmentLineDto {
  @IsUUID()
  itemId!: string;

  /** What the count sheet says is actually on the shelf, in base units. */
  @Type(() => Number)
  @IsNumber(QUANTITY)
  @Min(0)
  countedQty!: number;
}

export class CreateAdjustmentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => AdjustmentLineDto)
  lines!: AdjustmentLineDto[];

  /**
   * Mandatory, and pinned by `chk_stock_ledger_reason`. An adjustment
   * with no reason on it is exactly the movement a stock-take dispute
   * turns on (roadmap §4: "permission + reason").
   */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

// ── assets ────────────────────────────────────────────────────────────

export class UpsertAssetDto {
  @IsUUID()
  itemId!: string;

  /**
   * Optional on create: omitted, the module claims the next tag from
   * `SequenceService`. Supplied, it is a school entering furniture it
   * already owns and already labelled.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  assetTag?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  serialNo?: string;

  @IsOptional()
  @IsEnum(AssetCondition)
  condition?: AssetCondition;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  locationText?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  purchasePrice?: number;

  @IsOptional()
  @IsISO8601()
  purchaseDate?: string;

  /** Roadmap §7: must not predate `purchaseDate`. */
  @IsOptional()
  @IsISO8601()
  warrantyUntil?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class AssignAssetDto {
  @ValidateNested()
  @Type(() => HolderDto)
  custodian!: HolderDto;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  locationText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}

export class RepairAssetDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;

  /** Where it came back to; omit to send it to the store. */
  @IsOptional()
  @ValidateNested()
  @Type(() => HolderDto)
  returnTo?: HolderDto;

  @IsOptional()
  @IsEnum(AssetCondition)
  condition?: AssetCondition;
}

export class DisposeAssetDto {
  /** DISPOSED (written off) or LOST (cannot be found). */
  @IsEnum(AssetUnitStatus)
  status!: AssetUnitStatus;

  @IsISO8601()
  disposedAt!: string;

  /** Mandatory, and pinned by `chk_asset_units_disposal_evidence`. */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class AssetQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(AssetUnitStatus)
  status?: AssetUnitStatus;

  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsEnum(InventoryHolderType)
  custodianType?: InventoryHolderType;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  personId?: string;

  /** Apply roadmap §6's register filter (drop DISPOSED and LOST). */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  onBooksOnly?: boolean;
}

// ── reports ───────────────────────────────────────────────────────────

export class InventoryReportQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsEnum(ItemType)
  type?: ItemType;
}

export class ItemLedgerQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class WarrantyReportQueryDto {
  /** Days ahead to look; defaults to the `inventory.*` setting. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  days?: number;
}

export class HolderSearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;
}
