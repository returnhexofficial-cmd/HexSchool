import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class GradePointDto {
  /** Grade label, e.g. "A+", "F". */
  @IsString()
  @Length(1, 5)
  grade!: string;

  /** Grade point value, e.g. 5.00 (max 2 decimals — NUMERIC(3,2)). */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9.99)
  point!: number;

  @IsInt()
  @Min(0)
  @Max(100)
  minMark!: number;

  @IsInt()
  @Min(0)
  @Max(100)
  maxMark!: number;
}

export class CreateGradingSystemDto {
  @IsString()
  @Length(2, 100)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GradePointDto)
  gradePoints!: GradePointDto[];
}

export class UpdateGradingSystemDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  /** When present, replaces ALL bands wholesale. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GradePointDto)
  gradePoints?: GradePointDto[];
}
