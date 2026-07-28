import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
import {
  AccountGroup,
  AccountType,
  BudgetPeriod,
  PostingMapKind,
  VoucherType,
} from '../../../common/constants';

/** Money: at most 2 decimals — the NUMERIC(12,2) contract (roadmap §7). */
const MONEY = {
  maxDecimalPlaces: 2,
  allowNaN: false,
  allowInfinity: false,
} as const;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = { message: 'date must be YYYY-MM-DD' };

// ── chart of accounts ─────────────────────────────────────────────────

export class CreateAccountDto {
  @IsEnum(AccountGroup)
  group!: AccountGroup;

  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameBn?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  /** A heading. Headings hold no money — a DB CHECK pins the balance to 0. */
  @IsOptional()
  @IsBoolean()
  isGroup?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  openingBalance?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  bankAccountNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  branchName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  displayOrder?: number;
}

export class UpdateAccountDto extends CreateAccountDto {
  @IsOptional()
  @IsEnum(AccountGroup)
  declare group: AccountGroup;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  declare code: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  declare name: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AccountQueryDto {
  @IsOptional()
  @IsEnum(AccountGroup)
  group?: AccountGroup;

  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Leaves only — what a voucher's account picker offers. */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  postableOnly?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  activeOnly?: boolean;
}

export class SuggestCodeQueryDto {
  @IsEnum(AccountGroup)
  group!: AccountGroup;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

// ── vouchers ──────────────────────────────────────────────────────────

export class VoucherEntryInputDto {
  @IsUUID()
  accountId!: string;

  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  debit!: number;

  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  credit!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  narration?: string;
}

export class CreateVoucherDto {
  @IsEnum(VoucherType)
  type!: VoucherType;

  @Matches(DATE_REGEX, DATE_MESSAGE)
  date!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  narration!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  attachmentUrl?: string;

  /**
   * At least two lines: one alone cannot balance, and refusing it here
   * gives a clearer message than "debits and credits differ by X".
   */
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => VoucherEntryInputDto)
  entries!: VoucherEntryInputDto[];

  /** Post immediately instead of saving a draft (needs `voucher.post`). */
  @IsOptional()
  @IsBoolean()
  post?: boolean;
}

export class UpdateVoucherDto {
  @IsOptional()
  @IsEnum(VoucherType)
  type?: VoucherType;

  @IsOptional()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  date?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  narration?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  attachmentUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => VoucherEntryInputDto)
  entries?: VoucherEntryInputDto[];
}

export class CancelVoucherDto {
  /**
   * Mandatory: a cancelled voucher leaves a reversal in the ledger
   * forever, and an unexplained pair of mirror documents is the hardest
   * thing to interpret a year later (the M15 correction-reason rule).
   */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class VoucherQueryDto {
  @IsOptional()
  @IsEnum(VoucherType)
  type?: VoucherType;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  from?: string;

  @IsOptional()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  to?: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

// ── posting map ───────────────────────────────────────────────────────

export class PostingMapEntryDto {
  @IsEnum(PostingMapKind)
  kind!: PostingMapKind;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  refKey!: string;

  /** `null` clears the mapping and falls back to the system default. */
  @IsOptional()
  @IsUUID()
  accountId?: string | null;
}

export class UpdatePostingMapDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PostingMapEntryDto)
  mappings!: PostingMapEntryDto[];
}

// ── budgets ───────────────────────────────────────────────────────────

export class CreateBudgetDto {
  @IsUUID()
  sessionId!: string;

  @IsUUID()
  accountId!: string;

  @IsOptional()
  @IsEnum(BudgetPeriod)
  period?: BudgetPeriod;

  /** Required for MONTHLY, refused for YEARLY (a DB CHECK backs this). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class UpdateBudgetDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

// ── fiscal periods ────────────────────────────────────────────────────

export class CreateFiscalPeriodDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @Matches(DATE_REGEX, DATE_MESSAGE)
  startDate!: string;

  @Matches(DATE_REGEX, DATE_MESSAGE)
  endDate!: string;
}

export class UpdateFiscalPeriodDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  startDate?: string;

  @IsOptional()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  endDate?: string;
}

export class ClosePeriodDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ReopenPeriodDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

// ── reports ───────────────────────────────────────────────────────────

export class AccountingReportQueryDto {
  @IsOptional()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  from?: string;

  @IsOptional()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  to?: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;
}

// ── the two §8 tools ──────────────────────────────────────────────────

export class SettlementDto {
  /** The gateway clearing account the gross is sitting in. */
  @IsUUID()
  clearingAccountId!: string;

  @IsUUID()
  bankAccountId!: string;

  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0.01)
  gross!: number;

  /** The commission the gateway kept — recognised as an expense. */
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  charges!: number;

  @Matches(DATE_REGEX, DATE_MESSAGE)
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}

export class OpeningBalanceLineDto {
  @IsUUID()
  accountId!: string;

  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  debit!: number;

  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  credit!: number;
}

export class OpeningBalancesDto {
  @Matches(DATE_REGEX, DATE_MESSAGE)
  date!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => OpeningBalanceLineDto)
  lines!: OpeningBalanceLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  narration?: string;
}
