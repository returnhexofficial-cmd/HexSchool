import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { SessionStatus } from '../../../common/constants';

/** Plain calendar dates (YYYY-MM-DD) — no timezone ambiguity. */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const DATE_MESSAGE = 'must be a date formatted YYYY-MM-DD';

export class CreateSessionDto {
  /** e.g. "2026" or "2026–27". */
  @IsString()
  @Length(2, 50)
  name!: string;

  @Matches(DATE_PATTERN, { message: `startDate ${DATE_MESSAGE}` })
  startDate!: string;

  @Matches(DATE_PATTERN, { message: `endDate ${DATE_MESSAGE}` })
  endDate!: string;
}

export class UpdateSessionDto {
  @IsOptional()
  @IsString()
  @Length(2, 50)
  name?: string;

  @IsOptional()
  @Matches(DATE_PATTERN, { message: `startDate ${DATE_MESSAGE}` })
  startDate?: string;

  @IsOptional()
  @Matches(DATE_PATTERN, { message: `endDate ${DATE_MESSAGE}` })
  endDate?: string;

  /** is_current is NOT settable here — use POST /:id/activate. */
  @IsOptional()
  @IsEnum(SessionStatus)
  status?: SessionStatus;
}
