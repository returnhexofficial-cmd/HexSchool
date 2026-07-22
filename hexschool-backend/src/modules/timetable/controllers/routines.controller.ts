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
  CurrentPeriodQueryDto,
  RoutineExportQueryDto,
  RoutineQueryDto,
} from '../dto';
import {
  ExportFile,
  RoutineExportService,
} from '../services/routine-export.service';
import { RoutineService } from '../services/routine.service';

/**
 * The read-only routine surface, mounted on the entities people actually
 * ask about ("show me 7-B's routine", "show me mine") rather than on
 * timetable ids. `includeDraft` needs `timetable.manage` — portals and
 * teachers see PUBLISHED only (roadmap M13 §6).
 */
@ApiTags('routines')
@ApiBearerAuth()
@Controller()
export class RoutinesController {
  constructor(
    private readonly routines: RoutineService,
    private readonly exports: RoutineExportService,
  ) {}

  @Get('sections/:id/routine')
  @RequirePermissions('timetable.view')
  @ApiOperation({ summary: 'Published routine grid of a section' })
  async sectionRoutine(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: RoutineQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.routines.sectionRoutine(
      id,
      {
        ...(query.sessionId ? { sessionId: query.sessionId } : {}),
        includeDraft: await this.mayPreviewDrafts(query, user),
      },
      user.schoolId,
    );
  }

  @Get('sections/:id/routine/pdf')
  @RequirePermissions('timetable.export')
  @SkipEnvelope()
  @ApiOperation({ summary: 'Printable section routine' })
  async sectionRoutinePdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: RoutineExportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const routine = await this.routines.sectionRoutine(
      id,
      {
        ...(query.sessionId ? { sessionId: query.sessionId } : {}),
        includeDraft: await this.mayPreviewDrafts(query, user),
      },
      user.schoolId,
    );
    return this.send(res, await this.exports.sectionPdf(routine));
  }

  @Get('teachers/:id/routine')
  @RequirePermissions('timetable.view')
  @ApiOperation({
    summary: "A teacher's week across every section, with free-period counts",
  })
  async teacherRoutine(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: RoutineQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.routines.teacherRoutine(
      id,
      {
        ...(query.sessionId ? { sessionId: query.sessionId } : {}),
        includeDraft: await this.mayPreviewDrafts(query, user),
      },
      user.schoolId,
    );
  }

  @Get('teachers/:id/routine/pdf')
  @RequirePermissions('timetable.export')
  @SkipEnvelope()
  @ApiOperation({ summary: 'Printable personal routine' })
  async teacherRoutinePdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: RoutineExportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const routine = await this.routines.teacherRoutine(
      id,
      {
        ...(query.sessionId ? { sessionId: query.sessionId } : {}),
        includeDraft: await this.mayPreviewDrafts(query, user),
      },
      user.schoolId,
    );
    return this.send(res, await this.exports.teacherPdf(routine));
  }

  /**
   * Mounted on the section, not under `/timetables`, so it cannot be
   * shadowed by that controller's `:id` route — a fixed segment there
   * would be parsed as a timetable UUID and 400.
   */
  @Get('sections/:id/current-period')
  @RequirePermissions('timetable.view')
  @ApiOperation({
    summary:
      'Which period a section is in now (the period-attendance helper, M12)',
  })
  async currentPeriod(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CurrentPeriodQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.routines.getCurrentPeriod(
      id,
      {
        ...(query.date ? { date: query.date } : {}),
        ...(query.at ? { at: query.at } : {}),
      },
      user.schoolId,
    );
  }

  /**
   * `?includeDraft=true` is honoured only for actors who can build
   * routines. Everyone else silently gets the published view rather than
   * a 403 — the flag is a builder convenience, not an access request.
   */
  private async mayPreviewDrafts(
    query: RoutineQueryDto,
    user: AccessTokenPayload,
  ): Promise<boolean> {
    if (query.includeDraft !== 'true') return false;
    return this.routines.canPreviewDrafts(user);
  }

  private send(res: Response, file: ExportFile): StreamableFile {
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    return new StreamableFile(file.buffer);
  }
}
