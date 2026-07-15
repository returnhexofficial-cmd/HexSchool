import {
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

/**
 * Slug is immutable after creation (it's the stable reference for
 * system-role locks and future config); rename via `name` only.
 */
export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @Length(2, 64)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /**
   * Optimistic-concurrency token: the role's `updatedAt` the client last
   * saw. Stale value ⇒ 409 (roadmap M03 §8, two admins editing one role).
   */
  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;
}
