import { PartialType } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** 24h wall-clock time for shifts. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// ── Departments ─────────────────────────────────────────────────────

export class CreateDepartmentDto {
  @IsString()
  @Length(2, 100)
  name!: string;

  @IsString()
  @Matches(/^[A-Z0-9-]{2,20}$/, {
    message: 'code must be 2–20 uppercase letters/digits/hyphens',
  })
  code!: string;
}

export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {}

// ── Shifts ──────────────────────────────────────────────────────────

export class CreateShiftDto {
  @IsString()
  @Length(2, 50)
  name!: string;

  @Matches(TIME_PATTERN, { message: 'startTime must be HH:MM (24h)' })
  startTime!: string;

  @Matches(TIME_PATTERN, { message: 'endTime must be HH:MM (24h)' })
  endTime!: string;
}

export class UpdateShiftDto extends PartialType(CreateShiftDto) {}

// ── Classes ─────────────────────────────────────────────────────────

export class CreateClassDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameBn?: string;

  /** 0 = KG/play; BD school levels run 1–12; headroom to 20. */
  @IsInt()
  @Min(0)
  @Max(20)
  numericLevel!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class UpdateClassDto extends PartialType(CreateClassDto) {}

// ── Groups ──────────────────────────────────────────────────────────

export class CreateGroupDto {
  @IsString()
  @Length(2, 50)
  name!: string;

  /** Class level the group applies from (BD default: 9). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  applicableFromLevel?: number;
}

export class UpdateGroupDto extends PartialType(CreateGroupDto) {}

// ── Subjects ────────────────────────────────────────────────────────

export class CreateSubjectDto {
  @IsString()
  @Length(2, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameBn?: string;

  @IsString()
  @Matches(/^[A-Z0-9]{2,20}$/, {
    message: 'code must be 2–20 uppercase letters/digits',
  })
  code!: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @Matches(/^(THEORY|PRACTICAL|BOTH)$/)
  type?: 'THEORY' | 'PRACTICAL' | 'BOTH';
}

export class UpdateSubjectDto extends PartialType(CreateSubjectDto) {}
