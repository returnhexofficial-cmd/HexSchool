import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PromotionDecision } from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** One class→class mapping row of a promotion batch (Class 6 → Class 7). */
export class PromotionMappingDto {
  @IsUUID()
  fromClassId!: string;

  /** Target class in the new session (omit for a GRADUATE-only final class). */
  @IsOptional()
  @IsUUID()
  toClassId?: string;

  /** Default target section (per-student override in the decision grid). */
  @IsOptional()
  @IsUUID()
  toSectionId?: string;
}

export class CreatePromotionBatchDto {
  @IsUUID()
  fromSessionId!: string;

  @IsUUID()
  toSessionId!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionMappingDto)
  mappings?: PromotionMappingDto[];
}

/** Per-student decision edit inside a DRAFT batch. */
export class PromotionItemDecisionDto {
  @IsUUID()
  itemId!: string;

  @IsEnum(PromotionDecision)
  decision!: PromotionDecision;

  @IsOptional()
  @IsUUID()
  toClassId?: string | null;

  @IsOptional()
  @IsUUID()
  toSectionId?: string | null;
}

export class UpdatePromotionItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionItemDecisionDto)
  items!: PromotionItemDecisionDto[];
}

export class PromotionQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  fromSessionId?: string;
}

/** Starting roll for auto-assigned rolls in newly created enrollments. */
export class ExecutePromotionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9999)
  rollStartFrom?: number;
}
