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
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  AttendancePersonType,
  BonusBasis,
  BonusType,
  LeaveApplicableTo,
  LeaveStatus,
  PaymentMode,
  PayrollRunStatus,
  PfEntryType,
  SalaryCalc,
  SalaryComponentType,
} from '../../../common/constants';

/** Money: at most 2 decimals — the NUMERIC(12,2) contract. */
const MONEY = {
  maxDecimalPlaces: 2,
  allowNaN: false,
  allowInfinity: false,
} as const;

/** Days: at most one decimal, because a half day is the finest unit. */
const DAYS = {
  maxDecimalPlaces: 1,
  allowNaN: false,
  allowInfinity: false,
} as const;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = { message: 'date must be YYYY-MM-DD' };
const MONTH_REGEX = /^\d{4}-\d{2}$/;

// ── leave types ───────────────────────────────────────────────────────

export class CreateLeaveTypeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(30)
  @Matches(/^[A-Z0-9_]+$/, {
    message: 'code must be UPPER_SNAKE_CASE (it is a stable handle)',
  })
  code!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(DAYS)
  @Min(0)
  @Max(365)
  annualQuota?: number;

  @IsOptional()
  @IsBoolean()
  carryForward?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(DAYS)
  @Min(0)
  @Max(365)
  maxCarry?: number;

  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @IsOptional()
  @IsEnum(LeaveApplicableTo)
  applicableTo?: LeaveApplicableTo;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  displayOrder?: number;
}

export class UpdateLeaveTypeDto extends CreateLeaveTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  declare name: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  @Matches(/^[A-Z0-9_]+$/)
  declare code: string;
}

// ── leave applications ────────────────────────────────────────────────

export class CreateLeaveDto {
  @IsEnum(AttendancePersonType)
  personType!: AttendancePersonType;

  @IsUUID()
  personId!: string;

  @IsUUID()
  leaveTypeId!: string;

  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  fromDate!: string;

  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  toDate!: string;

  @IsOptional()
  @IsBoolean()
  halfDay?: boolean;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  attachmentUrl?: string;
}

export class UpdateLeaveDto {
  @IsOptional()
  @IsUUID()
  leaveTypeId?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  fromDate?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  toDate?: string;

  @IsOptional()
  @IsBoolean()
  halfDay?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  attachmentUrl?: string;
}

export class LeaveDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /**
   * Approve past the remaining balance. Needs `leave.approve.override` —
   * a runtime permission check in the service, because the same route
   * serves both cases (the M08/M12 override convention).
   */
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

export class LeaveQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(AttendancePersonType)
  personType?: AttendancePersonType;

  @IsOptional()
  @IsUUID()
  personId?: string;

  @IsOptional()
  @IsUUID()
  leaveTypeId?: string;

  @IsOptional()
  @IsEnum(LeaveStatus)
  status?: LeaveStatus;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  to?: string;
}

export class AllocateBalancesDto {
  @IsUUID()
  sessionId!: string;

  /** Prorate the quota for somebody who joined mid-session. */
  @IsOptional()
  @IsBoolean()
  prorate?: boolean;

  /** Carry unused balance forward from the previous session. */
  @IsOptional()
  @IsBoolean()
  carryForward?: boolean;

  @IsOptional()
  @IsEnum(AttendancePersonType)
  personType?: AttendancePersonType;
}

export class AdjustBalanceDto {
  @IsUUID()
  sessionId!: string;

  @IsEnum(AttendancePersonType)
  personType!: AttendancePersonType;

  @IsUUID()
  personId!: string;

  @IsUUID()
  leaveTypeId!: string;

  @Type(() => Number)
  @IsNumber(DAYS)
  @Min(0)
  @Max(365)
  allocated!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(DAYS)
  @Min(0)
  @Max(365)
  carried?: number;
}

// ── salary structures ─────────────────────────────────────────────────

export class SalaryComponentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsEnum(SalaryComponentType)
  type!: SalaryComponentType;

  @IsOptional()
  @IsEnum(SalaryCalc)
  calc?: SalaryCalc;

  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  value!: number;

  @IsOptional()
  @IsBoolean()
  isTaxable?: boolean;

  @IsOptional()
  @IsBoolean()
  isPfBase?: boolean;
}

export class CreateStructureDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  grade?: string;

  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  basic!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => SalaryComponentDto)
  components!: SalaryComponentDto[];
}

