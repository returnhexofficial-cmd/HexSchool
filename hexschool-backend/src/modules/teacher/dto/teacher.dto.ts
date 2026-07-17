import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
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
  Gender,
  StaffStatus,
  TeacherDesignation,
  StaffDocumentType,
} from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  AddressDto,
  BD_PHONE_PATTERN,
  BLOOD_GROUPS,
  DATE_PATTERN,
  NID_PATTERN,
} from '../../staff/dto/staff.dto';

export class CreateTeacherDto {
  // ── linked user account (email OR phone required — service-checked) ──
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @Matches(BD_PHONE_PATTERN, { message: 'phone must be a BD mobile number' })
  phone?: string;

  // ── profile (personal columns mirror staff — roadmap M08 §3) ────────
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

  @IsEnum(TeacherDesignation)
  designation!: TeacherDesignation;

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

  // ── teacher-specific ────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  @MaxLength(30)
  salaryGrade?: string;

  /** BD MPO index number (government-subsidized posts). */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  mpoIndexNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  specialization?: string;
}

export class UpdateTeacherDto extends PartialType(CreateTeacherDto) {}

export class UpdateTeacherStatusDto {
  @IsEnum(StaffStatus)
  status!: StaffStatus;

  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class TeacherQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TeacherDesignation)
  designation?: TeacherDesignation;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsEnum(StaffStatus)
  status?: StaffStatus;

  /** Only teachers with this subject in their expertise set. */
  @IsOptional()
  @IsUUID()
  subjectId?: string;
}

export class SetTeacherSubjectsDto {
  @IsUUID(undefined, { each: true })
  subjectIds!: string[];
}

export class UploadTeacherDocumentDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsEnum(StaffDocumentType)
  type?: StaffDocumentType;
}

export class TransferAssignmentsDto {
  @IsUUID()
  fromTeacherId!: string;

  @IsUUID()
  toTeacherId!: string;

  @IsUUID()
  sessionId!: string;

  /** Skip the expertise check (needs teacher.assign.override). */
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}
