import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { AdjustCreditDto } from '../dto';
import { SmsCreditService } from '../services/sms-credit.service';

@ApiTags('communication')
@ApiBearerAuth()
@Controller('sms-credits')
export class SmsCreditsController {
  constructor(private readonly credits: SmsCreditService) {}

  @Get('balance')
  @RequirePermissions('sms.credit.view')
  @ApiOperation({ summary: 'Current SMS-credit balance (parts)' })
  async balance(@CurrentUser() user: AccessTokenPayload) {
    const balance = await this.credits.balance(user.schoolId);
    const metered = await this.credits.isMetered(user.schoolId);
    return { balance, metered };
  }

  @Get('ledger')
  @RequirePermissions('sms.credit.view')
  ledger(@CurrentUser() user: AccessTokenPayload) {
    return this.credits.ledger(user.schoolId);
  }

  @Post('adjust')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('sms.credit.manage')
  @ApiOperation({ summary: 'Record a credit purchase or manual adjustment' })
  async adjust(
    @Body() dto: AdjustCreditDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const balance = dto.purchase
      ? await this.credits.purchase(
          user.schoolId,
          dto.qty,
          dto.ref ?? null,
          user.sub,
        )
      : await this.credits.adjust(
          user.schoolId,
          dto.qty,
          dto.ref ?? null,
          user.sub,
        );
    return { balance };
  }
}
