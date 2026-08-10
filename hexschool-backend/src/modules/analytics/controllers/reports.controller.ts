import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SkipEnvelope } from '../../../common/decorators/skip-envelope.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { RunReportDto } from '../dto';
import { ReportCatalogService } from '../services/report-catalog.service';
import { ReportEngineService } from '../services/report-engine.service';

/**
 * Roadmap §4's `GET /reports (catalog)` and `POST /reports/:code/run`.
 *
 * **This controller replaces M18's**, at the same path. The reports hub is
 * an existing screen with existing links, so moving the catalog to
 * `/analytics/reports` would have broken every one of them for no gain;
 * `GET /reports` returns a superset of what it used to (each entry now
 * carries `output`, `runnable`, `paramsSchema` and `freshness`), which is
 * additive for any caller reading the old fields.
 *
 * Neither route carries a permission code, and that is deliberate: **the
 * catalog self-filters** to what the caller may run, and the run endpoint
 * is authorised by the *report's own* permission inside the engine. A
 * guard here would have to name one code for forty-odd reports.
 */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly catalog: ReportCatalogService,
    private readonly engine: ReportEngineService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'The reports the caller may run — powers the Reports hub',
  })
  list(@CurrentUser() user: AccessTokenPayload) {
    return this.catalog.listFor(user);
  }

  @Get(':code')
  @ApiOperation({ summary: 'One report definition, with its param schema' })
  findOne(
    @Param('code') code: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.findFor(code, user);
  }

  @Post(':code/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Queue a report — returns the run to poll in the export centre',
  })
  run(
    @Param('code') code: string,
    @Body() dto: RunReportDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.engine.enqueue({
      code,
      schoolId: user.schoolId,
      format: dto.format,
      params: dto.params,
      actorId: user.sub,
    });
  }

  /**
   * The synchronous preview the hub shows before anybody downloads
   * anything — the same table the file is rendered from, so what is on
   * screen and what is in the sheet cannot differ, **including the columns
   * the requester is not allowed to see**.
   *
   * It is capped rather than paginated. A preview is for checking the
   * parameters were right; a reader who wants all fifty thousand rows
   * wants the file.
   */
  @Post(':code/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run a report inline and return the first rows' })
  async preview(
    @Param('code') code: string,
    @Body() dto: RunReportDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const { table, stripped } = await this.engine.produce({
      code,
      schoolId: user.schoolId,
      format: 'JSON',
      params: dto.params,
      actorId: user.sub,
    });
    return {
      ...table,
      totalRows: table.rows.length,
      rows: table.rows.slice(0, 100),
      truncated: table.rows.length > 100,
      strippedColumns: stripped,
    };
  }

  /**
   * A small report, rendered and returned in the request.
   *
   * The queue exists because a large export must not block a request
   * (roadmap §4); a two-hundred-row summary going through a queue, an S3
   * upload and a poll is ceremony the user pays for in seconds. The cap is
   * the engine's `maxRows` check — over it, the caller is told to queue it.
   */
  @Post(':code/download')
  @HttpCode(HttpStatus.OK)
  @SkipEnvelope()
  @ApiOperation({ summary: 'Render a report inline (small reports only)' })
  async download(
    @Param('code') code: string,
    @Body() dto: RunReportDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file } = await this.engine.produce({
      code,
      schoolId: user.schoolId,
      format: dto.format ?? 'XLSX',
      params: dto.params,
      actorId: user.sub,
    });
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    return new StreamableFile(file.buffer);
  }
}
