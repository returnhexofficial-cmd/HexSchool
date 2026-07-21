import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { LeaveStatus, StudentLeaveAppliedBy } from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { DATE_REGEX } from './student-attendance.dto';

const DATE_MESSAGE = { message: 'date must be YYYY-MM-DD' };

export class CreateStudentLeaveDto {
  @IsUUID()
  studentId!: string;

  /** Defaults to the student's current session enrollment. */
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  fromDate!: string;

  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  toDate!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsEnum(StudentLeaveAppliedBy)
  appliedBy?: StudentLeaveAppliedBy;
}

/** PENDING applications only — approved ranges are corrected by rejecting
 *  and re-applying, so the retro-marked LEAVE days stay auditable. */
export class UpdateStudentLeaveDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  fromDate?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  toDate?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}

export class DecideStudentLeaveDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class StudentLeaveQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsEnum(LeaveStatus)
  status?: LeaveStatus;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  to?: string;
}
