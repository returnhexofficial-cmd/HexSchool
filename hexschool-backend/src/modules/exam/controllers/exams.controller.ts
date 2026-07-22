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
  AdmitCardBatchDto,
  AppendCandidateDto,
  ChangeExamStatusDto,
  CreateExamDto,
  ExamListQueryDto,
  GenerateSeatPlanDto,
  ReplaceExamSubjectsDto,
  SeatPlanQueryDto,
  SetExamClassesDto,
  ShiftExamDayDto,
  SyncExamSubjectsDto,
  UpdateExamDto,
  UpdateExamSubjectDto,
} from '../dto';
import { AdmitCardService } from '../services/admit-card.service';
import { ExamExportService, ExportFile } from '../services/exam-export.service';
import { ExamRoutineService } from '../services/exam-routine.service';
import { ExamSubjectsService } from '../services/exam-subjects.service';
import { ExamsService } from '../services/exams.service';
import { SeatPlansService } from '../services/seat-plans.service';

@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams')
export class ExamsController {
  constructor(
    private readonly exams: ExamsService,
    private readonly subjects: ExamSubjectsService,
    private readonly routine: ExamRoutineService,
    private readonly seatPlans: SeatPlansService,
    private readonly admitCards: AdmitCardService,
    private readonly exports: ExamExportService,
  ) {}

  // ── exam ────────────────────────────────────────────────────────────

  @Get()
  @RequirePermissions('exam.view')
  @ApiOperation({ summary: 'Exams of a session (filter by type/class/status)' })
  async list(
    @Query() query: ExamListQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.exams.list(query, user.schoolId);
  }

