import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { SeatPlanStrategy } from '../../../common/constants';
import { DATE_REGEX } from './exam.dto';

const DATE_MESSAGE = { message: 'date must be YYYY-MM-DD' };

export class RoomSpecDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  room!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  capacity!: number;
}

export class GenerateSeatPlanDto {
  /** The sitting date being seated; every room of it is replaced. */
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  date!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RoomSpecDto)
  rooms!: RoomSpecDto[];

  /** Defaults to `exam.seat_plan_default_strategy`. */
  @IsOptional()
  @IsEnum(SeatPlanStrategy)
  strategy?: SeatPlanStrategy;
}

export class SeatPlanQueryDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  date?: string;
}

/**
 * Seat one candidate the generator never saw (roadmap M14 §8: a student
 * enrolled after the plan was built).
 */
export class AppendCandidateDto {
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  date!: string;

  @IsUUID()
  enrollmentId!: string;
}
