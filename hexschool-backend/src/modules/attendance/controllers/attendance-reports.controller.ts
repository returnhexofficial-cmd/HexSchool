import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import {
  DailyReportQueryDto,
  LateAnalysisQueryDto,
  MonthlyReportQueryDto,
  ReportFormat,
  StaffReportQueryDto,
  StudentReportQueryDto,
  SummaryReportQueryDto,
} from '../dto';
import {
  AttendanceExportService,
  ExportFile,
} from '../services/attendance-export.service';
import { AttendanceReportsService } from '../services/attendance-reports.service';
import { AttendanceSettingsService } from '../services/attendance-settings.service';

/**
 * Attendance reporting. The plain routes return the JSON the admin
 * tables render; the mirrored `/export` routes return XLSX or PDF bytes
 * (`@SkipEnvelope` + `StreamableFile`, the M09 binary-response
 * convention) — one shape per report, two renderers.
 */
@ApiTags('attendance-reports')
@ApiBearerAuth()
@Controller('attendance/reports')
export class AttendanceReportsController {
  constructor(
    private readonly reports: AttendanceReportsService,
    private readonly exports: AttendanceExportService,
    private readonly config: AttendanceSettingsService,
  ) {}

  // ── daily ───────────────────────────────────────────────────────────

  @Get('daily')
  @RequirePermissions('attendance.view')
  @ApiOperation({
    summary: 'Daily sheet — one section, or every section of the session',
  })
  async daily(
    @Query() query: DailyReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.daily(query, user.schoolId);
  }

  @Get('daily/export')
  @RequirePermissions('attendance.report')
  @SkipEnvelope()
  async dailyExport(
    @Query() query: DailyReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.daily(query, user.schoolId);
    return this.send(
      res,
      query.format === ReportFormat.PDF
        ? await this.exports.dailyPdf(report)
        : await this.exports.dailyXlsx(report),
    );
  }

  // ── monthly register ────────────────────────────────────────────────

  @Get('monthly')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Monthly register matrix (students × days)' })
  async monthly(
    @Query() query: MonthlyReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.monthly(query, user.schoolId);
  }

  @Get('monthly/export')
  @RequirePermissions('attendance.report')
  @SkipEnvelope()
  async monthlyExport(
    @Query() query: MonthlyReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.monthly(query, user.schoolId);
    return this.send(
      res,
      query.format === ReportFormat.PDF
        ? await this.exports.monthlyPdf(report)
        : await this.exports.monthlyXlsx(report),
    );
  }

  // ── per student ─────────────────────────────────────────────────────

  @Get('student/:id')
  @RequirePermissions('attendance.view')
  @ApiOperation({
    summary: 'One student: percentage, per-section split, day-by-day list',
  })
  async student(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: StudentReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.student(id, query, user.schoolId);
  }

  @Get('student/:id/export')
  @RequirePermissions('attendance.report')
  @SkipEnvelope()
  async studentExport(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: StudentReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.student(id, query, user.schoolId);
    return this.send(
      res,
      query.format === ReportFormat.PDF
        ? await this.exports.studentPdf(report)
        : await this.exports.studentXlsx(report),
    );
  }

  // ── staff ───────────────────────────────────────────────────────────

  @Get('staff')
  @RequirePermissions('attendance.staff.view')
  @ApiOperation({ summary: 'Monthly employee attendance register' })
  async staff(
    @Query() query: StaffReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.staff(query, user.schoolId);
  }

  @Get('staff/export')
  @RequirePermissions('attendance.report')
  @SkipEnvelope()
  async staffExport(
    @Query() query: StaffReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.staff(query, user.schoolId);
    return this.send(
      res,
      query.format === ReportFormat.PDF
        ? await this.exports.staffPdf(report)
        : await this.exports.staffXlsx(report),
    );
  }

  // ── summary + late analysis ─────────────────────────────────────────

  @Get('summary')
  @RequirePermissions('attendance.view')
  @ApiOperation({
    summary: 'Session summary: overall %, section comparison, daily trend',
  })
  async summary(
    @Query() query: SummaryReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.summary(query, user.schoolId);
  }

  @Get('summary/export')
  @RequirePermissions('attendance.report')
  @SkipEnvelope()
  async summaryExport(
    @Query() query: SummaryReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.summary(query, user.schoolId);
    return this.send(
      res,
      query.format === ReportFormat.PDF
        ? await this.exports.summaryPdf(report)
        : await this.exports.summaryXlsx(report),
    );
  }

  @Get('late-analysis')
  @RequirePermissions('attendance.view')
  @ApiOperation({
    summary: 'Late days per student for a month (flagged above the threshold)',
  })
  async lateAnalysis(
    @Query() query: LateAnalysisQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const { lateAlertThreshold } = await this.config.load(user.schoolId);
    return this.reports.lateAnalysis(query, user.schoolId, lateAlertThreshold);
  }

  @Get('late-analysis/export')
  @RequirePermissions('attendance.report')
  @SkipEnvelope()
  async lateAnalysisExport(
    @Query() query: LateAnalysisQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { lateAlertThreshold } = await this.config.load(user.schoolId);
    const report = await this.reports.lateAnalysis(
      query,
      user.schoolId,
      lateAlertThreshold,
    );
    return this.send(
      res,
      query.format === ReportFormat.PDF
        ? await this.exports.lateAnalysisPdf(report)
        : await this.exports.lateAnalysisXlsx(report),
    );
  }

  // ── internals ───────────────────────────────────────────────────────

  private send(res: Response, file: ExportFile): StreamableFile {
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    return new StreamableFile(file.buffer);
  }
}
