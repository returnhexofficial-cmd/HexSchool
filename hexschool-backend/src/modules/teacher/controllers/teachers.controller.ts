import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  CreateEvaluationDto,
  CreateQualificationDto,
  CreateTeacherDto,
  SetTeacherSubjectsDto,
  TeacherQueryDto,
  UpdateEvaluationDto,
  UpdateQualificationDto,
  UpdateTeacherDto,
  UpdateTeacherStatusDto,
  UploadTeacherDocumentDto,
} from '../dto';
import { TeacherAssignmentsService } from '../services/teacher-assignments.service';
import { TeacherDocumentsService } from '../services/teacher-documents.service';
import { TeacherEvaluationsService } from '../services/teacher-evaluations.service';
import { TeachersService } from '../services/teachers.service';

@ApiTags('teachers')
@ApiBearerAuth()
@Controller('teachers')
export class TeachersController {
  constructor(
    private readonly teachers: TeachersService,
    private readonly documents: TeacherDocumentsService,
    private readonly evaluations: TeacherEvaluationsService,
    private readonly assignments: TeacherAssignmentsService,
  ) {}

  @Get()
  @RequirePermissions('teacher.view')
  @ApiOperation({
    summary: 'Teacher list (filter: designation/department/status/subject)',
  })
  async list(
    @Query() query: TeacherQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.teachers.list(query, user.schoolId);
  }

  @Get(':id')
  @RequirePermissions('teacher.view')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.teachers.getDetail(id, user.schoolId);
  }

  @Post()
  @RequirePermissions('teacher.create')
  @ApiOperation({
    summary:
      'Create teacher (+ user account with temp password, gap-free ID, teacher role)',
  })
  async create(
    @Body() dto: CreateTeacherDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.teachers.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('teacher.update')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeacherDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.teachers.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('teacher.delete')
  @ApiOperation({
    summary: 'Soft-delete (blocked while current-session duties exist)',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.teachers.remove(id, user);
    return { message: 'Teacher deleted' };
  }

  @Put(':id/status')
  @RequirePermissions('teacher.status')
  @ApiOperation({
    summary:
      'Status transition with reason (RESIGNED/TERMINATED blocked until assignments are transferred)',
  })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeacherStatusDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.teachers.updateStatus(id, dto, user);
  }

  @Post(':id/photo')
  @RequirePermissions('teacher.update')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  async uploadPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.teachers.uploadPhoto(id, file, user);
  }

  // ── qualifications ────────────────────────────────────────────────

  @Get(':id/qualifications')
  @RequirePermissions('teacher.view')
  async listQualifications(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.teachers.listQualifications(id, user.schoolId);
  }

  @Post(':id/qualifications')
  @RequirePermissions('teacher.qualification.manage')
  async addQualification(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateQualificationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.teachers.addQualification(id, dto, user);
  }

  @Put(':id/qualifications/:qid')
  @RequirePermissions('teacher.qualification.manage')
  async updateQualification(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('qid', ParseUUIDPipe) qid: string,
    @Body() dto: UpdateQualificationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.teachers.updateQualification(id, qid, dto, user);
  }

  @Delete(':id/qualifications/:qid')
  @RequirePermissions('teacher.qualification.manage')
  async removeQualification(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('qid', ParseUUIDPipe) qid: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.teachers.removeQualification(id, qid, user);
    return { message: 'Qualification deleted' };
  }

  // ── subject expertise ─────────────────────────────────────────────

  @Get(':id/subjects')
  @RequirePermissions('teacher.view')
  async getSubjects(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.teachers.getSubjects(id, user.schoolId);
  }

  @Put(':id/subjects')
  @RequirePermissions('teacher.subject.assign')
  @ApiOperation({ summary: "Replace a teacher's subject expertise set" })
  async setSubjects(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetTeacherSubjectsDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.teachers.setSubjects(id, dto.subjectIds, user);
  }

  // ── schedule (interim: assignment slots; periods arrive with M13) ──

  @Get(':id/schedule')
  @RequirePermissions('teacher.view')
  async schedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.schedule(id, sessionId, user.schoolId);
  }

  // ── evaluations ───────────────────────────────────────────────────

  @Get(':id/evaluations')
  @RequirePermissions('teacher.view')
  async listEvaluations(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Query('sessionId') sessionId?: string,
  ) {
    return this.evaluations.list(id, user.schoolId, sessionId || undefined);
  }

  @Post(':id/evaluations')
  @RequirePermissions('teacher.evaluation.manage')
  async createEvaluation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateEvaluationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.evaluations.create(id, dto, user);
  }

  @Put(':id/evaluations/:eid')
  @RequirePermissions('teacher.evaluation.manage')
  async updateEvaluation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('eid', ParseUUIDPipe) eid: string,
    @Body() dto: UpdateEvaluationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.evaluations.update(id, eid, dto, user);
  }

  @Delete(':id/evaluations/:eid')
  @RequirePermissions('teacher.evaluation.manage')
  async removeEvaluation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('eid', ParseUUIDPipe) eid: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.evaluations.remove(id, eid, user);
    return { message: 'Evaluation deleted' };
  }

  // ── documents ─────────────────────────────────────────────────────

  @Get(':id/documents')
  @RequirePermissions('teacher.view')
  async listDocuments(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.documents.list(id, user.schoolId);
  }

  @Post(':id/documents')
  @RequirePermissions('teacher.document.manage')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string' },
        type: { type: 'string' },
      },
    },
  })
  async uploadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadTeacherDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.documents.upload(id, dto, file, user);
  }

  @Delete(':id/documents/:docId')
  @RequirePermissions('teacher.document.manage')
  async removeDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.documents.remove(id, docId, user);
    return { message: 'Document deleted' };
  }
}
