import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
  HostelAllocationStatus,
  HostelBedStatus,
  HostelRoomStatus,
  HostelRoomType,
  HostelStatus,
  HostelType,
  MealOffStatus,
} from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Money: two decimals, the NUMERIC(12,2) contract. */
const MONEY = {
  maxDecimalPlaces: 2,
  allowNaN: false,
  allowInfinity: false,
} as const;

/** BD mobile, the PROJECT_CONTEXT §12 shape. */
const BD_PHONE = /^01[3-9]\d{8}$/;

// ── hostels ───────────────────────────────────────────────────────────

export class UpsertHostelDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  nameBn?: string;

  @IsEnum(HostelType)
  type!: HostelType;

  @IsOptional()
  @IsUUID()
  wardenStaffId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @Matches(BD_PHONE, { message: 'phone must be a BD mobile number' })
  phone?: string;

  /** Declared capacity, printed beside the real bed count — never used
   *  in an allocation decision (see the model doc). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5000)
  capacity?: number;

  @IsOptional()
  @IsEnum(HostelStatus)
  status?: HostelStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class HostelQueryDto {
  @IsOptional()
  @IsEnum(HostelStatus)
  status?: HostelStatus;

  @IsOptional()
  @IsEnum(HostelType)
  type?: HostelType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

// ── rooms ─────────────────────────────────────────────────────────────

export class UpsertRoomDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  roomNo!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-5)
  @Max(200)
  floor?: number;

  @IsOptional()
  @IsEnum(HostelRoomType)
  type?: HostelRoomType;

  /** Roadmap §7: the beds generated have to match this. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  bedCount!: number;

  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  monthlyFee!: number;

  @IsOptional()
  @IsEnum(HostelRoomStatus)
  status?: HostelRoomStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /**
   * Generate the beds along with the room. On by default because a room
   * with no beds is a room nobody can be put in, and roadmap §4 asks for
   * bulk bed generation as the normal path rather than a second trip.
   */
  @IsOptional()
  @IsBoolean()
  generateBeds?: boolean;
}

export class RoomQueryDto {
  @IsOptional()
  @IsEnum(HostelRoomStatus)
  status?: HostelRoomStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  floor?: number;
}

/** Roadmap §4's bulk bed generation, as its own call for an existing room. */
export class GenerateBedsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  count!: number;

  /** Defaults to `hostel.bed_no_prefix`. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  prefix?: string;
}

export class UpsertBedDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  bedNo!: string;

  @IsOptional()
  @IsEnum(HostelBedStatus)
  status?: HostelBedStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ── allocations ───────────────────────────────────────────────────────

export class CreateAllocationDto {
  @IsUUID()
  enrollmentId!: string;

  @IsUUID()
  bedId!: string;

  @IsOptional()
  @IsISO8601()
  startDate?: string;

  /** Defaults to `hostel.default_security_deposit`. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  securityDeposit?: number;

  /** Optional: put the boarder straight onto a mess plan. */
  @IsOptional()
  @IsUUID()
  messPlanId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;

  /**
   * Ask for `hostel.allocate.override`. Requesting it without holding it
   * is a 403, not a silent downgrade — the M25 rule: a caller who asked
   * to override and was quietly refused would think it worked.
   */
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

export class UpdateAllocationDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

/** Roadmap §4's "transfer bed/room". */
export class TransferAllocationDto {
  @IsUUID()
  bedId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

export class SuspendAllocationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsISO8601()
  effectiveDate?: string;
}

export class ResumeAllocationDto {
  @IsOptional()
  @IsISO8601()
  effectiveDate?: string;
}

export class DeductionDto {
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  amount!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class VacateAllocationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  /**
   * Ask for `hostel.vacate.override` — releasing the bed while fees are
   * outstanding and `hostel.vacate_block_dues` is on.
   */
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

/**
 * Recording the deposit going back. A separate call from vacating on
 * purpose: `hostel.vacate` belongs to the office and
 * `hostel.deposit.refund` to the accountant, and a single endpoint would
 * force one of them to hold the other's permission.
 */
export class RefundDepositDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DeductionDto)
  deductions?: DeductionDto[];

  @IsOptional()
  @IsISO8601()
  refundedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AllocationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  hostelId?: string;

  @IsOptional()
  @IsUUID()
  roomId?: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsEnum(HostelAllocationStatus)
  status?: HostelAllocationStatus;
}

// ── mess ──────────────────────────────────────────────────────────────

export class UpsertMessPlanDto {
  @IsUUID()
  hostelId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  monthlyCharge!: number;

  @IsOptional()
  @IsEnum(HostelStatus)
  status?: HostelStatus;
}

export class MessPlanQueryDto {
  @IsOptional()
  @IsUUID()
  hostelId?: string;

  @IsOptional()
  @IsEnum(HostelStatus)
  status?: HostelStatus;
}

export class CreateMessEnrollmentDto {
  @IsUUID()
  allocationId!: string;

  @IsUUID()
  planId!: string;

  @IsOptional()
  @IsISO8601()
  startDate?: string;
}

export class EndMessEnrollmentDto {
  @IsOptional()
  @IsISO8601()
  endDate?: string;
}

export class MessEnrollmentQueryDto {
  @IsOptional()
  @IsUUID()
  hostelId?: string;

  @IsOptional()
  @IsUUID()
  allocationId?: string;

  @IsOptional()
  @IsUUID()
  planId?: string;
}

// ── meal-offs ─────────────────────────────────────────────────────────

export class CreateMealOffDto {
  @IsUUID()
  allocationId!: string;

  @IsISO8601()
  fromDate!: string;

  @IsISO8601()
  toDate!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class UpdateMealOffDto {
  @IsOptional()
  @IsISO8601()
  fromDate?: string;

  @IsOptional()
  @IsISO8601()
  toDate?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}

export class DecideMealOffDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class MealOffQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  hostelId?: string;

  @IsOptional()
  @IsUUID()
  allocationId?: string;

  @IsOptional()
  @IsEnum(MealOffStatus)
  status?: MealOffStatus;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

// ── reports ───────────────────────────────────────────────────────────

export class OccupancyQueryDto {
  @IsOptional()
  @IsUUID()
  hostelId?: string;
}

export class ResidentsQueryDto {
  @IsOptional()
  @IsUUID()
  hostelId?: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;
}

export class MealOffReportQueryDto {
  @IsOptional()
  @IsUUID()
  hostelId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

/** Roadmap §5's "bulk assign by section" equivalent for a hostel. */
export class BulkAllocateDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  enrollmentIds!: string[];

  @IsUUID()
  hostelId!: string;

  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  securityDeposit?: number;

  @IsOptional()
  @IsBoolean()
  override?: boolean;
}
