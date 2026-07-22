import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TimetableStatus, Weekday } from '../../../common/constants';

/** YYYY-MM-DD shape check; `parseDate` validates the calendar date. */
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = { message: 'date must be YYYY-MM-DD' };

export class TimetableListQueryDto {
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
  @IsEnum(TimetableStatus)
  status?: TimetableStatus;
}

export class CreateTimetableDto {
  @IsUUID()
  sectionId!: string;

  /** Defaults to the section's own session. */
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  /** Defaults to today (or the session start, whichever is later). */
  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  effectiveFrom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /**
   * Seed the new draft with the currently published routine instead of an
   * empty grid — the normal way to make a small mid-year change.
   */
  @IsOptional()
  @IsBoolean()
  copyFromPublished?: boolean;
}

export class TimetableEntryInputDto {
  @IsEnum(Weekday)
  day!: Weekday;

  @IsUUID()
  periodSlotId!: string;

  @IsUUID()
  subjectId!: string;

  @IsUUID()
  teacherId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  roomNo?: string;

  /** Combined class marker (roadmap M13 §8) — must be another section. */
  @IsOptional()
  @IsUUID()
  combinedWithSectionId?: string;
}

/** Full replacement of a draft's grid — send every cell you want kept. */
export class ReplaceEntriesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => TimetableEntryInputDto)
  entries!: TimetableEntryInputDto[];

  /**
   * Save despite a teacher not being assigned to that section+subject
   * (needs `timetable.assign.override`). Never excuses a hard conflict —
   * those are structural and always refused.
   */
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

export class PublishTimetableDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  effectiveFrom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** Ad-hoc "is this teacher free?" probe for the builder's cell editor. */
export class ConflictQueryDto {
  @IsUUID()
  sessionId!: string;

  @IsUUID()
  teacherId!: string;

  @IsEnum(Weekday)
  day!: Weekday;

  @IsUUID()
  periodSlotId!: string;

  /** The section being edited — its own cells are not competition. */
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  roomNo?: string;
}
