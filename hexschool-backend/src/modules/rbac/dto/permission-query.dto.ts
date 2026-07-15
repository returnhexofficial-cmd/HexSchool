import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class PermissionQueryDto {
  /** Include registry-removed (orphaned) codes — for cleanup UIs. */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeOrphaned?: boolean;
}
