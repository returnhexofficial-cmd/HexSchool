import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ExamStatus } from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** YYYY-MM-DD shape check; `parseDate` validates the calendar date. */
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const DATE_MESSAGE = { message: 'date must be YYYY-MM-DD' };

export class ExamListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsUUID()
  examTypeId?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsEnum(ExamStatus)
  status?: ExamStatus;
}

export class CreateExamDto {
  @IsUUID()
  examTypeId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  /** Defaults to the current session when omitted. */
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  startDate!: string;

  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  endDate!: string;

  /** Defaults to the school's default grading system. */
  @IsOptional()
  @IsUUID()
  gradingSystemId?: string;

  /** Classes sitting this exam — the wizard's second step. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  classIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;
}

export class UpdateExamDto {
  @IsOptional()
  @IsUUID()
  examTypeId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  startDate?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  endDate?: string;

  @IsOptional()
  @IsUUID()
  gradingSystemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;
}

/** Full replacement of the attached class set (roadmap M14 §4 step 2). */
export class SetExamClassesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  classIds!: string[];

  /**
   * Seed papers for newly attached classes from `class_subjects`
   * (full_marks_default + the exam.default_* settings). On by default —
   * an exam with classes and no papers is never what the user wanted.
   */
  @IsOptional()
  @IsBoolean()
  seedSubjects?: boolean;
}

export class ChangeExamStatusDto {
  @IsEnum(ExamStatus)
  status!: ExamStatus;

  /**
   * Open mark entry before the exam's end_date has passed (roadmap M14
   * §4). Requires `exam.status`; the date guard is the only thing it
   * waives.
   */
  @IsOptional()
  @IsBoolean()
  override?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
