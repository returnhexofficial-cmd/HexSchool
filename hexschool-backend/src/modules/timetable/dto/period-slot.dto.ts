import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PeriodSlotType } from '../../../common/constants';

/** HH:mm shape; `minutesOfDay` rejects impossible clock values. */
export const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TIME_MESSAGE = { message: 'time must be HH:mm (24-hour)' };

export class PeriodSlotQueryDto {
  /** Omit to list every shift's schedule (the master grid needs all). */
  @IsOptional()
  @IsUUID()
  shiftId?: string;
}

export class CreatePeriodSlotDto {
  @IsUUID()
  shiftId!: string;

  @IsString()
  @MaxLength(50)
  name!: string;

  @IsString()
  @Matches(TIME_REGEX, TIME_MESSAGE)
  startTime!: string;

  @IsString()
  @Matches(TIME_REGEX, TIME_MESSAGE)
  endTime!: string;

  @IsOptional()
  @IsEnum(PeriodSlotType)
  type?: PeriodSlotType;

  /** Position in the day; unique per shift. Defaults to "append". */
  @IsOptional()
  @IsInt()
  @Min(1)
  displayOrder?: number;
}

export class UpdatePeriodSlotDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, TIME_MESSAGE)
  startTime?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, TIME_MESSAGE)
  endTime?: string;

  @IsOptional()
  @IsEnum(PeriodSlotType)
  type?: PeriodSlotType;

  @IsOptional()
  @IsInt()
  @Min(1)
  displayOrder?: number;
}
