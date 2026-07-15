import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

/** kebab-case, mirrored by chk_roles_slug_kebab in the DB. */
export const ROLE_SLUG_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export class CreateRoleDto {
  @IsString()
  @Length(2, 64)
  name!: string;

  @IsString()
  @Length(2, 64)
  @Matches(ROLE_SLUG_PATTERN, {
    message: 'slug must be kebab-case (e.g. "exam-controller")',
  })
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
