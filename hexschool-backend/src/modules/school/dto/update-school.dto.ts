import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { SchoolType } from '../../../common/constants';

const CURRENT_YEAR = new Date().getFullYear();

/** All fields optional — PUT applies a partial profile update. */
export class UpdateSchoolDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameBn?: string;

  /** Short code used in generated document numbers (uppercase A–Z/0–9). */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9]{2,10}$/, {
    message: 'code must be 2–10 uppercase letters/digits',
  })
  code?: string;

  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'EIIN must be exactly 6 digits' })
  eiinNumber?: string;

  @IsOptional()
  @IsEnum(SchoolType)
  type?: SchoolType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(200)
  website?: string;

  @IsOptional()
  @IsInt()
  @Min(1800)
  @Max(CURRENT_YEAR)
  establishedYear?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  principalName?: string;
}
