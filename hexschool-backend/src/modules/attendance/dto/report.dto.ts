import { IsEnum, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { AttendancePersonType } from '../../../common/constants';
import { DATE_REGEX } from './student-attendance.dto';

const DATE_MESSAGE = { message: 'date must be YYYY-MM-DD' };
const MONTH_REGEX = /^\d{4}-\d{2}$/;
const MONTH_MESSAGE = { message: 'month must be YYYY-MM' };

/** Report download format; omitted = JSON for the on-screen tables. */
export enum ReportFormat {
  XLSX = 'xlsx',
  PDF = 'pdf',
}

export class DailyReportQueryDto {
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  date!: string;

  /** Omitted = every section of the session (class-comparison sheet). */
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;
}

/** Monthly register: the student × days matrix for one section. */
export class MonthlyReportQueryDto {
  @IsUUID()
  sectionId!: string;

  @IsString()
  @Matches(MONTH_REGEX, MONTH_MESSAGE)
  month!: string;

  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;
}

export class StudentReportQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  to?: string;

  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;
}

export class StaffReportQueryDto {
  @IsString()
  @Matches(MONTH_REGEX, MONTH_MESSAGE)
  month!: string;

  @IsOptional()
  @IsEnum(AttendancePersonType)
  personType?: AttendancePersonType;

  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;
}

/** Session-wide summary + section comparison (dashboard charts). */
export class SummaryReportQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  to?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;
}

export class LateAnalysisQueryDto {
  @IsString()
  @Matches(MONTH_REGEX, MONTH_MESSAGE)
  month!: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;
}
