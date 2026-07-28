import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { LeaveType } from '@prisma/client';
import { DATE_PATTERN } from '../../staff/dto/staff.dto';

/** Trigger the automatic withhold-on-dues for an exam. */
export class WithholdDuesDto {
  @IsUUID()
  examId!: string;
}

/** Fire the dues-reminder blast for a session (defaults to current). */
export class DuesRemindersDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}

/**
 * Portal "Contact School" (roadmap M18 §5). No name/phone fields: the
 * sender's identity comes from their account, not the request body.
 */
export class PortalContactDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  body!: string;
}

/**
 * A teacher filing their own leave from the portal. Deliberately has no
 * `teacherId` — the M08 `CreateLeaveDto` does, and accepting it here would
 * let a teacher apply in a colleague's name.
 */
export class PortalLeaveDto {
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
