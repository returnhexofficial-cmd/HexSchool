import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import {
  SmsOutboxService,
  SmsOutboxEntry,
} from '../services/sms-outbox.service';

/**
 * Dev-only SMS outbox reader — `GET /api/v1/dev/sms`.
 *
 * The browser-QA equivalent of opening Mailpit, for flows gated on an SMS code
 * (the M10 public admission wizard starts with one). See SmsOutboxService for
 * why the message body is not in the log.
 *
 * **Disabled by default and unreachable in production.** When the outbox is
 * off this answers **404**, not 403 — an endpoint that does not exist should
 * not advertise that it exists. It is excluded from Swagger for the same
 * reason.
 */
@ApiExcludeController()
@Controller('dev/sms')
export class DevSmsController {
  constructor(private readonly outbox: SmsOutboxService) {}

  @Public()
  @Get()
  list(@Query('to') to?: string): { messages: SmsOutboxEntry[] } {
    if (!this.outbox.enabled) {
      throw new NotFoundException('Cannot GET /api/v1/dev/sms');
    }
    return { messages: this.outbox.list(to) };
  }
}
