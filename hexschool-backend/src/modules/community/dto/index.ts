import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  AlumniRegistrationStatus,
  AlumniStatus,
  AppointmentStatus,
  DonationMethod,
  TicketCategory,
  TicketPriority,
  TicketRaiserType,
  TicketStatus,
  TicketType,
  VisitorHostType,
  VisitorPurpose,
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

// ── tickets ───────────────────────────────────────────────────────────

export class TicketAttachmentDto {
  @IsString()
  @MaxLength(500)
  url!: string;

  @IsString()
  @MaxLength(250)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;
}

class TicketBodyDto {
  @IsEnum(TicketType)
  type: TicketType = TicketType.COMPLAINT;

  @IsEnum(TicketCategory)
  category: TicketCategory = TicketCategory.OTHER;

  /** Roadmap §7: subject ≤ 200. */
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  description!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => TicketAttachmentDto)
  attachments?: TicketAttachmentDto[];
}

/** Raised from the admin desk, on somebody's behalf or by the office. */
export class CreateTicketDto extends TicketBodyDto {
  @IsOptional()
  @IsEnum(TicketRaiserType)
  raisedByType?: TicketRaiserType;

  @IsOptional()
  @IsUUID()
  raisedById?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  contactName?: string;

  @IsOptional()
  @Matches(BD_PHONE, { message: 'Enter a valid Bangladeshi mobile number' })
  contactPhone?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  /**
   * Roadmap §8. A category can make a ticket sensitive on its own; this
   * lets the office mark one that its category would not — a FEES
   * complaint naming the accountant is exactly as sensitive as a TEACHER
   * one, and only a human reading it knows.
   */
  @IsOptional()
  @IsBoolean()
  isSensitive?: boolean;
}

/** The unauthenticated website form (roadmap §4's `POST /public/tickets`). */
export class PublicTicketDto extends TicketBodyDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @Matches(BD_PHONE, { message: 'Enter a valid Bangladeshi mobile number' })
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  /**
   * The whole promise of the anonymous box. When it is set, the service
   * refuses to store a name, a contact or an IP — and `chk_tickets_raiser`
   * refuses the row if it tried.
   */
  @IsOptional()
  @IsBoolean()
  anonymous?: boolean;

  @IsOptional()
  @IsString()
  recaptchaToken?: string;
}

/** The portal "Contact School" form — M18's stub, now a real thread. */
export class PortalTicketDto extends TicketBodyDto {}

export class AssignTicketDto {
  /** `null` unassigns — putting a ticket back in the shared pile. */
  @IsOptional()
  @IsUUID()
  assignedTo?: string | null;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;

  @IsOptional()
  @IsBoolean()
  isSensitive?: boolean;
}

export class TicketStatusDto {
  @IsEnum(TicketStatus)
  status!: TicketStatus;

  /** The CHECK demands one for RESOLVED and CLOSED; so does this. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  resolution?: string;

  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}

export class TicketCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  /** An internal note never reaches the portal thread. */
  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;

  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}

export class TicketRatingDto {
  /** Roadmap §7: 1–5. */
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class TicketQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TicketType)
  type?: TicketType;

  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;

  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class ReportWindowDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

// ── visitors ──────────────────────────────────────────────────────────

export class CheckInVisitorDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @Matches(BD_PHONE, { message: 'Enter a valid Bangladeshi mobile number' })
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  nid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  address?: string;

  @IsEnum(VisitorPurpose)
  purpose: VisitorPurpose = VisitorPurpose.MEETING;

  @IsOptional()
  @IsEnum(VisitorHostType)
  hostType?: VisitorHostType;

  @IsOptional()
  @IsUUID()
  hostId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  whomToMeet?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  cardNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;

  /** Roadmap §8's multi-day pass — OFFICIAL visits only. */
  @IsOptional()
  @IsISO8601()
  validUntil?: string;

  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

export class UpdateVisitorDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  whomToMeet?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  cardNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

export class CheckOutVisitorDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

