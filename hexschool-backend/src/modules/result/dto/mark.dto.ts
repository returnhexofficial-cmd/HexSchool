import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MarkStatus } from '../../../common/constants';

/** Two decimals, non-negative — the numeric contract of every mark cell. */
const MARK_NUMBER = {
  maxDecimalPlaces: 2,
  allowNaN: false,
  allowInfinity: false,
} as const;

/**
 * One candidate's cell in the mark-entry grid.
 *
 * The upper bounds are NOT here: a component's ceiling is its allocation
 * on `exam_subjects`, one join away, so `mark-entry.engine.ts` owns that
 * check and reports every violation at once. What lives here is the
 * shape — types, decimals and the absurd-value guard.
 */
export class MarkInputDto {
  @IsUUID()
  enrollmentId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MARK_NUMBER)
  @Min(0)
  @Max(1000)
  cq?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MARK_NUMBER)
  @Min(0)
  @Max(1000)
  mcq?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MARK_NUMBER)
  @Min(0)
  @Max(1000)
  practical?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(MARK_NUMBER)
  @Min(0)
  @Max(1000)
  ca?: number | null;

  /** Flat papers only — a split paper's total is derived from the parts. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber(MARK_NUMBER)
  @Min(0)
  @Max(1000)
  total?: number | null;

  @IsOptional()
  @IsBoolean()
  isAbsent?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  remarks?: string | null;
}

/**
 * Bulk save of one paper's grid. All-or-nothing: a single bad cell
 * refuses the whole payload with `error.details.marks` so the grid can
 * paint every offender, rather than half-saving a section (the M14
 * distribution-grid contract, re-applied).
 */
export class SaveMarksDto {
  @IsUUID()
  examSubjectId!: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MarkInputDto)
  marks!: MarkInputDto[];
}

/** Which paper's grid to fetch. */
export class MarkGridQueryDto {
  @IsUUID()
  examSubjectId!: string;

  /** Narrow a whole-class paper to one section's roster. */
  @IsOptional()
  @IsUUID()
  sectionId?: string;
}

/** Move a paper's marks along the lifecycle (submit / verify / lock). */
export class MarkLifecycleDto {
  @IsUUID()
  examSubjectId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * Change a LOCKED mark. The reason is mandatory and the whole change is
 * written to `mark_corrections` before the mark itself moves — a locked
 * number has usually been published, and the roadmap's re-check flow
 * exists so that a re-check is visible rather than silent.
 */
export class CorrectMarkDto extends MarkInputDto {
  @IsString()
  @MaxLength(500)
  reason!: string;

  /** Recompute this candidate's result immediately (default true). */
  @IsOptional()
  @IsBoolean()
  reprocess?: boolean;
}

export class MarkStatusFilterDto {
  @IsOptional()
  @IsEnum(MarkStatus)
  status?: MarkStatus;
}
