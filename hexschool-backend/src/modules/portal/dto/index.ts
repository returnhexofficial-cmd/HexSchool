import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
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
 * An employee filing their own leave from the portal. Deliberately has no
 * `personType`/`personId` — the M21 `CreateLeaveDto` does, and accepting
 * them here would let anyone apply in a colleague's name.
 */
export class PortalLeaveDto {
  @Matches(DATE_PATTERN, { message: 'fromDate must be YYYY-MM-DD' })
  fromDate!: string;

  @Matches(DATE_PATTERN, { message: 'toDate must be YYYY-MM-DD' })
  toDate!: string;

  @IsUUID()
  leaveTypeId!: string;

  @IsOptional()
  @IsBoolean()
  halfDay?: boolean;

  @IsString()
  @MaxLength(500)
  reason!: string;
}
