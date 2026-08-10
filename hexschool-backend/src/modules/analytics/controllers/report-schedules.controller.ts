import {
  Body,
  Controller,
  Delete,
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
import { CRON_PRESETS, describeCron } from '../calc/cron.engine';
import { CreateScheduleDto, ScheduleQueryDto, UpdateScheduleDto } from '../dto';
import { ReportSchedulesService } from '../services/report-schedules.service';

/** Roadmap §4's `CRUD /api/v1/report-schedules`. */
@ApiTags('report-schedules')
@ApiBearerAuth()
@Controller('report-schedules')
export class ReportSchedulesController {
  constructor(private readonly schedules: ReportSchedulesService) {}

  /**
   * The cron presets the manager offers (roadmap §5), each with the
   * sentence the parser produces for it — so what the UI promises and what
   * the engine will actually do come from the same place.
   */
  @Get('presets')
  @RequirePermissions('report.schedule.view')
  @ApiOperation({ summary: 'Cron presets with their plain-English reading' })
  presets() {
    return Object.entries(CRON_PRESETS).map(([key, cron]) => ({
      key,
      cron,
      description: describeCron(cron),
    }));
  }

  @Get()
  @RequirePermissions('report.schedule.view')
  @ApiOperation({ summary: 'Scheduled reports' })
  list(
    @Query() query: ScheduleQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.schedules.list(user.schoolId, query);
  }

  @Get(':id')
  @RequirePermissions('report.schedule.view')
  @ApiOperation({ summary: 'One schedule' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.schedules.findOne(id, user.schoolId);
  }

  @Post()
  @RequirePermissions('report.schedule.manage')
  @ApiOperation({ summary: 'Schedule a report' })
  create(
    @Body() dto: CreateScheduleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.schedules.create(dto, user.schoolId, user.sub);
  }

  @Put(':id')
  @RequirePermissions('report.schedule.manage')
  @ApiOperation({ summary: 'Edit, pause or resume a schedule' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScheduleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.schedules.update(id, dto, user.schoolId, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('report.schedule.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a schedule' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<void> {
    await this.schedules.remove(id, user.schoolId);
  }

  /**
   * Roadmap §5's test-run. It needs `report.schedule.manage` **and** the
   * report's own permission, which the engine checks — pressing test on
   * somebody else's payroll schedule must not be a way around
   * `payroll.report`.
   */
  @Post(':id/test-run')
  @RequirePermissions('report.schedule.manage')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Fire this schedule now, off-cycle' })
  testRun(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.schedules.testRun(id, user.schoolId, user.sub);
  }
}
