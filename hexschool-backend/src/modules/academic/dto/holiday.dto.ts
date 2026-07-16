import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { HolidayAppliesTo, HolidayType } from '../../../common/constants';
import { DATE_MESSAGE, DATE_PATTERN } from './session.dto';

export class CreateHolidayDto {
  @IsUUID()
  sessionId!: string;

  @IsString()
  @Length(2, 200)
  title!: string;

  @Matches(DATE_PATTERN, { message: `startDate ${DATE_MESSAGE}` })
  startDate!: string;

  @Matches(DATE_PATTERN, { message: `endDate ${DATE_MESSAGE}` })
  endDate!: string;

  @IsOptional()
  @IsEnum(HolidayType)
  type?: HolidayType;

  @IsOptional()
  @IsEnum(HolidayAppliesTo)
  appliesTo?: HolidayAppliesTo;
}

/** sessionId is immutable — move a holiday by delete + recreate. */
export class UpdateHolidayDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  title?: string;

  @IsOptional()
  @Matches(DATE_PATTERN, { message: `startDate ${DATE_MESSAGE}` })
  startDate?: string;

  @IsOptional()
  @Matches(DATE_PATTERN, { message: `endDate ${DATE_MESSAGE}` })
  endDate?: string;

  @IsOptional()
  @IsEnum(HolidayType)
  type?: HolidayType;

  @IsOptional()
  @IsEnum(HolidayAppliesTo)
  appliesTo?: HolidayAppliesTo;
}
