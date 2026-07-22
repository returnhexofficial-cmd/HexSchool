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
import { Public } from '../../../common/decorators/public.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SkipEnvelope } from '../../../common/decorators/skip-envelope.decorator';
import { DEFAULT_SCHOOL_ID } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PublicResultSearchDto, TranscriptQueryDto } from '../dto';
import { ResultExportService } from '../services/result-export.service';
import { ResultReportsService } from '../services/result-reports.service';
import { ResultsService } from '../services/results.service';

/**
 * Student-scoped result reads. A separate controller from M09's
 * `StudentsController` on purpose — it keeps the result module's
 * dependencies out of the student module, which is what stopped the two
 * from forming a cycle.
 */
@ApiTags('results')
@ApiBearerAuth()
@Controller('students')
export class StudentResultsController {
  constructor(
    private readonly results: ResultsService,
    private readonly reports: ResultReportsService,
    private readonly exports: ResultExportService,
  ) {}

  @Get(':id/transcript')
  @RequirePermissions('result.view')
  @ApiOperation({
    summary: 'Every exam a student sat (optionally one session)',
  })
  async transcript(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TranscriptQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.transcript(id, query, user.schoolId);
  }

  @Get(':id/transcript.pdf')
  @RequirePermissions('result.export')
  @SkipEnvelope()
  async transcriptPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TranscriptQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const transcript = await this.reports.transcript(id, query, user.schoolId);
    const file = await this.exports.transcriptPdf(transcript);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    return new StreamableFile(file.buffer);
  }

  /**
   * The M09 `performance-history` slot, finally filled. Kept on the same
   * path the student detail page already calls so the frontend needed no
   * change to start showing real data.
   */
  @Get(':id/results')
  @RequirePermissions('student.view')
  @ApiOperation({ summary: 'Result history for the student detail page' })
  async history(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const rows = await this.results.transcript(id, {}, user.schoolId);
    return {
      available: true,
      items: rows.map((row) => ({
        examId: row.examId,
        examName: row.exam.name,
        className: row.enrollment.class.name,
        rollNo: row.enrollment.rollNo,
        gpa: Number(row.gpa),
        grade: row.grade,
        status: row.status,
        obtainedMarks: Number(row.obtainedMarks),
        totalMarks: Number(row.totalMarks),
        meritPositionClass: row.meritPositionClass,
        publishedAt: row.publishedAt,
      })),
    };
  }
}

/**
 * The website result search (roadmap M15 §4). Public by design — a
 * parent without an account looks their child's roll number up on
 * publication day, which is what a BD school's website is for that week.
 *
 * Three things keep it safe: it answers only for the ACTIVE publication
 * with the `website` channel on, WITHHELD results are invisible, and a
 * miss and a withheld result return the *same* 404 so the endpoint never
 * confirms that a student exists.
 */
@ApiTags('public')
@Controller('public/results')
export class PublicResultsController {
  constructor(private readonly results: ResultsService) {}

  @Public()
  @Get('search')
  @ApiOperation({
    summary: 'Look a published result up by roll or student UID',
  })
  async search(@Query() query: PublicResultSearchDto) {
    return this.results.publicSearch(query, DEFAULT_SCHOOL_ID);
  }
}