export class VisitorQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(VisitorPurpose)
  purpose?: VisitorPurpose;

  @IsOptional()
  @IsEnum(VisitorHostType)
  hostType?: VisitorHostType;

  @IsOptional()
  @IsUUID()
  hostId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  inside?: boolean;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class UpsertAppointmentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  visitorName!: string;

  @Matches(BD_PHONE, { message: 'Enter a valid Bangladeshi mobile number' })
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsEnum(VisitorPurpose)
  purpose: VisitorPurpose = VisitorPurpose.MEETING;

  @IsEnum(VisitorHostType)
  hostType!: VisitorHostType;

  @IsUUID()
  hostId!: string;

  @IsISO8601()
  scheduledAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class DecideAppointmentDto {
  @IsEnum(AppointmentStatus)
  status!: AppointmentStatus;

  /** The CHECK demands one for REJECTED — "no" is what a visitor rings about. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note?: string;
}

export class AppointmentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @IsOptional()
  @IsEnum(VisitorHostType)
  hostType?: VisitorHostType;

  @IsOptional()
  @IsUUID()
  hostId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

// ── alumni ────────────────────────────────────────────────────────────

class AlumniBodyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsInt()
  @Min(1900)
  @Max(2200)
  batchYear!: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastClass?: string;

  @IsOptional()
  @Matches(BD_PHONE, { message: 'Enter a valid Bangladeshi mobile number' })
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  profession?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  organization?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  /** Roadmap §6's opt-in. Defaults false at the database, deliberately. */
  @IsOptional()
  @IsBoolean()
  isPublicProfile?: boolean;
}

export class UpsertAlumniDto extends AlumniBodyDto {
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

/** Roadmap §4's `POST /public/alumni/register`. */
export class PublicAlumniRegisterDto extends AlumniBodyDto {
  @IsOptional()
  @IsString()
  recaptchaToken?: string;
}

export class AlumniDecisionDto {
  @IsEnum(AlumniStatus)
  status!: AlumniStatus;

  /** The CHECK demands one for REJECTED. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason?: string;

  /** Confirming the identity match at the moment of approval. */
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

export class AlumniQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(AlumniStatus)
  status?: AlumniStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  batchYear?: number;
}

export class UpsertAlumniEventDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsISO8601()
  eventDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  venue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  /** Omitted is a free event; 0 is an event priced at nothing. */
  @IsOptional()
  @IsNumber(MONEY)
  @Min(0)
  fee?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsISO8601()
  registrationDeadline?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class AlumniEventQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  upcomingOnly?: boolean;
}

export class RegisterForEventDto {
  @IsUUID()
  alumniId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  guests?: number;

  @IsOptional()
  @IsNumber(MONEY)
  @Min(0)
  amountPaid?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateRegistrationDto {
  @IsEnum(AlumniRegistrationStatus)
  status!: AlumniRegistrationStatus;

  @IsOptional()
  @IsNumber(MONEY)
  @Min(0)
  amountPaid?: number;
}

// ── donations ─────────────────────────────────────────────────────────

export class CreateDonationDto {
  @IsOptional()
  @IsUUID()
  alumniId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  donorName!: string;

  @IsOptional()
  @Matches(BD_PHONE, { message: 'Enter a valid Bangladeshi mobile number' })
  donorPhone?: string;

  @IsOptional()
  @IsEmail()
  donorEmail?: string;

  /** Roadmap §7: amount > 0. */
  @IsNumber(MONEY)
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  purpose?: string;

  @IsEnum(DonationMethod)
  method: DonationMethod = DonationMethod.CASH;

  @IsOptional()
  @IsISO8601()
  receivedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;

  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}

/**
 * There is no `UpdateDonationDto` and that is the point: roadmap §6 makes
 * a receipt immutable, so the only correction is this — and it carries a
 * reason, because the register has to be able to say why a number it once
 * reported is no longer there.
 */
export class CancelDonationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class DonationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  alumniId?: string;

  @IsOptional()
  @IsEnum(DonationMethod)
  method?: DonationMethod;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  liveOnly?: boolean;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

// ── public reads ──────────────────────────────────────────────────────

export class PublicDirectoryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  batchYear?: number;
}