export class UpdateStructureDto extends CreateStructureDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  declare name: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  declare basic: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => SalaryComponentDto)
  declare components: SalaryComponentDto[];
}

export class PreviewStructureDto {
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  basic!: number;

  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => SalaryComponentDto)
  components!: SalaryComponentDto[];
}

export class BankAccountDto {
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
  @MaxLength(40)
  accountNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  accountName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  routingNo?: string;
}

export class AssignSalaryDto {
  @IsEnum(AttendancePersonType)
  personType!: AttendancePersonType;

  @IsUUID()
  structureId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  basicOverride?: number;

  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  effectiveFrom!: string;

  @IsOptional()
  @IsEnum(PaymentMode)
  paymentMode?: PaymentMode;

  @IsOptional()
  @ValidateNested()
  @Type(() => BankAccountDto)
  bankAccount?: BankAccountDto;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

// ── payroll ───────────────────────────────────────────────────────────

export class CreatePayrollRunDto {
  /** YYYY-MM — the month, not a date; the service pins it to the 1st. */
  @IsString()
  @Matches(MONTH_REGEX, { message: 'month must be YYYY-MM' })
  month!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class GeneratePayrollDto {
  @IsOptional()
  @IsEnum(AttendancePersonType)
  personType?: AttendancePersonType;

  /**
   * Generate despite unmarked attendance days (roadmap §8). Needs
   * `payroll.generate.force`; without it the warning is returned and
   * nothing is written.
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class DisbursePayrollDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  paidOn?: string;

  /** Disburse only these payslips; omit for every payable one. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  payslipIds?: string[];
}

export class CancelPayrollDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class AdHocLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label!: string;

  @IsEnum(SalaryComponentType)
  type!: SalaryComponentType;

  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  amount!: number;
}

export class EditPayslipDto {
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  reason!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AdHocLineDto)
  adHoc?: AdHocLineDto[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  bonus?: number;

  @IsOptional()
  @IsEnum(PaymentMode)
  paymentMode?: PaymentMode;
}

export class HoldPayslipDto {
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  reason!: string;
}

export class PayrollQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(PayrollRunStatus)
  status?: PayrollRunStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2200)
  year?: number;
}

// ── bonus ─────────────────────────────────────────────────────────────

export class CreateBonusDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsEnum(BonusType)
  type?: BonusType;

  @IsOptional()
  @IsEnum(BonusBasis)
  basis?: BonusBasis;

  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  value!: number;

  @IsOptional()
  @IsString()
  @Matches(MONTH_REGEX, { message: 'monthPaidWith must be YYYY-MM' })
  monthPaidWith?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(600)
  minServiceMonths?: number;

  @IsOptional()
  @IsBoolean()
  prorate?: boolean;

  @IsOptional()
  @IsEnum(LeaveApplicableTo)
  applicableTo?: LeaveApplicableTo;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBonusDto extends CreateBonusDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  declare name: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  declare value: number;
}

// ── provident fund ────────────────────────────────────────────────────

export class PfEntryDto {
  @IsEnum(AttendancePersonType)
  personType!: AttendancePersonType;

  @IsUUID()
  personId!: string;

  @IsString()
  @Matches(MONTH_REGEX, { message: 'month must be YYYY-MM' })
  month!: string;

  @IsEnum(PfEntryType)
  type!: PfEntryType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  employeeAmt?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  employerAmt?: number;

  @IsString()
  @MinLength(3)
  @MaxLength(300)
  note!: string;
}

// ── shared query shapes ───────────────────────────────────────────────

export class EmployeeQueryDto {
  @IsOptional()
  @IsEnum(AttendancePersonType)
  personType?: AttendancePersonType;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Include RESIGNED/TERMINATED/RETIRED people (history views). */
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includeInactive?: boolean;
}

export class PersonParamsDto {
  @IsEnum(AttendancePersonType)
  personType!: AttendancePersonType;

  @IsUUID()
  personId!: string;
}

export class PayrollReportQueryDto {
  @IsOptional()
  @IsUUID()
  runId?: string;

  @IsOptional()
  @IsString()
  @Matches(MONTH_REGEX, { message: 'from must be YYYY-MM' })
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(MONTH_REGEX, { message: 'to must be YYYY-MM' })
  to?: string;

  @IsOptional()
  @IsEnum(AttendancePersonType)
  personType?: AttendancePersonType;

  @IsOptional()
  @IsUUID()
  personId?: string;
}

export class LeaveBalanceQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}