  @Get(':id')
  @RequirePermissions('exam.view')
  @ApiOperation({ summary: 'Exam overview: papers, seat plans, next statuses' })
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.exams.getDetail(id, user.schoolId);
  }

  @Post()
  @RequirePermissions('exam.manage')
  @ApiOperation({
    summary: 'Create an exam (optionally attaching classes and seeding papers)',
  })
  async create(
    @Body() dto: CreateExamDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.exams.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('exam.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExamDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.exams.update(id, dto, user);
  }

  @Put(':id/classes')
  @RequirePermissions('exam.manage')
  @ApiOperation({
    summary: 'Replace the attached class set; seeds papers for new classes',
  })
  async setClasses(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetExamClassesDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.exams.setClasses(id, dto, user);
  }

  @Put(':id/status')
  @RequirePermissions('exam.status')
  @ApiOperation({ summary: 'Advance the exam through its lifecycle' })
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeExamStatusDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.exams.changeStatus(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('exam.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a DRAFT exam (later states are archived)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.exams.remove(id, user);
  }

  // ── papers ──────────────────────────────────────────────────────────

  @Get(':id/subjects')
  @RequirePermissions('exam.view')
  @ApiOperation({ summary: 'Papers with their mark distribution + schedule' })
  async listSubjects(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.subjects.list(id, user.schoolId);
  }

  @Put(':id/subjects')
  @RequirePermissions('exam.manage')
  @ApiOperation({
    summary: 'Replace the paper grid wholesale — refused as a block if invalid',
  })
  async replaceSubjects(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceExamSubjectsDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.subjects.replace(id, dto, user);
  }

  @Put(':id/subjects/:subjectId')
  @RequirePermissions('exam.schedule')
  @ApiOperation({ summary: 'Edit one paper (distribution and/or sitting)' })
  async updateSubject(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() dto: UpdateExamSubjectDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.subjects.update(id, subjectId, dto, user);
  }

  @Delete(':id/subjects/:subjectId')
  @RequirePermissions('exam.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeSubject(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.subjects.remove(id, subjectId, user);
  }

  @Get(':id/subjects-sync')
  @RequirePermissions('exam.view')
  @ApiOperation({
    summary: 'Diff against the class curricula (roadmap §8 "sync subjects")',
  })
  async syncPreview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.subjects.syncPreview(id, user.schoolId);
  }

  @Post(':id/subjects-sync')
  @RequirePermissions('exam.manage')
  @ApiOperation({ summary: 'Apply the curriculum diff' })
  async syncApply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SyncExamSubjectsDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.subjects.syncApply(id, dto, user);
  }

  // ── routine ─────────────────────────────────────────────────────────

  @Get(':id/routine')
  @RequirePermissions('exam.view')
  @ApiOperation({
    summary: 'Sittings grouped by date, with live clash detection',
  })
  async getRoutine(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.routine.getRoutine(id, user.schoolId);
  }

  @Get(':id/routine/pdf')
  @RequirePermissions('exam.export')
  @SkipEnvelope()
  @ApiOperation({ summary: 'Printable exam routine' })
  async routinePdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const routine = await this.routine.getRoutine(id, user.schoolId);
    return this.send(res, await this.exports.routinePdf(routine));
  }

  @Post(':id/routine/shift-day')
  @RequirePermissions('exam.schedule')
  @ApiOperation({
    summary: 'Postpone every sitting of a date (strike/weather tool)',
  })
  async shiftDay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ShiftExamDayDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.routine.shiftDay(id, dto, user);
  }

  // ── seat plans ──────────────────────────────────────────────────────

  @Get(':id/seat-plans')
  @RequirePermissions('exam.view')
  async listSeatPlans(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SeatPlanQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.seatPlans.list(id, user.schoolId, query.date);
  }

  @Get(':id/seat-plans/candidates')
  @RequirePermissions('exam.view')
  @ApiOperation({
    summary: 'Who would be seated on a date (the generator’s dry run)',
  })
  async seatPlanCandidates(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SeatPlanQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    if (!query.date) return [];
    return this.seatPlans.candidates(id, user.schoolId, query.date);
  }

  @Get(':id/seat-plans/pdf')
  @RequirePermissions('exam.export')
  @SkipEnvelope()
  @ApiOperation({ summary: 'Seat plan: summary + one page per room' })
  async seatPlanPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SeatPlanQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const exam = await this.exams.loadExam(id, user.schoolId);
    const plans = await this.seatPlans.list(id, user.schoolId, query.date);
    return this.send(res, await this.exports.seatPlanPdf(exam.name, plans));
  }

  @Post(':id/seat-plans/generate')
  @RequirePermissions('exam.seat-plan.manage')
  @ApiOperation({ summary: 'Generate (or regenerate) the seating for a date' })
  async generateSeatPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateSeatPlanDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.seatPlans.generate(id, dto, user);
  }

  @Post(':id/seat-plans/append')
  @RequirePermissions('exam.seat-plan.manage')
  @ApiOperation({
    summary: 'Seat one late enrollee without disturbing the existing plan',
  })
  async appendCandidate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AppendCandidateDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.seatPlans.appendCandidate(id, dto, user);
  }

  @Delete(':id/seat-plans')
  @RequirePermissions('exam.seat-plan.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeSeatPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SeatPlanQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.seatPlans.removeForDate(id, query.date ?? '', user);
  }

  // ── admit cards ─────────────────────────────────────────────────────

  @Post(':id/admit-cards')
  @RequirePermissions('exam.admit-card')
  @SkipEnvelope()
  @ApiOperation({
    summary: 'Admit card PDFs by section, class or explicit candidates',
  })
  async issueAdmitCards(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdmitCardBatchDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const result = await this.admitCards.generate(id, dto, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="admit-cards-${id}.pdf"`,
    );
    // Counts the UI needs alongside the binary body.
    res.setHeader('X-Admit-Cards-Issued', String(result.issued));
    res.setHeader('X-Admit-Cards-Incomplete', String(result.incomplete.length));
    res.setHeader('X-Admit-Cards-Blocked', String(result.blocked.length));
    return new StreamableFile(result.pdf);
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
