import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  BookCondition,
  BookCopyStatus,
  BookReservationStatus,
  LibraryMemberStatus,
  LibraryMemberType,
} from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Money: two decimals, the NUMERIC(12,2) contract. */
const MONEY = {
  maxDecimalPlaces: 2,
  allowNaN: false,
  allowInfinity: false,
} as const;

// ── masters ───────────────────────────────────────────────────────────

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
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpsertAuthorDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  nameBn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class UpsertPublisherDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  nameBn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;
}

export class MasterQueryDto extends PaginationQueryDto {}

// ── books ─────────────────────────────────────────────────────────────

export class CreateBookDto {
  @IsString()
  @MinLength(2)
  @MaxLength(250)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  titleBn?: string;

  /** Validated by checksum, not by shape — see `isbn.util.ts`. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  isbn?: string;

  @IsUUID()
  categoryId!: string;

  @IsOptional()
  @IsUUID()
  publisherId?: string;

  /**
   * Author ids. A librarian typing a name that is not yet a master uses
   * `authorNames` instead — cataloguing a book should not require
   * leaving the form to create an author first.
   */
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  @ArrayMaxSize(10)
  authorIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  authorNames?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  edition?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  language?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  rackNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}

export class UpdateBookDto extends CreateBookDto {
  @IsOptional()
  declare title: string;

  @IsOptional()
  declare categoryId: string;
}

export class BookQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  publisherId?: string;

  @IsOptional()
  @IsUUID()
  authorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  rackNo?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  availableOnly?: boolean;
}

// ── copies ────────────────────────────────────────────────────────────

export class GenerateCopiesDto {
  /**
   * How many copies to create. Capped at 200 in one call — a school
   * receiving a 500-book donation does it in batches, and an unbounded
   * loop claiming sequence numbers inside one transaction is how a
   * request times out holding a row lock (the M20 transaction-budget
   * lesson).
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  count!: number;

  @IsOptional()
  @IsEnum(BookCondition)
  condition?: BookCondition;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  purchasePrice?: number;
}

export class UpdateCopyDto {
  @IsOptional()
  @IsEnum(BookCondition)
  condition?: BookCondition;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  conditionNote?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  purchasePrice?: number;
}

/** Writing a copy off. LOST/DAMAGED/WITHDRAWN are the legal targets. */
export class MarkCopyDto {
  @IsEnum(BookCopyStatus)
  status!: BookCopyStatus;

  /** Mandatory — the M16/M20 "every write-off carries a reason" rule. */
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;

  /**
   * Charge the borrower for a copy lost while on loan. Left out, the
   * charge is computed from the title's price and the multiplier
   * setting; supplied, it is the librarian's figure and needs the same
   * permission (roadmap §8's "partial fine with reason").
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  fineAmount?: number;
}

export class CopyQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  bookId?: string;

  @IsOptional()
  @IsEnum(BookCopyStatus)
  status?: BookCopyStatus;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  rackNo?: string;
}

export class LabelSheetDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  copyIds!: string[];
}

// ── members ───────────────────────────────────────────────────────────

export class EnrolMemberDto {
  @IsEnum(LibraryMemberType)
  personType!: LibraryMemberType;

  @IsUUID()
  personId!: string;

  /** Overrides the per-type default from settings — see the model doc. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxBooks?: number;
}

export class UpdateMemberDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxBooks?: number;

  @IsOptional()
  @IsEnum(LibraryMemberStatus)
  status?: LibraryMemberStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  statusReason?: string;
}

export class MemberQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(LibraryMemberType)
  personType?: LibraryMemberType;

  @IsOptional()
  @IsEnum(LibraryMemberStatus)
  status?: LibraryMemberStatus;
}

// ── circulation ───────────────────────────────────────────────────────

/**
 * The desk's issue call. It takes what the two scanners produce — an
 * accession number and a card number — rather than uuids, because that
 * is what physically happens at a circulation desk. Ids are accepted too
 * for the OPAC/admin paths that already resolved them.
 */
export class IssueBookDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  accessionNo?: string;

  @IsOptional()
  @IsUUID()
  copyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  cardNo?: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;

  /** Auto-provisioning path: enrol this person and issue in one step. */
  @IsOptional()
  @IsEnum(LibraryMemberType)
  personType?: LibraryMemberType;

  @IsOptional()
  @IsUUID()
  personId?: string;

  /** Overrides the per-type loan length for this one loan. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  loanDays?: number;

  /**
   * Push past an overridable refusal. Needs `library.issue.override`;
   * a structural refusal ignores it (the M13/M14 two-tier split).
   */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  override?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

export class ReturnBookDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  accessionNo?: string;

  @IsOptional()
  @IsUUID()
  copyId?: string;

  @IsOptional()
  @IsUUID()
  issueId?: string;

  /** Roadmap §8 — the damaged-on-return dispute starts here. */
  @IsOptional()
  @IsEnum(BookCondition)
  condition?: BookCondition;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  conditionNote?: string;

  /**
   * The librarian's figure, replacing the computed one. Roadmap §8's
   * "partial fine with reason": a book damaged by a burst pipe in a
   * school bag is not the same as one used as a coaster, and the engine
   * cannot tell the difference.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  fineOverride?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  fineReason?: string;

  /** Take the fine at the same moment the book comes back. */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  collectFine?: boolean;
}

export class RenewIssueDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  loanDays?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  override?: boolean;
}

export class CollectFineDto {
  /** Part-payment is allowed; the balance stays on the loan. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}

export class WaiveFineDto {
  /** Part-waivers are the §8 dispute settlement; omit for the whole. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  amount?: number;

  /** Mandatory — the CHECK refuses a nameless write-off anyway. */
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class IssueQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsOptional()
  @IsUUID()
  bookId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  openOnly?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  overdueOnly?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unpaidFineOnly?: boolean;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

// ── reservations ──────────────────────────────────────────────────────

export class CreateReservationDto {
  @IsUUID()
  bookId!: string;

  /** Omitted on the portal path — the caller's own card is used. */
  @IsOptional()
  @IsUUID()
  memberId?: string;
}

export class ReservationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  bookId?: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsOptional()
  @IsEnum(BookReservationStatus)
  status?: BookReservationStatus;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  liveOnly?: boolean;
}

// ── stock verification ────────────────────────────────────────────────

export class StartStockCheckDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  /** One rack at a time is how a stock-take is actually done. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  rackNo?: string;
}

export class ScanStockDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  accessionNos!: string[];
}

export class CloseStockCheckDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

// ── reports ───────────────────────────────────────────────────────────

export class LibraryReportQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

// ── OPAC (portal) ─────────────────────────────────────────────────────

export class OpacQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  availableOnly?: boolean;
}
