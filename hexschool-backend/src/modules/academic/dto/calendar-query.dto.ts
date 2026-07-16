import { IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** `GET /calendar?month=YYYY-MM&sessionId=` (roadmap M05 §APIs). */
export class CalendarQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month?: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;
}

/** Session filter for the holiday/event list endpoints. */
export class SessionScopedListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}
