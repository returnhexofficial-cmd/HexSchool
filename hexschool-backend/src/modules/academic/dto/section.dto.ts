import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class CreateSectionDto {
  @IsUUID()
  classId!: string;

  @IsUUID()
  sessionId!: string;

  /** ≤5 chars (roadmap M06 §7), e.g. "A", "B2". */
  @IsString()
  @Length(1, 5)
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: 'name must be letters/digits/hyphen only',
  })
  name!: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  /** Advisory at creation; enforced at enrollment (M11) with override. */
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  roomNo?: string;
}

/** classId/sessionId are immutable — recreate to move a section. */
export class UpdateSectionDto {
  @IsOptional()
  @IsString()
  @Length(1, 5)
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: 'name must be letters/digits/hyphen only',
  })
  name?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string | null;

  @IsOptional()
  @IsUUID()
  groupId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  roomNo?: string;
}

export class SectionListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;
}
