import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
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
  InvoiceStatus,
  PaymentMethod,
} from '../../../common/constants';
import { DATE_REGEX } from './fee-setup.dto';

const MONEY = {
  maxDecimalPlaces: 2,
  allowNaN: false,
  allowInfinity: false,
} as const;
const DATE_MESSAGE = { message: 'date must be YYYY-MM-DD' };
const MONTH_REGEX = /^\d{4}-\d{2}$/;

// ── generation ────────────────────────────────────────────────────────

/** An extra line the ad-hoc generator bills on top of the structures. */
export class AdHocLineDto {
  @IsUUID()
  feeHeadId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0)
  @Max(99999999)
  amount!: number;
}

/**
 * Generate invoices for a scope.
 *
 * `billingMonth` present ⇒ the monthly batch: every RECURRING_MONTHLY
 * head, prorated for mid-month joiners, idempotent per (enrollment,
 * month). Absent ⇒ an ad-hoc run billing the explicit `lines` (the
 * roadmap's "exam fee for class 8").
 */
export class GenerateInvoicesDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  /** `YYYY-MM` — the month being billed. */
  @IsOptional()
  @IsString()
  @Matches(MONTH_REGEX, { message: 'billingMonth must be YYYY-MM' })
  billingMonth?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  /** Bill exactly these candidates (the single-student case). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  enrollmentIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AdHocLineDto)
  lines?: AdHocLineDto[];

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;

  /** Report what WOULD be billed without writing — the wizard's preview. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class InvoiceQueryDto {
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
  enrollmentId?: string;

  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsString()
  @Matches(MONTH_REGEX, { message: 'billingMonth must be YYYY-MM' })
  billingMonth?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CancelInvoiceDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

// ── collection ────────────────────────────────────────────────────────

/** Offline methods the counter may record directly. */
export const OFFLINE_METHODS: PaymentMethod[] = [
  PaymentMethod.CASH,
  PaymentMethod.BANK,
  PaymentMethod.CHEQUE,
  PaymentMethod.ADJUSTMENT,
];

export class RecordPaymentDto {
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0.01)
  @Max(99999999)
  amount!: number;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  /** Cheque number, bank slip reference, … */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  paidOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}

/**
 * The collection desk's basket: one sum against several invoices,
 * possibly across siblings. The engine allocates oldest-due-first.
 */
export class CollectPaymentDto extends RecordPaymentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  invoiceIds!: string[];
}

export class RefundPaymentDto {
  @Type(() => Number)
  @IsNumber(MONEY)
  @Min(0.01)
  @Max(99999999)
  amount!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

// ── online payment ────────────────────────────────────────────────────

/** The gateways a school may be configured for (roadmap M16 §4). */
export const ONLINE_GATEWAYS = ['SSLCOMMERZ', 'BKASH', 'NAGAD'] as const;
export type OnlineGateway = (typeof ONLINE_GATEWAYS)[number];

export class InitOnlinePaymentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  invoiceIds!: string[];

  @IsEnum(ONLINE_GATEWAYS)
  gateway!: OnlineGateway;

  /** Where the gateway returns the payer (the portal's result page). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  returnUrl?: string;
}

/**
 * A gateway callback. Deliberately loose — every gateway posts a
 * different body, and the adapter is what understands it. The only
 * fields this module insists on are the two it needs to find the
 * payment; everything else is handed to the adapter for verification.
 */
export class GatewayCallbackDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tran_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  val_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  paymentID?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  payment_ref_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  status?: string;
}

export class LedgerQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}

export class FeeReportQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  to?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;
}
