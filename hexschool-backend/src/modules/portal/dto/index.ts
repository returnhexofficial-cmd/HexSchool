import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TicketCategory, TicketType } from '../../../common/constants';
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
/**
 * The portal "Contact School" form. **M28 turned this into a ticket** —
 * the two optional fields below are what a family can now say about what
 * they are writing, and both default sensibly so an existing caller that
 * sends only `subject` and `body` still works unchanged.
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

  @IsOptional()
  @IsEnum(TicketType)
  type?: TicketType;

  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;
}

/** A reply on the family's own ticket thread (M28). */
export class PortalTicketReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

/** Roadmap M28 §4's satisfaction prompt, answered from the portal. */
export class PortalTicketRatingDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
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
