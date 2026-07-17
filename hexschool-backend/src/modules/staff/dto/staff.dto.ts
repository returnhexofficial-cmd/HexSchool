import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  EmploymentType,
  Gender,
  StaffDesignation,
  StaffDocumentType,
  StaffStatus,
} from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Shape-only YYYY-MM-DD check; services parse through parseDate (M05). */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const BD_PHONE_PATTERN = /^01[3-9]\d{8}$/;
/** BD NID formats: 10, 13 or 17 digits (roadmap M07 §7). */
export const NID_PATTERN = /^(\d{10}|\d{13}|\d{17})$/;

export const BLOOD_GROUPS = [
  'A+',
  'A-',
  'B+',
  'B-',
  'AB+',
  'AB-',
  'O+',
  'O-',
] as const;

export class AddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  present?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  permanent?: string;
}

export class CreateStaffDto {
  // ── linked user account (email OR phone required — service-checked) ──
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @Matches(BD_PHONE_PATTERN, { message: 'phone must be a BD mobile number' })
  phone?: string;

  // ── profile ─────────────────────────────────────────────────────────
  @IsString()
  @Length(1, 100)
  firstName!: string;

  @IsString()
  @Length(1, 100)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameBn?: string;

  @IsEnum(StaffDesignation)
  designation!: StaffDesignation;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsEnum(Gender)
  gender!: Gender;

  @Matches(DATE_PATTERN, { message: 'dob must be YYYY-MM-DD' })
  dob!: string;

  @IsOptional()
  @IsIn(BLOOD_GROUPS)
  bloodGroup?: string;

  @IsOptional()
  @Matches(NID_PATTERN, { message: 'NID must be 10, 13 or 17 digits' })
  nidNumber?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @Matches(DATE_PATTERN, { message: 'joiningDate must be YYYY-MM-DD' })
  joiningDate!: string;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;
}

/** Status changes go through PUT /staff/:id/status, never plain update. */
export class UpdateStaffDto extends PartialType(CreateStaffDto) {}

export class UpdateStaffStatusDto {
  @IsEnum(StaffStatus)
  status!: StaffStatus;

  /** Recorded in the audit trail (feeds HR in M21). */
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class UploadStaffDocumentDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsEnum(StaffDocumentType)
  type?: StaffDocumentType;
}

export class StaffQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(StaffDesignation)
  designation?: StaffDesignation;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsEnum(StaffStatus)
  status?: StaffStatus;
}

export class CheckNidQueryDto {
  @Matches(NID_PATTERN, { message: 'NID must be 10, 13 or 17 digits' })
  nid!: string;

  /** Ignore this staff row (edit forms checking their own NID). */
  @IsOptional()
  @IsUUID()
  excludeId?: string;
}
