import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { UserStatus, UserType } from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class UsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(UserType)
  userType?: UserType;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsUUID()
  roleId?: string;
}

export class UpdateUserStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;

  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;
}
