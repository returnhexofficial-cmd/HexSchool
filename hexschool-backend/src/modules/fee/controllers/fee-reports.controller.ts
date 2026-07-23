import {
  Controller,
  Get,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SkipEnvelope } from '../../../common/decorators/skip-envelope.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { FeeReportQueryDto } from '../dto';
import { ExportFile, FeeExportService } from '../services/fee-export.service';
import { FeeReportsService } from '../services/fee-reports.service';

@ApiTags('fees')
@ApiBearerAuth()
@Controller('fee-reports')
export class FeeReportsController {
  constructor(
    private readonly reports: FeeReportsService,
    private readonly exports: FeeExportService,
  ) {}

  @Get('daily')
  @RequirePermissions('fee.report')
  @ApiOperation({ summary: 'Collection for a day or range, by method/collector' })
  async daily(
    @Query() query: FeeReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.collection(query, user.schoolId);
  }

  @Get('monthly')
  @RequirePermissions('fee.report')
  @ApiOperation({ summary: 'Billed vs collected per month — the trend chart' })
  async monthly(
    @Query() query: FeeReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.monthly(query, user.schoolId);
  }

  @Get('dues')
  @RequirePermissions('fee.report')
  @ApiOperation({ summary: 'Outstanding dues with aging buckets' })
  async dues(
    @Query() query: FeeReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.dues(query, user.schoolId);
  }

  @Get('defaulters')
  @RequirePermissions('fee.report')
  @ApiOperation({ summary: 'Defaulter list, largest outstanding first' })
  async defaulters(
    @Query() query: FeeReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const report = await this.reports.dues(query, user.schoolId);
    return report.defaulters;
  }

  @Get('head-wise')
  @RequirePermissions('fee.report')
  @ApiOperation({ summary: 'Billed, discounted and net income per fee head' })
  async headWise(
    @Query() query: FeeReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.headWise(query, user.schoolId);
  }

  // ── files ───────────────────────────────────────────────────────────

  @Get('daily.xlsx')
  @RequirePermissions('fee.export')
  @SkipEnvelope()
  async dailyXlsx(
    @Query() query: FeeReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.collection(query, user.schoolId);
    return send(res, await this.exports.collectionXlsx(report));
  }

  @Get('dues.xlsx')
  @RequirePermissions('fee.export')
  @SkipEnvelope()
  async duesXlsx(
    @Query() query: FeeReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.dues(query, user.schoolId);
    return send(res, await this.exports.duesXlsx(report));
  }

  @Get('head-wise.xlsx')
  @RequirePermissions('fee.export')
  @SkipEnvelope()
  async headWiseXlsx(
    @Query() query: FeeReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.headWise(query, user.schoolId);
    return send(res, await this.exports.headWiseXlsx(report));
  }
}

function send(res: Response, file: ExportFile): StreamableFile {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  return new StreamableFile(file.buffer);
}
