import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class LogoutDto {
  @ApiPropertyOptional({
    description: 'Revoke every device session, not just this one',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  allDevices?: boolean;
}
