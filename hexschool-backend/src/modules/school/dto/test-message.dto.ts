import { IsEmail, IsOptional, Matches } from 'class-validator';

export class TestEmailDto {
  /** Defaults to the configured from_email when omitted. */
  @IsOptional()
  @IsEmail()
  to?: string;
}

export class TestSmsDto {
  @IsOptional()
  @Matches(/^01[3-9]\d{8}$/, { message: 'to must be a BD phone (01XXXXXXXXX)' })
  to?: string;
}
