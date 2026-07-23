import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { SkipAudit } from '../../audit/decorators/audit.decorator';
import { DlrService } from '../services/dlr.service';

/**
 * SMS delivery-report webhook (roadmap M17 §4). Public + secret-verified:
 * the provider POSTs the outcome for a message id, authenticated by the
 * `communication.dlr_webhook_secret` shared secret. Not audited (machine
 * noise), and it never trusts the body for anything but the id + status.
 */
@ApiTags('communication')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly dlr: DlrService) {}

  @Post('sms-dlr')
  @Public()
  @SkipAudit()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SMS delivery-report callback (secret-verified)' })
  smsDlr(
    @Query('secret') secret: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.dlr.handle(secret, body);
  }
}
