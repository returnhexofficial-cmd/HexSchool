import {
  Body,
  Controller,
  Get,
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
import {
  CorrectMarkDto,
  MarkGridQueryDto,
  MarkLifecycleDto,
  SaveMarksDto,
} from '../dto';
import { MarksService } from '../services/marks.service';
import { ResultProcessingService } from '../services/result-processing.service';

@ApiTags('marks')
@ApiBearerAuth()
@Controller('exams/:examId/marks')
export class MarksController {
  constructor(
    private readonly marks: MarksService,
    private readonly processing: ResultProcessingService,
  ) {}

  @Get()
  @RequirePermissions('mark.view')
  @ApiOperation({
    summary: 'Mark-entry grid for one paper (roster + existing marks)',
  })
  async grid(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: MarkGridQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.marks.grid(examId, query, user.schoolId);
  }

  @Get('status')
  @RequirePermissions('mark.view')
  @ApiOperation({ summary: 'Per-paper entry progress and lifecycle state' })
  async status(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.marks.paperStatuses(examId, user.schoolId);
  }

  @Get('corrections')
  @RequirePermissions('mark.view')
  @ApiOperation({
    summary: 'The correction log — every change to a locked mark',
  })
  async corrections(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.marks.correctionLog(examId, user.schoolId);
  }

  @Put()
  @RequirePermissions('mark.entry')
  @ApiOperation({
    summary: 'Save a paper’s grid as DRAFT — all-or-nothing, autosave-safe',
  })
  async save(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: SaveMarksDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.marks.save(examId, dto, user);
  }

  @Post('submit')
  @RequirePermissions('mark.submit')
  @ApiOperation({ summary: 'Hand a completed paper over for verification' })
  async submit(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: MarkLifecycleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.marks.submit(examId, dto.examSubjectId, user);
  }

  @Post('verify')
  @RequirePermissions('mark.verify')
  @ApiOperation({ summary: 'Verify a submitted paper (controller/head)' })
  async verify(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: MarkLifecycleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.marks.verify(examId, dto.examSubjectId, user);
  }

  @Post('lock')
  @RequirePermissions('mark.lock')
  @ApiOperation({ summary: 'Lock a verified paper — entry closes for good' })
  async lock(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: MarkLifecycleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.marks.lock(examId, dto.examSubjectId, user);
  }

  /**
   * The re-check flow. Correcting a locked mark logs the change and then
   * re-processes that one candidate, so their GPA, grade and merit
   * position are consistent again before anyone reads them.
   */
  @Put(':markId/correct')
  @RequirePermissions('mark.correction')
  @ApiOperation({ summary: 'Change a LOCKED mark (reason required; logged)' })
  async correct(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Param('markId', ParseUUIDPipe) markId: string,
    @Body() dto: CorrectMarkDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const corrected = await this.marks.correct(examId, markId, dto, user);
    if (!corrected.reprocess) return { ...corrected, run: null };

    const run = await this.processing.processNow(
      examId,
      { enrollmentId: corrected.enrollmentId, override: true },
      user,
    );
    return { ...corrected, run };
  }
}
