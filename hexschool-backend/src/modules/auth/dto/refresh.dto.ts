import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RefreshDto {
  @ApiPropertyOptional({
    description:
      'Refresh token in the body — reserved for future mobile clients. ' +
      'Web clients send it via the httpOnly cookie instead.',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
