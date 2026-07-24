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
import { DuesRemindersDto, WithholdDuesDto } from '../dto';
import { DashboardService } from '../services/dashboard.service';
import { PortalActionsService } from '../services/portal-actions.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly actions: PortalActionsService,
  ) {}

  @Get('admin')
  @RequirePermissions('dashboard.admin')
  @ApiOperation({ summary: 'Admin/principal dashboard aggregate (cached)' })
  admin(@CurrentUser() user: AccessTokenPayload) {
    return this.dashboard.admin(user.schoolId);
  }

  @Get('accountant')
  @RequirePermissions('dashboard.accountant')
  @ApiOperation({ summary: 'Accountant workspace aggregate (cached)' })
  accountant(@CurrentUser() user: AccessTokenPayload) {
    return this.dashboard.accountant(user.schoolId);
  }

  @Post('withhold-dues-results')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('result.withhold')
  @ApiOperation({
    summary: 'Withhold every result of an exam whose candidate owes dues',
  })
  withholdDues(
    @Body() dto: WithholdDuesDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.actions.withholdResultsForDues(dto.examId, user);
  }

  @Post('dues-reminders')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fee.report')
  @ApiOperation({ summary: 'SMS every defaulter’s guardian a dues reminder' })
  duesReminders(
    @Body() dto: DuesRemindersDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.actions.sendDuesReminders(dto.sessionId, user);
  }
}
