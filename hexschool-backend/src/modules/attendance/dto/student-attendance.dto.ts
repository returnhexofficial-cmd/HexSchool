import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
import { AttendanceStatus } from '../../../common/constants';

/** YYYY-MM-DD shape check; `parseDate` validates the actual calendar date. */
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = { message: 'date must be YYYY-MM-DD' };

/** Statuses an operator may submit — HOLIDAY is engine-owned (set by the
 *  convert-to-holiday tool), never picked from the marking grid. */
export const MARKABLE_STATUSES = [
  AttendanceStatus.PRESENT,
  AttendanceStatus.ABSENT,
  AttendanceStatus.LATE,
  AttendanceStatus.LEAVE,
  AttendanceStatus.HALF_DAY,
] as const;

export class AttendanceSheetQueryDto {
  @IsUUID()
  sectionId!: string;

  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  date!: string;

  /** Timetable period (M13); omitted = daily mode. */
  @IsOptional()
  @IsUUID()
  periodId?: string;
}

export class AttendanceEntryDto {
  @IsUUID()
  enrollmentId!: string;

  @IsEnum(AttendanceStatus)
  status!: AttendanceStatus;

  /** ISO timestamp; defaults to now for LATE/PRESENT QR marks only. */
  @IsOptional()
  @IsString()
  checkInTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  remarks?: string;
}

export class MarkStudentAttendanceDto {
  @IsUUID()
  sectionId!: string;

  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  date!: string;

  @IsOptional()
  @IsUUID()
  periodId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  entries!: AttendanceEntryDto[];

  /** Mark despite the date being a holiday (attendance.holiday.override). */
  @IsOptional()
  @IsBoolean()
  overrideHoliday?: boolean;
}

export class QrCheckinDto {
  @IsString()
  @MaxLength(128)
  qrToken!: string;

  /** Defaults to today (Asia/Dhaka); explicit dates need attendance.edit. */
  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  date?: string;
}

/** Admin tool for a government holiday declared after marking (M12 §8). */
export class ConvertToHolidayDto {
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  date!: string;

  /** Limit the conversion to one section; omitted = the whole school. */
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsString()
  @MaxLength(300)
  reason!: string;
}
