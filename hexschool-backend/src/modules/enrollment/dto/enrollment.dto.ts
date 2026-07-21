import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EnrollmentStatus, EnrollmentType } from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Roll range (roadmap M11 §7): 1–9999. */
export const ROLL_MIN = 1;
export const ROLL_MAX = 9999;

/** Bulk/roll-assign ordering strategies (roadmap M11 §4). */
export enum RollStrategy {
  /** Append after the section's current highest roll, in input order. */
  NEXT = 'NEXT',
  /** Sort candidates by name, then assign the next available rolls. */
  ALPHABETICAL = 'ALPHABETICAL',
}

/** Full re-numbering of an existing section (roll-assign endpoint). */
export enum RenumberStrategy {
  /** Keep the current roll order, compact to 1..N. */
  SEQUENTIAL = 'SEQUENTIAL',
  /** Order by student name, then 1..N. */
  ALPHABETICAL = 'ALPHABETICAL',
}

export class CreateEnrollmentDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  sessionId!: string;

  /** class_id is derived from the section — the section fixes the class. */
  @IsUUID()
  sectionId!: string;

  /** Defaults to the section's group when omitted. */
  @IsOptional()
  @IsUUID()
  groupId?: string;

  /** Defaults to the section's shift when omitted. */
  @IsOptional()
  @IsUUID()
  shiftId?: string;

  /** Auto-assigned (next available) when omitted. */
  @IsOptional()
  @IsInt()
  @Min(ROLL_MIN)
  @Max(ROLL_MAX)
  rollNo?: number;

  /** Defaults to today (Asia/Dhaka) when omitted. YYYY-MM-DD. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'enrollmentDate must be YYYY-MM-DD',
  })
  enrollmentDate?: string;

  @IsOptional()
  @IsEnum(EnrollmentType)
  type?: EnrollmentType;

  /** The BD "4th subject" — must be an optional subject of the class/session. */
  @IsOptional()
  @IsUUID()
  optionalSubjectId?: string;

  /** Enroll beyond section capacity (requires enrollment.capacity.override). */
  @IsOptional()
  @IsBoolean()
  overrideCapacity?: boolean;
}

export class BulkEnrollDto {
  @IsUUID()
  sessionId!: string;

  @IsUUID()
  sectionId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  studentIds!: string[];

  @IsOptional()
  @IsEnum(RollStrategy)
  rollStrategy?: RollStrategy;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'enrollmentDate must be YYYY-MM-DD',
  })
  enrollmentDate?: string;

  @IsOptional()
  @IsEnum(EnrollmentType)
  type?: EnrollmentType;

  @IsOptional()
  @IsBoolean()
  overrideCapacity?: boolean;
}

/** classId/sessionId/studentId are immutable — cancel + re-enroll to move. */
export class UpdateEnrollmentDto {
  @IsOptional()
  @IsInt()
  @Min(ROLL_MIN)
  @Max(ROLL_MAX)
  rollNo?: number;

  @IsOptional()
  @IsUUID()
  optionalSubjectId?: string | null;

  @IsOptional()
  @IsUUID()
  groupId?: string | null;

  @IsOptional()
  @IsUUID()
  shiftId?: string | null;
}

export class TransferSectionDto {
  @IsUUID()
  toSectionId!: string;

  /** Keep the current roll if free in the target; otherwise auto-assign. */
  @IsOptional()
  @IsBoolean()
  keepRoll?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  overrideCapacity?: boolean;
}

export class RollAssignDto {
  @IsUUID()
  sectionId!: string;

  @IsUUID()
  sessionId!: string;

  @IsEnum(RenumberStrategy)
  strategy!: RenumberStrategy;

  /** First roll number of the sequence (default 1). */
  @IsOptional()
  @IsInt()
  @Min(ROLL_MIN)
  @Max(ROLL_MAX)
  startFrom?: number;
}

export class CancelEnrollmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class EnrollmentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsEnum(EnrollmentStatus)
  status?: EnrollmentStatus;
}

/** Students eligible to enroll into a session (no live enrollment yet). */
export class EnrollableQueryDto {
  @IsUUID()
  sessionId!: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
