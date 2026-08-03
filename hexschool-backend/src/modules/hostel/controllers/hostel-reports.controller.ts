import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SkipEnvelope } from '../../../common/decorators/skip-envelope.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  MealOffReportQueryDto,
  OccupancyQueryDto,
  ResidentsQueryDto,
} from '../dto';
import {
  HostelExportService,
  type ExportFile,
} from '../services/hostel-export.service';
import { HostelReportsService } from '../services/hostel-reports.service';

/** Same download contract as the M15/M18/M22/M23/M24/M25 export routes. */
function streamFile(res: Response, file: ExportFile): StreamableFile {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.filename}"`,
  );
  return new StreamableFile(file.buffer);
}

/** Roadmap §4's `GET /api/v1/hostel/reports/occupancy|residents|dues`. */
@ApiTags('hostel')
@ApiBearerAuth()
@Controller('hostel/reports')
export class HostelReportsController {
  constructor(
    private readonly reports: HostelReportsService,
    private readonly exports: HostelExportService,
  ) {}

  @Get('occupancy')
  @RequirePermissions('hostel.report')
  @ApiOperation({ summary: 'Beds taken, free and out of service, by room' })
  occupancy(
    @Query() query: OccupancyQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.occupancy(query, user.schoolId);
  }

  @Get('occupancy/export')
  @RequirePermissions('hostel.export')
  @SkipEnvelope()
  async occupancyXlsx(
    @Query() query: OccupancyQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.occupancyXlsx(query, user.schoolId),
    );
  }

  @Get('residents')
  @RequirePermissions('hostel.report')
  @ApiOperation({ summary: 'Who sleeps where, with the guardian to ring' })
  residents(
    @Query() query: ResidentsQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.residents(query, user.schoolId);
  }

  @Get('residents/export')
  @RequirePermissions('hostel.export')
  @SkipEnvelope()
  async residentsXlsx(
    @Query() query: ResidentsQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.residentsXlsx(query, user.schoolId),
    );
  }

  @Get('residents/print')
  @RequirePermissions('hostel.export')
  @SkipEnvelope()
  @ApiOperation({ summary: 'The register the warden carries, room by room' })
  async residentsPdf(
    @Query() query: ResidentsQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.residentsPdf(query, user.schoolId),
    );
  }

  @Get('dues')
  @RequirePermissions('hostel.report')
  @ApiOperation({ summary: 'What each boarder owes, from the fee ledger' })
  dues(
    @Query() query: ResidentsQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.dues(query, user.schoolId);
  }

  @Get('dues/export')
  @RequirePermissions('hostel.export')
  @SkipEnvelope()
  async duesXlsx(
    @Query() query: ResidentsQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(res, await this.exports.duesXlsx(query, user.schoolId));
  }

  @Get('meal-offs')
  @RequirePermissions('hostel.report')
  @ApiOperation({ summary: 'Days claimed, approved and credited per boarder' })
  mealOffs(
    @Query() query: MealOffReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.mealOffSummary(query, user.schoolId);
  }

  @Get('meal-offs/export')
  @RequirePermissions('hostel.export')
  @SkipEnvelope()
  async mealOffsXlsx(
    @Query() query: MealOffReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.mealOffsXlsx(query, user.schoolId),
    );
  }
}
