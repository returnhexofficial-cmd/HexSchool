import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
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
import { FeeHeadType, FeeOverrideType } from '../../../common/constants';

/** Money: non-negative, at most 2 decimals — the NUMERIC(12,2) contract. */
const MONEY = {
  maxDecimalPlaces: 2,
  allowNaN: false,
  allowInfinity: false,
} as const;

export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = { message: 'date must be YYYY-MM-DD' };

// ── fee heads ─────────────────────────────────────────────────────────

export class CreateFeeHeadDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @IsEnum(FeeHeadType)
  type?: FeeHeadType;

  /** A non-refundable head (admission fee) refuses refunds outright. */
  @IsOptional()
  @IsBoolean()
  isRefundable?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  displayOrder?: number;
}

export class UpdateFeeHeadDto extends CreateFeeHeadDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  declare name: string;
}

// ── fee structures ────────────────────────────────────────────────────

/** One cell of the class × head matrix. */
export class FeeStructureInputDto {
  @IsUUID()
  classId!: string;

  @IsUUID()
  feeHeadId!: string;

  @IsOptional()
  @IsUUID()
  groupId?: string | null;

  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  @Max(99999999)
  amount!: number;

  /** Day of month this head falls due; null inherits the school setting. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(28)
  dueDay?: number | null;
}

/**
 * Bulk save of the fee matrix. Rows absent from the payload are left
 * alone — clearing a cell is an explicit delete, because a partially
 * loaded grid must never wipe the structures it did not display.
 */
export class SaveFeeStructuresDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => FeeStructureInputDto)
  structures!: FeeStructureInputDto[];
}

export class FeeStructureQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  feeHeadId?: string;
}

/** Copy a session's whole fee structure into another (M06 clone pattern). */
export class CloneFeeStructuresDto {
  @IsUUID()
  fromSessionId!: string;

  @IsUUID()
  toSessionId!: string;

  /** Percentage to raise every amount by (a school's annual increment). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(-100)
  @Max(100)
  adjustPercent?: number;

  /** Report what would happen without writing anything. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

// ── overrides ─────────────────────────────────────────────────────────

export class CreateFeeOverrideDto {
  @IsUUID()
  enrollmentId!: string;

  @IsUUID()
  feeHeadId!: string;

  @IsEnum(FeeOverrideType)
  type!: FeeOverrideType;

  /** Percent (0–100) for DISCOUNT_PERCENT, an amount otherwise, 0 for WAIVER. */
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  @Max(99999999)
  value!: number;

  /** Mandatory — every monetary override is audited with its reason. */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  validFrom?: string | null;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  validTo?: string | null;
}

export class UpdateFeeOverrideDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  @Max(99999999)
  value?: number;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  validFrom?: string | null;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  validTo?: string | null;
}
