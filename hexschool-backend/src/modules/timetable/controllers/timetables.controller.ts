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
  ConflictQueryDto,
  CreateTimetableDto,
  MasterRoutineQueryDto,
  PublishTimetableDto,
  ReplaceEntriesDto,
  TimetableListQueryDto,
} from '../dto';
import {
  ExportFile,
  RoutineExportService,
} from '../services/routine-export.service';
import { RoutineService } from '../services/routine.service';
import { TimetableService } from '../services/timetable.service';

@ApiTags('timetables')
@ApiBearerAuth()
@Controller('timetables')
export class TimetablesController {
  constructor(
    private readonly timetables: TimetableService,
    private readonly routines: RoutineService,
    private readonly exports: RoutineExportService,
  ) {}

  @Get()
  @RequirePermissions('timetable.view')
  @ApiOperation({ summary: 'Routines of a session (filter by class/status)' })
  async list(
    @Query() query: TimetableListQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.timetables.list(query, user.schoolId);
  }

  // Fixed segments before `:id` — Nest matches routes in declaration
  // order and `master`/`conflicts` would otherwise hit the id route.
  @Get('master')
  @RequirePermissions('timetable.view')
  @ApiOperation({
    summary: 'Whole-school grid by shift + read-only teacher load heat view',
  })
  async master(
    @Query() query: MasterRoutineQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.routines.masterRoutine(query, user.schoolId);
  }

  @Get('master/export')
  @RequirePermissions('timetable.export')
  @SkipEnvelope()
  async masterExport(
    @Query() query: MasterRoutineQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const routine = await this.routines.masterRoutine(query, user.schoolId);
    return this.send(res, await this.exports.masterPdf(routine));
  }

  @Get('conflicts')
  @RequirePermissions('timetable.view')
  @ApiOperation({
    summary: 'Cell-editor probe: is this teacher/room free at day+period?',
  })
  async conflicts(
    @Query() query: ConflictQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.timetables.probeConflicts(query, user.schoolId);
  }

  @Get(':id')
  @RequirePermissions('timetable.view')
  @ApiOperation({
    summary: 'Builder payload: grid axes, saved cells, live conflicts',
  })
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.timetables.getDetail(id, user.schoolId);
  }

  @Get(':id/pdf')
  @RequirePermissions('timetable.export')
  @SkipEnvelope()
  @ApiOperation({ summary: 'Printable routine of this version' })
  async pdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const detail = await this.timetables.getDetail(id, user.schoolId);
    const routine = await this.routines.sectionRoutine(
      detail.timetable.sectionId,
      { sessionId: detail.timetable.sessionId, includeDraft: true },
      user.schoolId,
    );
    return this.send(res, await this.exports.sectionPdf(routine));
  }

  @Post()
  @RequirePermissions('timetable.manage')
  @ApiOperation({
    summary:
      'Start a draft routine for a section (optionally seeded from the published one)',
  })
  async create(
    @Body() dto: CreateTimetableDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.timetables.createDraft(dto, user);
  }

  @Put(':id/entries')
  @RequirePermissions('timetable.manage')
  @ApiOperation({
    summary:
      'Replace a draft grid wholesale — refused as a block if anything conflicts',
  })
  async replaceEntries(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceEntriesDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.timetables.replaceEntries(id, dto, user);
  }

  @Post(':id/publish')
  @RequirePermissions('timetable.publish')
  @ApiOperation({
    summary: 'Publish the draft; the routine it replaces becomes ARCHIVED',
  })
  async publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishTimetableDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.timetables.publish(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('timetable.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Discard a draft (published versions are history)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.timetables.remove(id, user);
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
