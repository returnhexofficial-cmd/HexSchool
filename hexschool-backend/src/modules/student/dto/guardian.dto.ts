import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { GuardianRelation } from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  AddressDto,
  BD_PHONE_PATTERN,
  NID_PATTERN,
} from '../../staff/dto/staff.dto';

export class CreateGuardianDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameBn?: string;

  @IsOptional()
  @IsEnum(GuardianRelation)
  relation?: GuardianRelation;

  @Matches(BD_PHONE_PATTERN, { message: 'phone must be a BD mobile number' })
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @Matches(NID_PATTERN, { message: 'NID must be 10, 13 or 17 digits' })
  nid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  occupation?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyIncome?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;
}

export class UpdateGuardianDto extends PartialType(CreateGuardianDto) {}

export class GuardianQueryDto extends PaginationQueryDto {
  /** Exact-match dedup probe (siblings share guardians — M09 §4). */
  @IsOptional()
  @Matches(BD_PHONE_PATTERN, { message: 'phone must be a BD mobile number' })
  phone?: string;
}

/** Link an existing guardian to a student. */
export class LinkGuardianDto {
  @IsUUID()
  guardianId!: string;

  @IsEnum(GuardianRelation)
  relation!: GuardianRelation;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsBoolean()
  isEmergencyContact?: boolean;
}

export class UpdateGuardianLinkDto {
  @IsOptional()
  @IsEnum(GuardianRelation)
  relation?: GuardianRelation;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsBoolean()
  isEmergencyContact?: boolean;
}
