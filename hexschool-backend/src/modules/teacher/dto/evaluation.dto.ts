import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DATE_PATTERN } from '../../staff/dto/staff.dto';

export class CreateEvaluationDto {
  @IsUUID()
  sessionId!: string;

  /** Per-criterion scores { "Class management": 80, … } (0–100 each —
   *  service-validated; criterion names come from settings). */
  @IsObject()
  criteria!: Record<string, number>;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  score!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;

  @Matches(DATE_PATTERN, { message: 'evaluatedAt must be YYYY-MM-DD' })
  evaluatedAt!: string;
}

export class UpdateEvaluationDto extends PartialType(CreateEvaluationDto) {}
