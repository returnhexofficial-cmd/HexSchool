import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  AssignmentStatus,
  AssignmentType,
  LearningMaterialType,
} from '../../../common/constants';

/** Marks: at most 2 decimals — the NUMERIC(6,2) contract. */
const MARKS = {
  maxDecimalPlaces: 2,
  allowNaN: false,
  allowInfinity: false,
} as const;

/**
 * An attachment the client sends back after uploading. The **key** is
 * what is stored: a URL would expire (M04's signed-URL rule) and a
 * client-supplied URL would let a caller point a submission at anything.
 */
export class AttachmentDto {
  @IsString()
  @MaxLength(500)
  key!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  size!: number;

  @IsString()
  @MaxLength(150)
  contentType!: string;
}

// ── assignments ───────────────────────────────────────────────────────

export class CreateAssignmentDto {
  @IsUUID()
  sessionId!: string;

  @IsUUID()
  sectionId!: string;

  @IsUUID()
  subjectId!: string;

  /**
   * Whose assignment this is. Optional: a teacher creating their own
   * work leaves it out and it resolves from their account, which is the
   * only way the ordinary case cannot be spoofed. Supplying it needs
   * `assignment.all` — an office filing on somebody's behalf.
   */
  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @IsOptional()
  @IsEnum(AssignmentType)
  type?: AssignmentType;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  instructions?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];

  @IsOptional()
  @IsISO8601()
  assignedAt?: string;

  @IsISO8601()
  dueAt!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MARKS)
  @Min(0.01)
  fullMarks?: number;

  @IsOptional()
  @IsBoolean()
  allowLate?: boolean;
}

export class UpdateAssignmentDto {
  @IsOptional()
  @IsEnum(AssignmentType)
  type?: AssignmentType;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  instructions?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];

  @IsOptional()
  @IsISO8601()
  assignedAt?: string;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MARKS)
  @Min(0.01)
  fullMarks?: number | null;

  @IsOptional()
  @IsBoolean()
  allowLate?: boolean;
}

export class AssignmentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @IsOptional()
  @IsEnum(AssignmentType)
  type?: AssignmentType;

  @IsOptional()
  @IsEnum(AssignmentStatus)
  status?: AssignmentStatus;

  /** `true` narrows to the caller's own assignments. */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  mine?: boolean;
}

// ── submissions ───────────────────────────────────────────────────────

export class SubmitAssignmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  textAnswer?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];
}

export class EvaluateSubmissionDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber(MARKS)
  @Min(0)
  marks?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  feedback?: string;
}

export class ReturnSubmissionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(4000)
  feedback!: string;
}

export class BulkEvaluationRowDto {
  @IsUUID()
  submissionId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MARKS)
  @Min(0)
  marks?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  feedback?: string;
}

/**
 * The bulk grid (roadmap §4). All-or-nothing: one bad cell rejects the
 * batch and every bad cell is returned at once — the M15 mark-entry rule,
 * because a teacher filling forty cells needs the whole list.
 */
export class BulkEvaluateDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BulkEvaluationRowDto)
  rows!: BulkEvaluationRowDto[];
}

// ── learning materials ────────────────────────────────────────────────

export class CreateMaterialDto {
  @IsUUID()
  sessionId!: string;

  @IsUUID()
  classId!: string;

  /** Omit for a class-wide material. */
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsUUID()
  subjectId!: string;

  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @IsOptional()
  @IsEnum(LearningMaterialType)
  type?: LearningMaterialType;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  files?: AttachmentDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  linkUrl?: string;
}

export class UpdateMaterialDto {
  @IsOptional()
  @IsUUID()
  sectionId?: string | null;

  @IsOptional()
  @IsEnum(LearningMaterialType)
  type?: LearningMaterialType;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  files?: AttachmentDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  linkUrl?: string | null;
}

export class MaterialQueryDto extends PaginationQueryDto {
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
  subjectId?: string;

  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @IsOptional()
  @IsEnum(LearningMaterialType)
  type?: LearningMaterialType;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  mine?: boolean;
}

// ── portal ────────────────────────────────────────────────────────────

export class PortalAssignmentQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsUUID()
  subjectId?: string;

  /** `PENDING` | `SUBMITTED` | `EVALUATED` — the portal's three tabs. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  tab?: string;
}
