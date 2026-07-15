import { ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * Full replacement set. Non-empty by rule: a user must retain ≥1 role
 * (roadmap M03 §6).
 */
export class SetUserRolesDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'a user must retain at least one role' })
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  roleIds!: string[];
}
