import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
  ProcessResultsDto,
  PublishResultsDto,
  ResultExportQueryDto,
  ResultQueryDto,
  UnpublishResultsDto,
  WithholdResultDto,
} from '../dto';
import { ResultAnalyticsService } from '../services/result-analytics.service';
import {
  ExportFile,
  ResultExportService,
} from '../services/result-export.service';
import { ResultProcessingService } from '../services/result-processing.service';
import { ResultPublicationService } from '../services/result-publication.service';
import { ResultReportsService } from '../services/result-reports.service';
import { ResultsService } from '../services/results.service';
import { ResultQueueService } from '../services/result-queue.service';

@ApiTags('results')
@ApiBearerAuth()
@Controller('exams/:examId')
export class ExamResultsController {
  constructor(
    private readonly results: ResultsService,
    private readonly processing: ResultProcessingService,
    private readonly queue: ResultQueueService,
    private readonly publication: ResultPublicationService,
    private readonly reports: ResultReportsService,
    private readonly analytics: ResultAnalyticsService,
    private readonly exports: ResultExportService,
  ) {}

  // ── processing ──────────────────────────────────────────────────────

  @Post('process')
  @RequirePermissions('result.process')
  @ApiOperation({
    summary: 'Queue a processing run (marks → grades → GPA → merit)',
  })
  async process(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: ProcessResultsDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.queue.dispatch(examId, dto, user);
  }

  @Get('process/status')
  @RequirePermissions('result.view')
  @ApiOperation({ summary: 'Progress of the latest run + staleness check' })
  async processStatus(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.processing.status(examId, user.schoolId);
  }

  @Get('process/history')
  @RequirePermissions('result.view')
  async processHistory(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.processing.history(examId, user.schoolId);
  }

  // ── results ─────────────────────────────────────────────────────────

  @Get('results')
  @RequirePermissions('result.view')
  @ApiOperation({ summary: 'Processed results (class/section/status filters)' })
  async list(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: ResultQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.results.list(examId, query, user.schoolId);
  }

  @Get('results/:enrollmentId')
  @RequirePermissions('result.view')
  @ApiOperation({ summary: 'One candidate’s result with its subject rows' })
  async forCandidate(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.results.getForCandidate(examId, enrollmentId, user.schoolId);
  }

  // ── publication ─────────────────────────────────────────────────────

  @Get('publications')
  @RequirePermissions('result.view')
  @ApiOperation({ summary: 'Publication history (versions + changelog)' })
  async publications(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.publication.history(examId, user.schoolId);
  }

  @Post('publish')
  @RequirePermissions('result.publish')
  @ApiOperation({
    summary: 'Publish results to the chosen channels (portal/website/SMS)',
  })
  async publish(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: PublishResultsDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.publication.publish(examId, dto, user);
  }

  @Post('unpublish')
  @RequirePermissions('result.publish')
  @ApiOperation({
    summary: 'Revoke the active publication (results themselves are untouched)',
  })
  async unpublish(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: UnpublishResultsDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.publication.unpublish(examId, dto, user);
  }

  // ── reports ─────────────────────────────────────────────────────────

  @Get('tabulation')
  @RequirePermissions('result.view')
  @ApiOperation({ summary: 'Full candidate × paper matrix with totals' })
  async tabulation(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: ResultExportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.tabulation(examId, query, user.schoolId);
  }

  @Get('tabulation.xlsx')
  @RequirePermissions('result.export')
  @SkipEnvelope()
  async tabulationXlsx(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: ResultExportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const sheet = await this.reports.tabulation(examId, query, user.schoolId);
    return send(res, await this.exports.tabulationXlsx(sheet));
  }

  @Get('tabulation.pdf')
  @RequirePermissions('result.export')
  @SkipEnvelope()
  async tabulationPdf(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: ResultExportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const sheet = await this.reports.tabulation(examId, query, user.schoolId);
    return send(res, await this.exports.tabulationPdf(sheet));
  }

  @Get('report-cards')
  @RequirePermissions('result.export')
  @SkipEnvelope()
  @ApiOperation({ summary: 'Report card PDFs — one A4 page per candidate' })
  async reportCards(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: ResultExportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const cards = await this.reports.reportCards(examId, query, user.schoolId);
    res.setHeader('X-Report-Cards-Issued', String(cards.length));
    return send(res, await this.exports.reportCardsPdf(cards));
  }

  @Get('analytics')
  @RequirePermissions('result.view')
  @ApiOperation({
    summary: 'Pass rates, GPA histogram, subject difficulty, year-over-year',
  })
  async examAnalytics(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.analytics.forExam(examId, user.schoolId);
  }
}

/**
 * Result-level actions that are not scoped to an exam in the URL — the
 * withhold switch reads better as an action on the result itself.
 */
@ApiTags('results')
@ApiBearerAuth()
@Controller('results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get(':id')
  @RequirePermissions('result.view')
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.results.getById(id, user.schoolId);
  }

  @Put(':id/withhold')
  @RequirePermissions('result.withhold')
  @ApiOperation({
    summary: 'Withhold or release one candidate’s result (reason required)',
  })
  async withhold(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WithholdResultDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.results.setWithheld(id, dto, user);
  }
}

function send(res: Response, file: ExportFile): StreamableFile {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.filename}"`,
  );
  return new StreamableFile(file.buffer);
}
