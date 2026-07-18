import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AdmissionCycleStatus } from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { DATE_PATTERN } from '../../staff/dto/staff.dto';

/** One class offered by a cycle: seats + application fee (BDT). */
export class CycleClassEntryDto {
  @IsUUID()
  classId!: string;

  @IsInt()
  @Min(1)
  @Max(10_000)
  seats!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  applicationFee?: number;
}

export class CreateAdmissionCycleDto {
  @IsUUID()
  sessionId!: string;

  @IsString()
  @Length(3, 120)
  name!: string;

  /** Application window (ISO 8601 timestamps). */
  @IsISO8601()
  startAt!: string;

  @IsISO8601()
  endAt!: string;

  @IsOptional()
  @IsBoolean()
  testRequired?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  instructions?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CycleClassEntryDto)
  classes!: CycleClassEntryDto[];
}

export class UpdateAdmissionCycleDto extends PartialType(
  CreateAdmissionCycleDto,
) {}

export class AdmissionCycleQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsEnum(AdmissionCycleStatus)
  status?: AdmissionCycleStatus;
}

export class TestSlotDto {
  @IsUUID()
  classId!: string;

  @Matches(DATE_PATTERN, { message: 'testDate must be YYYY-MM-DD' })
  testDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  venue?: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  totalMarks!: number;

  @IsInt()
  @Min(0)
  passMarks!: number;
}

export class ScheduleTestsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => TestSlotDto)
  tests!: TestSlotDto[];
}

export class TestMarkEntryDto {
  @IsUUID()
  applicationId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  marks!: number;
}

export class EnterTestMarksDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => TestMarkEntryDto)
  entries!: TestMarkEntryDto[];
}

export class GenerateMeritListDto {
  @IsUUID()
  classId!: string;
}

export class PromoteWaitlistDto {
  @IsUUID()
  classId!: string;

  /** How many candidates to promote (default 1). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  count?: number;
}

export class MeritListQueryDto {
  @IsUUID()
  classId!: string;
}
