import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DATE_REGEX, TIME_REGEX } from './exam.dto';

const DATE_MESSAGE = { message: 'date must be YYYY-MM-DD' };
const TIME_MESSAGE = { message: 'time must be HH:mm (24-hour)' };

/** Shared mark-distribution fields; the engine validates their relations. */
class MarkDistributionFields {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  fullMarks!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  passMarks!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  cqMarks?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  mcqMarks?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  practicalMarks?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  caMarks?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  cqPassMarks?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  mcqPassMarks?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  practicalPassMarks?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  caPassMarks?: number | null;
}

/** One row of the wizard's distribution grid. */
export class ExamSubjectInputDto extends MarkDistributionFields {
  @IsUUID()
  classId!: string;

  @IsUUID()
  subjectId!: string;

  /** Sitting schedule — all three together, or none (DB CHECK). */
  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  examDate?: string | null;

  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, TIME_MESSAGE)
  startTime?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(360)
  durationMin?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  room?: string | null;
}

/**
 * Full replacement of an exam's papers. Sent by the wizard's distribution
 * step; papers absent from the payload are removed (blocked once marks
 * exist — Module 15 arms that guard).
 */
export class ReplaceExamSubjectsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ExamSubjectInputDto)
  subjects!: ExamSubjectInputDto[];

  /** Waive the same-day policy warning (needs `exam.schedule.override`). */
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

/** Single-paper edit from the routine grid or the subjects table. */
export class UpdateExamSubjectDto extends MarkDistributionFields {
  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  examDate?: string | null;

  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, TIME_MESSAGE)
  startTime?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(360)
  durationMin?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  room?: string | null;

  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

/**
 * Postponement tool (roadmap M14 §8): move every sitting of one date to
 * another — the strike/weather case, which in Bangladesh is frequent
 * enough to deserve a button rather than 30 manual edits.
 */
export class ShiftExamDayDto {
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  fromDate!: string;

  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  toDate!: string;

  /** Extend the exam's end_date when the new date falls past it. */
  @IsOptional()
  @IsBoolean()
  extendExamWindow?: boolean;

  @IsOptional()
  @IsBoolean()
  override?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Applies the class-subject diff found by `GET /exams/:id/subjects/sync`. */
export class SyncExamSubjectsDto {
  /** Add papers for subjects newly mapped to an attached class. */
  @IsOptional()
  @IsBoolean()
  addMissing?: boolean;

  /** Remove papers whose subject left the class curriculum. */
  @IsOptional()
  @IsBoolean()
  removeStale?: boolean;
}
