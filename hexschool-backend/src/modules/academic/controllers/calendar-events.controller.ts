import {
  Body,
  Controller,
  Delete,
  Get,
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
  CreateCalendarEventDto,
  SessionScopedListQueryDto,
  UpdateCalendarEventDto,
} from '../dto';
import { CalendarEventsService } from '../services/calendar-events.service';

@ApiTags('calendar-events')
@ApiBearerAuth()
@Controller('calendar-events')
export class CalendarEventsController {
  constructor(private readonly events: CalendarEventsService) {}

  @Get()
  @RequirePermissions('calendar.view')
  @ApiOperation({ summary: 'List calendar events (filter by session)' })
  async list(
    @Query() query: SessionScopedListQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.events.list(query, user.schoolId);
  }

  @Post()
  @RequirePermissions('event.create')
  @ApiOperation({ summary: 'Add a calendar event' })
  async create(
    @Body() dto: CreateCalendarEventDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.events.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('event.update')
  @ApiOperation({ summary: 'Edit a calendar event' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCalendarEventDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.events.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('event.delete')
  @ApiOperation({ summary: 'Soft-delete a calendar event' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.events.remove(id, user);
    return { message: 'Event removed' };
  }
}
