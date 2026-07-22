import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateExamTypeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  /**
   * Share of a combined final result, 0–100. Whether the weights of a
   * combined SET add to 100 is a Module 15 question — only that module
   * knows which types a given report card merges (roadmap M14 §7).
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  weight?: number;
}

export class UpdateExamTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  weight?: number | null;
}
