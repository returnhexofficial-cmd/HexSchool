import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { LeaveStatus, LeaveType } from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { DATE_PATTERN } from '../../staff/dto/staff.dto';

export class CreateLeaveDto {
  @IsUUID()
  teacherId!: string;

  @Matches(DATE_PATTERN, { message: 'fromDate must be YYYY-MM-DD' })
  fromDate!: string;

  @Matches(DATE_PATTERN, { message: 'toDate must be YYYY-MM-DD' })
  toDate!: string;

  @IsOptional()
  @IsEnum(LeaveType)
  type?: LeaveType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Only PENDING leaves are editable; a leave cannot move to another teacher. */
export class UpdateLeaveDto {
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'fromDate must be YYYY-MM-DD' })
  fromDate?: string;

  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'toDate must be YYYY-MM-DD' })
  toDate?: string;

  @IsOptional()
  @IsEnum(LeaveType)
  type?: LeaveType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class LeaveQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @IsOptional()
  @IsEnum(LeaveStatus)
  status?: LeaveStatus;

  @IsOptional()
  @IsEnum(LeaveType)
  type?: LeaveType;
}
