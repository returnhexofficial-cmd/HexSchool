import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const CURRENT_YEAR_MAX = 2100; // service enforces ≤ current year

export class CreateQualificationDto {
  @IsString()
  @Length(2, 100)
  degree!: string;

  @IsString()
  @Length(2, 200)
  institution!: string;

  /** 1950–current year (roadmap M08 §7; upper bound service-checked). */
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(CURRENT_YEAR_MAX)
  passingYear!: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  result?: string;
}

export class UpdateQualificationDto extends PartialType(
  CreateQualificationDto,
) {}
