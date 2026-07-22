import { IsEnum, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { DATE_REGEX } from './timetable.dto';

/** Mirrors the M12 report-export convention (`?format=xlsx|pdf`). */
export enum RoutineFormat {
  PDF = 'pdf',
}

export class RoutineQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  /**
   * Read the DRAFT instead of the published routine — the builder's
   * preview. Portals never pass it (roadmap M13 §6: only PUBLISHED is
   * portal-visible), and the route's permission gate keeps it internal.
   */
  @IsOptional()
  @IsString()
  includeDraft?: string;
}

export class MasterRoutineQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;
}

export class RoutineExportQueryDto extends RoutineQueryDto {
  @IsOptional()
  @IsEnum(RoutineFormat)
  format?: RoutineFormat;
}

/** `getCurrentPeriod(sectionId, datetime)` — the period-attendance helper.
 *  The section comes from the route path, not the query. */
export class CurrentPeriodQueryDto {
  /** YYYY-MM-DD; defaults to today in Asia/Dhaka. */
  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  /** HH:mm; defaults to the current Dhaka wall clock. */
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'at must be HH:mm' })
  at?: string;
}

export class WorkloadQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}
