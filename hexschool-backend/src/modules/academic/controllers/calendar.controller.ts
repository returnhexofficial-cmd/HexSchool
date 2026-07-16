import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SkipEnvelope } from '../../../common/decorators/skip-envelope.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CalendarQueryDto } from '../dto';
import { CalendarService } from '../services/calendar.service';

// Prefix-less controller: `calendar.ics` is a sibling of `calendar`,
// not a child route — a controller prefix would force `/calendar/.ics`.
@ApiTags('calendar')
@ApiBearerAuth()
@Controller()
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('calendar')
  @RequirePermissions('calendar.view')
  @ApiOperation({
    summary:
      'Month/session calendar aggregate (holidays + events + weekly off-days)',
  })
  async month(
    @Query() query: CalendarQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.calendar.month(query, user.schoolId);
  }

  // Global prefix applies → /api/v1/calendar.ics (roadmap M05 §4).
  @Get('calendar.ics')
  @RequirePermissions('calendar.view')
  @SkipEnvelope()
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="hexschool-calendar.ics"',
  )
  @ApiOperation({ summary: 'iCal export (month or session scoped)' })
  async ics(
    @Query() query: CalendarQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<string> {
    return this.calendar.ics(query, user.schoolId);
  }
}
