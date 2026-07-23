import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  BulkSendDto,
  MarkReadDto,
  NotificationLogQueryDto,
  RetryDto,
  SendDirectDto,
} from '../dto';
import { BulkService } from '../services/bulk.service';
import { InboxService } from '../services/inbox.service';
import { NotificationLogService } from '../services/notification-log.service';

@ApiTags('communication')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly log: NotificationLogService,
    private readonly bulk: BulkService,
    private readonly inbox: InboxService,
  ) {}

  // ── in-app inbox (any authenticated user) ────────────────────────────

  @Get('me')
  @ApiOperation({ summary: 'My in-app notifications + unread count' })
  me(
    @CurrentUser() user: AccessTokenPayload,
    @Query('unread') unread?: string,
  ) {
    return this.inbox.list(user, unread === 'true');
  }

  @Put('me/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark my in-app notifications read' })
  async markRead(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: MarkReadDto,
  ) {
    const updated = await this.inbox.markRead(user, dto.ids);
    return { updated };
  }

  // ── log + send ───────────────────────────────────────────────────────

  @Get()
  @RequirePermissions('notification.view')
  @ApiOperation({ summary: 'The delivery log (channel/status filters)' })
  list(
    @Query() query: NotificationLogQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.log.list(user.schoolId, query, {
      channel: query.channel,
      status: query.status,
    });
  }

  @Post('send')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('notification.send')
  @ApiOperation({ summary: 'Send one ad-hoc message to a recipient' })
  send(@Body() dto: SendDirectDto, @CurrentUser() user: AccessTokenPayload) {
    return this.log.sendDirect(dto, user);
  }

  @Post('bulk/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notification.bulk')
  @ApiOperation({ summary: 'Audience count + SMS cost estimate' })
  bulkPreview(
    @Body() dto: BulkSendDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.bulk.preview(user.schoolId, dto);
  }

  @Post('bulk')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('notification.bulk')
  @ApiOperation({ summary: 'Fan a message out to a resolved audience' })
  bulkSend(@Body() dto: BulkSendDto, @CurrentUser() user: AccessTokenPayload) {
    return this.bulk.send(user.schoolId, dto, user);
  }

  @Post('retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notification.send')
  @ApiOperation({ summary: 'Re-queue FAILED messages' })
  async retry(@Body() dto: RetryDto, @CurrentUser() user: AccessTokenPayload) {
    const requeued = await this.log.retryFailed(user.schoolId, dto.ids);
    return { requeued };
  }

  @Get(':id')
  @RequirePermissions('notification.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.log.get(id, user.schoolId);
  }
}
