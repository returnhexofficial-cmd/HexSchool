import {
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

/** Full replacement set — grants not listed are revoked. */
export class UpdateRolePermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/, {
    each: true,
    message: 'permission codes look like "student.create" / "exam.mark.entry"',
  })
  permissionCodes!: string[];

  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;
}
