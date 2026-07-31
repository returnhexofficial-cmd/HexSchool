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
} from 'class-validator';
import {
  DriverStatus,
  RouteStatus,
  TransportAssignmentStatus,
  VehicleExpenseType,
  VehicleStatus,
  VehicleType,
} from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Money: two decimals, the NUMERIC(12,2) contract. */
const MONEY = {
  maxDecimalPlaces: 2,
  allowNaN: false,
  allowInfinity: false,
} as const;

/** `HH:MM`, 24-hour — roadmap §7. */
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
/** BD mobile, the PROJECT_CONTEXT §12 shape. */
const BD_PHONE = /^01[3-9]\d{8}$/;

// ── vehicles ──────────────────────────────────────────────────────────

export class UpsertVehicleDto {
  /**
   * Free text by design (roadmap §7): BD plates are written half a dozen
   * ways and a regex would refuse real buses. Uniqueness is what the
   * module actually needs, and that is a database index.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  regNo!: string;

  @IsOptional()
  @IsEnum(VehicleType)
  type?: VehicleType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  capacity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  makeModel?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2200)
  modelYear?: number;

  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;

  @IsOptional()
  @IsISO8601()
  fitnessExpiry?: string;

  @IsOptional()
  @IsISO8601()
  taxTokenExpiry?: string;

  @IsOptional()
  @IsISO8601()
  insuranceExpiry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class VehicleQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;

  @IsOptional()
  @IsEnum(VehicleType)
  type?: VehicleType;
}

// ── drivers ───────────────────────────────────────────────────────────

export class UpsertDriverDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @Matches(BD_PHONE, { message: 'phone must be a Bangladeshi mobile number' })
  phone!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(60)
  licenseNo!: string;

  @IsOptional()
  @IsISO8601()
  licenseExpiry?: string;

  /** M07 staff record, when the school employs the driver. */
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsEnum(DriverStatus)
  status?: DriverStatus;
}

export class DriverQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(DriverStatus)
  status?: DriverStatus;
}

// ── routes & stops ────────────────────────────────────────────────────

export class UpsertRouteDto {
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
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUUID()
  vehicleId?: string | null;

  @IsOptional()
  @IsUUID()
  driverId?: string | null;

  /** Roadmap §8's temporary replacement. */
  @IsOptional()
  @IsUUID()
  substituteDriverId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  helperName?: string;

  @IsOptional()
  @Matches(BD_PHONE, {
    message: 'helperPhone must be a Bangladeshi mobile number',
  })
  helperPhone?: string;

  @IsOptional()
  @IsEnum(RouteStatus)
  status?: RouteStatus;
}

export class RouteQueryDto {
  @IsOptional()
  @IsEnum(RouteStatus)
  status?: RouteStatus;

  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class UpsertStopDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  landmark?: string;

  @IsOptional()
  @Matches(CLOCK, { message: 'pickupTime must be HH:MM' })
  pickupTime?: string;

  @IsOptional()
  @Matches(CLOCK, { message: 'dropTime must be HH:MM' })
  dropTime?: string;

  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  monthlyFee!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class ReorderStopsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  stopIds!: string[];
}

// ── assignments ───────────────────────────────────────────────────────

export class CreateAssignmentDto {
  @IsUUID()
  enrollmentId!: string;

  @IsUUID()
  routeId!: string;

  @IsUUID()
  stopId!: string;

  /** Defaults to today — the day the child starts taking the bus. */
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;

  /**
   * Push past an over-capacity refusal. Only meaningful when
   * `transport.capacity_hard_block` is on, and only for a caller holding
   * `transport.assign.override` — the M08/M12/M13 runtime-override
   * convention.
   */
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

export class BulkAssignDto {
  @IsUUID()
  routeId!: string;

  @IsUUID()
  stopId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @IsUUID(undefined, { each: true })
  enrollmentIds!: string[];

  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

/** Roadmap §8's route split / merge tool. */
export class ReassignRouteDto {
  @IsUUID()
  fromRouteId!: string;

  @IsUUID()
  toRouteId!: string;

  /** Move only these riders; omitted means the whole route. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  assignmentIds?: string[];

  /**
   * Stop on the destination route. Omitted means "match by stop name",
   * which is what a route SPLIT actually needs — the stops move with the
   * riders and keep their fee.
   */
  @IsOptional()
  @IsUUID()
  toStopId?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

export class UpdateAssignmentDto {
  @IsOptional()
  @IsUUID()
  routeId?: string;

  @IsOptional()
  @IsUUID()
  stopId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;

  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

export class SuspendAssignmentDto {
  /** Defaults to today; billing stops here. */
  @IsOptional()
  @IsISO8601()
  effectiveDate?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ResumeAssignmentDto {
  @IsOptional()
  @IsISO8601()
  effectiveDate?: string;
}

export class EndAssignmentDto {
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class AssignmentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  routeId?: string;

  @IsOptional()
  @IsUUID()
  stopId?: string;

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
  @IsEnum(TransportAssignmentStatus)
  status?: TransportAssignmentStatus;
}

// ── expenses ──────────────────────────────────────────────────────────

export class UpsertExpenseDto {
  @IsUUID()
  vehicleId!: string;

  @IsEnum(VehicleExpenseType)
  type!: VehicleExpenseType;

  @IsISO8601()
  date!: string;

  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  odometer?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  receiptUrl?: string;
}

export class ExpenseQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsEnum(VehicleExpenseType)
  type?: VehicleExpenseType;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

// ── reports ───────────────────────────────────────────────────────────

export class ExpenseReportQueryDto {
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class CollectionReportQueryDto {
  /** `YYYY-MM`; defaults to the current month. */
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month?: string;
}
