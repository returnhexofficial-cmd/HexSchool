import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ResultStatus } from '../../../common/constants';

/**
 * Kick off a processing run.
 *
 * `override` is the roadmap §6 escape hatch: processing normally
 * requires every paper LOCKED, but a school that has genuinely finished
 * one class while another is still marking needs to see provisional
 * numbers. It needs `result.process.override`, is recorded on the run,
 * and produces INCOMPLETE results for anyone whose papers are missing.
 */
export class ProcessResultsDto {
  @IsOptional()
  @IsBoolean()
  override?: boolean;

  /** Reprocess exactly one candidate (used after a correction). */
  @IsOptional()
  @IsUUID()
  enrollmentId?: string;
}

export class ResultQueryDto {
  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsEnum(ResultStatus)
  status?: ResultStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

/** Where a published result is visible (roadmap M15 §3 `channels`). */
export class PublicationChannelsDto {
  @IsOptional()
  @IsBoolean()
  portal?: boolean;

  @IsOptional()
  @IsBoolean()
  website?: boolean;

  /** Queue the "GPA 4.83, Merit 3" SMS to every primary guardian. */
  @IsOptional()
  @IsBoolean()
  sms?: boolean;
}

export class PublishResultsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PublicationChannelsDto)
  channels?: PublicationChannelsDto;

  /** Shown in the publication history — the changelog of a republish. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UnpublishResultsDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

/**
 * Withhold or release one candidate's result — dues, discipline, or an
 * enquiry (roadmap §6). Permission-gated; a withheld result disappears
 * from the portal and the public search but is never deleted.
 */
export class WithholdResultDto {
  @IsBoolean()
  withheld!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** One exam's share of a combined result. */
export class CombinedComponentDto {
  @IsUUID()
  examId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(100)
  weight!: number;
}

/**
 * Generate a weighted final result. The weight set must sum to 100
 * (roadmap §7) — checked by the engine, not by a decorator, so the error
 * can name the actual sum.
 */
export class GenerateCombinedResultDto {
  @IsString()
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CombinedComponentDto)
  components!: CombinedComponentDto[];
}

export class CombinedResultQueryDto {
  @IsString()
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;
}

/** Batch report cards / tabulation scope. */
export class ResultExportQueryDto {
  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsUUID()
  enrollmentId?: string;
}

export class TranscriptQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}

/**
 * Public result search (roadmap M15 §4 — the website endpoint; Module 19
 * builds the page). Exactly one of roll/UID identifies the candidate.
 */
export class PublicResultSearchDto {
  @IsUUID()
  examId!: string;

  @IsUUID()
  classId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  rollNo?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  studentUid?: string;
}
