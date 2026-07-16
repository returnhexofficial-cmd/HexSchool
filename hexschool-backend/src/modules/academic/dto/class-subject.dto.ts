import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ClassSubjectRowDto {
  @IsUUID()
  subjectId!: string;

  /** Group-specific subject (Science-only etc.); null/omitted = all groups. */
  @IsOptional()
  @IsUUID()
  groupId?: string;

  /** BD "4th subject" flag. */
  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  fullMarksDefault?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

/**
 * Full replacement of a class's subject mapping for one session
 * (bulk assign, roadmap M06 §4). Row order = display order when
 * displayOrder is omitted.
 */
export class UpdateClassSubjectsDto {
  @IsUUID()
  sessionId!: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ClassSubjectRowDto)
  subjects!: ClassSubjectRowDto[];
}
