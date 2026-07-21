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
import {
  AttendancePersonType,
  AttendanceStatus,
} from '../../../common/constants';
import { DATE_REGEX } from './student-attendance.dto';

const DATE_MESSAGE = { message: 'date must be YYYY-MM-DD' };

export class StaffAttendanceQueryDto {
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  date!: string;

  /** Omitted = both teachers and non-teaching staff. */
  @IsOptional()
  @IsEnum(AttendancePersonType)
  personType?: AttendancePersonType;

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class StaffAttendanceEntryDto {
  @IsEnum(AttendancePersonType)
  personType!: AttendancePersonType;

  /** teachers.id or staff_profiles.id, per `personType`. */
  @IsUUID()
  personId!: string;

  @IsEnum(AttendanceStatus)
  status!: AttendanceStatus;

  @IsOptional()
  @IsString()
  checkInTime?: string;

  @IsOptional()
  @IsString()
  checkOutTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  remarks?: string;
}

export class MarkStaffAttendanceDto {
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  date!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => StaffAttendanceEntryDto)
  entries!: StaffAttendanceEntryDto[];

  @IsOptional()
  @IsBoolean()
  overrideHoliday?: boolean;
}
