import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Full-replace upsert of the 1:1 medical record (PUT semantics). */
export class UpdateMedicalInfoDto {
  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(272)
  heightCm?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  weightKg?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  allergies?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  chronicConditions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  disabilities?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  emergencyNotes?: string;
}
