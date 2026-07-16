import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { CalendarEventType } from '../../../common/constants';
import { DATE_MESSAGE, DATE_PATTERN } from './session.dto';

export class CreateCalendarEventDto {
  @IsUUID()
  sessionId!: string;

  @IsString()
  @Length(2, 200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @Matches(DATE_PATTERN, { message: `startDate ${DATE_MESSAGE}` })
  startDate!: string;

  @Matches(DATE_PATTERN, { message: `endDate ${DATE_MESSAGE}` })
  endDate!: string;

  @IsOptional()
  @IsEnum(CalendarEventType)
  type?: CalendarEventType;

  /** Shown on the public website (Module 19). */
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

/** sessionId is immutable — move an event by delete + recreate. */
export class UpdateCalendarEventDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @Matches(DATE_PATTERN, { message: `startDate ${DATE_MESSAGE}` })
  startDate?: string;

  @IsOptional()
  @Matches(DATE_PATTERN, { message: `endDate ${DATE_MESSAGE}` })
  endDate?: string;

  @IsOptional()
  @IsEnum(CalendarEventType)
  type?: CalendarEventType;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
