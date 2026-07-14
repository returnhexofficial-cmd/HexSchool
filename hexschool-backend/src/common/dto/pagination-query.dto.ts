import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export const MAX_PAGE_LIMIT = 100;

/**
 * Standard list-endpoint query: `?page=1&limit=20&sort=field:asc&search=`.
 * Extend per module to add typed filters.
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit: number = 20;

  /** `field:asc` or `field:desc` — validated against a per-repository whitelist. */
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z_][a-zA-Z0-9_]*:(asc|desc)$/i, {
    message: 'sort must look like "field:asc" or "field:desc"',
  })
  sort?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
