import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Gender, GuardianRelation, Religion } from '../../../common/constants';
import {
  AddressDto,
  BD_PHONE_PATTERN,
  DATE_PATTERN,
} from '../../staff/dto/staff.dto';

export class RequestOtpDto {
  @Matches(BD_PHONE_PATTERN, { message: 'phone must be a BD mobile number' })
  phone!: string;

  /** Google reCAPTCHA response — required when verification is enabled. */
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  recaptchaToken?: string;
}

export class VerifyAdmissionOtpDto {
  @Matches(BD_PHONE_PATTERN, { message: 'phone must be a BD mobile number' })
  phone!: string;

  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}

/** Guardian snapshot inside the application (master rows are only
 *  created at conversion, deduped by phone via the M09 path). */
export class ApplicantGuardianDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameBn?: string;

  @IsEnum(GuardianRelation)
  relation!: GuardianRelation;

  @Matches(BD_PHONE_PATTERN, { message: 'phone must be a BD mobile number' })
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  occupation?: string;
}

export class PublicApplyDto {
  /** Minted by POST /public/admissions/verify-otp (30 min TTL). */
  @IsString()
  verificationToken!: string;

  @IsUUID()
  cycleId!: string;

  @IsUUID()
  classId!: string;

  @IsString()
  @Length(1, 100)
  firstName!: string;

  @IsString()
  @Length(1, 100)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameBn?: string;

  @IsEnum(Gender)
  gender!: Gender;

  @Matches(DATE_PATTERN, { message: 'dob must be YYYY-MM-DD' })
  dob!: string;

  @IsOptional()
  @IsEnum(Religion)
  religion?: Religion;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  presentAddress?: AddressDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  permanentAddress?: AddressDto;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  previousSchool?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  previousGpa?: number;

  /** Free-form previous result details ({ institution, year, result… }). */
  @IsOptional()
  @IsObject()
  previousResult?: Record<string, unknown>;

  @ValidateNested()
  @Type(() => ApplicantGuardianDto)
  guardian!: ApplicantGuardianDto;

  /** S3 key returned by POST /public/admissions/photo. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  recaptchaToken?: string;
}

export class TrackApplicationQueryDto {
  @IsString()
  @Length(3, 30)
  appNo!: string;

  @Matches(BD_PHONE_PATTERN, { message: 'phone must be a BD mobile number' })
  phone!: string;
}

export class PublicPhotoUploadDto {
  @IsString()
  verificationToken!: string;
}
