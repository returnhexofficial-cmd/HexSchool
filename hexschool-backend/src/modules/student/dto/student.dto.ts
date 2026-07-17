import { OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  Gender,
  GuardianRelation,
  Religion,
  StudentDocumentType,
  StudentStatus,
} from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  AddressDto,
  BD_PHONE_PATTERN,
  BLOOD_GROUPS,
  DATE_PATTERN,
  NID_PATTERN,
} from '../../staff/dto/staff.dto';

/** BD birth certificate numbers: 17 digits (roadmap M09 §7). */
export const BIRTH_CERT_PATTERN = /^\d{17}$/;

/**
 * One guardian entry inside student registration: either link an
 * existing guardian (`guardianId`) or create one inline (name + phone
 * required — the service dedupes inline entries by phone first, so
 * siblings reuse the same guardian row).
 */
export class StudentGuardianEntryDto {
  @IsOptional()
  @IsUUID()
  guardianId?: string;

  // ── inline guardian creation (ignored when guardianId is set) ──────
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameBn?: string;

  @IsOptional()
  @Matches(BD_PHONE_PATTERN, { message: 'phone must be a BD mobile number' })
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @Matches(NID_PATTERN, { message: 'NID must be 10, 13 or 17 digits' })
  nid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  occupation?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyIncome?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  // ── link attributes ────────────────────────────────────────────────
  @IsEnum(GuardianRelation)
  relation!: GuardianRelation;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsBoolean()
  isEmergencyContact?: boolean;
}

export class CreateStudentDto {
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

  @IsEnum(Gender)
  gender!: Gender;

  @Matches(DATE_PATTERN, { message: 'dob must be YYYY-MM-DD' })
  dob!: string;

  @IsOptional()
  @IsIn(BLOOD_GROUPS)
  bloodGroup?: string;

  @IsOptional()
  @IsEnum(Religion)
  religion?: Religion;

  @IsOptional()
  @Matches(BIRTH_CERT_PATTERN, {
    message: 'birthCertificateNo must be 17 digits',
  })
  birthCertificateNo?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  presentAddress?: AddressDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  permanentAddress?: AddressDto;

  @Matches(DATE_PATTERN, { message: 'admissionDate must be YYYY-MM-DD' })
  admissionDate!: string;

  @IsUUID()
  admissionClassId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  previousSchool?: string;

  /** At least one guardian, exactly one marked primary (M09 §6). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => StudentGuardianEntryDto)
  guardians!: StudentGuardianEntryDto[];
}

/** Guardians are managed through the dedicated link endpoints. */
export class UpdateStudentDto extends PartialType(
  OmitType(CreateStudentDto, ['guardians'] as const),
) {}

export class UpdateStudentStatusDto {
  @IsEnum(StudentStatus)
  status!: StudentStatus;

  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class StudentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsEnum(StudentStatus)
  status?: StudentStatus;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsEnum(Religion)
  religion?: Religion;
}

/** Pre-submit duplicate probe for the registration wizard (warn-only). */
export class CheckDuplicatesDto {
  @IsString()
  @Length(1, 100)
  firstName!: string;

  @IsString()
  @Length(1, 100)
  lastName!: string;

  @Matches(DATE_PATTERN, { message: 'dob must be YYYY-MM-DD' })
  dob!: string;

  @IsOptional()
  @IsArray()
  @Matches(BD_PHONE_PATTERN, { each: true })
  guardianPhones?: string[];
}

/** Portal account provisioning (students may not own a phone — any BD
 *  number/email the family uses; guardian accounts default to the
 *  guardian's stored phone). */
export class CreatePortalAccountDto {
  @IsOptional()
  @Matches(BD_PHONE_PATTERN, { message: 'phone must be a BD mobile number' })
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class UploadStudentDocumentDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsEnum(StudentDocumentType)
  type?: StudentDocumentType;
}

export class BatchIdCardsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  studentIds!: string[];
}
