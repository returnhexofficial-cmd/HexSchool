import { ApiProperty } from '@nestjs/swagger';
import {
  IsJWT,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Complexity rules (min 8, upper, lower, digit) — reusable via inheritance. */
export class NewPasswordDto {
  @ApiProperty({
    description: 'Min 8 chars with at least one uppercase, lowercase, digit',
    example: 'NewPass123',
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128)
  @Matches(/[A-Z]/, { message: 'Password must include an uppercase letter' })
  @Matches(/[a-z]/, { message: 'Password must include a lowercase letter' })
  @Matches(/\d/, { message: 'Password must include a digit' })
  newPassword: string;
}

export class ResetPasswordDto extends NewPasswordDto {
  @ApiProperty({
    description: 'Short-lived token returned by POST /auth/verify-otp',
  })
  @IsString()
  @IsJWT()
  resetToken: string;
}

export class ChangePasswordDto extends NewPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword: string;
}
