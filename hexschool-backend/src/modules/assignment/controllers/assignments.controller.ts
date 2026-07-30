import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SkipEnvelope } from '../../../common/decorators/skip-envelope.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  AssignmentQueryDto,
  BulkEvaluateDto,
  CreateAssignmentDto,
  EvaluateSubmissionDto,
  ReturnSubmissionDto,
  UpdateAssignmentDto,
} from '../dto';
import {
  AssignmentExportService,
  type ExportFile,
} from '../services/assignment-export.service';
import { AssignmentUploadsService } from '../services/assignment-uploads.service';
import { AssignmentsService } from '../services/assignments.service';
import { SubmissionsService } from '../services/submissions.service';

@ApiTags('assignments')
@ApiBearerAuth()
@Controller('assignments')
export class AssignmentsController {
  constructor(
    private readonly assignments: AssignmentsService,
    private readonly submissions: SubmissionsService,
    private readonly exports: AssignmentExportService,
    private readonly uploads: AssignmentUploadsService,
  ) {}

  @Get()
  @RequirePermissions('assignment.view')
  @ApiOperation({
    summary:
      'List assignments — scoped to the caller’s own section-subjects unless they hold assignment.all',
  })
  async list(
    @Query() query: AssignmentQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const { rows, total, page, limit } = await this.assignments.list(
      query,
      user,
    );
    return {
      data: rows,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  @Post('attachments')
  @RequirePermissions('assignment.manage')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an attachment; returns the object key' })
  uploadAttachment(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.uploads.upload(file, 'assignment', user.schoolId);
  }

  @Get(':id')
  @RequirePermissions('assignment.view')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.getDetail(id, user);
  }

  @Get(':id/stats')
  @RequirePermissions('assignment.view')
  @ApiOperation({ summary: 'Submission %, late count and the mark spread' })
  stats(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.stats(id, user);
  }

  @Get(':id/submissions')
  @RequirePermissions('assignment.view')
  @ApiOperation({
    summary:
      'The evaluation grid — every candidate on the roster plus anyone who submitted and has since transferred',
  })
  submissionGrid(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.submissions.grid(id, user);
  }

  @Post()
  @RequirePermissions('assignment.manage')
  create(
    @Body() dto: CreateAssignmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('assignment.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssignmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.update(id, dto, user);
  }

  @Post(':id/publish')
  @RequirePermissions('assignment.publish')
  @ApiOperation({
    summary: 'Publish — makes it visible to the section and notifies them',
  })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.publish(id, user);
  }

  @Post(':id/close')
  @RequirePermissions('assignment.publish')
  @ApiOperation({ summary: 'Close — no more submissions, evaluation locks' })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.close(id, user);
  }

  @Post(':id/reopen')
  @RequirePermissions('assignment.publish')
  @ApiOperation({ summary: 'One step back from CLOSED to PUBLISHED' })
  reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.reopen(id, user);
  }

  @Put(':id/evaluate')
  @RequirePermissions('assignment.evaluate')
  @ApiOperation({
    summary: 'The bulk grid — all-or-nothing, every bad cell returned at once',
  })
  evaluateBulk(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BulkEvaluateDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.submissions.evaluateBulk(id, dto, user);
  }

  @Get(':id/export/submissions.zip')
  @RequirePermissions('assignment.export')
  @SkipEnvelope()
  @ApiOperation({
    summary: 'Every submission as one zip, foldered per student',
  })
  async downloadAll(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return stream(res, await this.exports.submissionsZip(id, user));
  }

  @Get(':id/export/marks.xlsx')
  @RequirePermissions('assignment.export')
  @SkipEnvelope()
  @ApiOperation({ summary: 'The submission + marks sheet as XLSX' })
  async downloadMarks(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return stream(res, await this.exports.marksSheet(id, user));
  }

  @Delete(':id')
  @RequirePermissions('assignment.manage')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a draft — refused once anybody has submitted',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.assignments.remove(id, user);
  }
}

@ApiTags('assignments')
@ApiBearerAuth()
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get(':id')
  @RequirePermissions('assignment.view')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.submissions.detail(id, user);
  }

  @Put(':id/evaluate')
  @RequirePermissions('assignment.evaluate')
  evaluate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EvaluateSubmissionDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.submissions.evaluate(id, dto, user);
  }

  @Put(':id/return')
  @RequirePermissions('assignment.evaluate')
  @ApiOperation({ summary: 'Return for revision — feedback is mandatory' })
  returnForRevision(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnSubmissionDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.submissions.returnForRevision(id, dto, user);
  }
}

/** Same download contract as the M15/M18 export routes. */
function stream(res: Response, file: ExportFile): StreamableFile {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.filename}"`,
  );
  return new StreamableFile(file.buffer);
}
