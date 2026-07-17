import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
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
  ApiBody,
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
  BatchIdCardsDto,
  CheckDuplicatesDto,
  CreatePortalAccountDto,
  CreateStudentDto,
  LinkGuardianDto,
  StudentQueryDto,
  UpdateGuardianLinkDto,
  UpdateMedicalInfoDto,
  UpdateStudentDto,
  UpdateStudentStatusDto,
  UploadStudentDocumentDto,
} from '../dto';
import { GuardiansService } from '../services/guardians.service';
import { IdCardService } from '../services/id-card.service';
import { StudentAccountsService } from '../services/student-accounts.service';
import { StudentDocumentsService } from '../services/student-documents.service';
import { StudentImportService } from '../services/student-import.service';
import { StudentsService } from '../services/students.service';

@ApiTags('students')
@ApiBearerAuth()
@Controller('students')
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly guardians: GuardiansService,
    private readonly accounts: StudentAccountsService,
    private readonly documents: StudentDocumentsService,
    private readonly idCards: IdCardService,
    private readonly importer: StudentImportService,
  ) {}

  @Get()
  @RequirePermissions('student.view')
  @ApiOperation({
    summary:
      'Student list (filter: class/status/gender/religion; search: name/UID/guardian phone)',
  })
  async list(
    @Query() query: StudentQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.students.list(query, user.schoolId);
  }

  // ── import (static segments BEFORE :id routes) ────────────────────

  @Get('import-template')
  @RequirePermissions('student.import')
  @SkipEnvelope()
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @Header(
    'Content-Disposition',
    'attachment; filename="hexschool-students-import.xlsx"',
  )
  @ApiOperation({ summary: 'XLSX import template download' })
  async importTemplate(): Promise<StreamableFile> {
    // A raw Buffer return would be JSON-serialized by the Express
    // adapter — StreamableFile sends the actual bytes.
    return new StreamableFile(await this.importer.buildTemplate());
  }

  @Post('import')
  @RequirePermissions('student.import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        commit: { type: 'string', enum: ['true', 'false'] },
      },
    },
  })
  @ApiOperation({
    summary:
      'Bulk import (dry-run by default; commit=true inserts valid rows, row-level report)',
  })
  async import(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('commit') commit: string | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.importer.import(file, commit === 'true', user);
  }

  @Post('check-duplicates')
  @RequirePermissions('student.create')
  @ApiOperation({ summary: 'Warn-only duplicate probe for the wizard' })
  async checkDuplicates(
    @Body() dto: CheckDuplicatesDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.students.checkDuplicates(dto, user.schoolId);
  }

  @Post('id-cards')
  @RequirePermissions('student.idcard.generate')
  @SkipEnvelope()
  @ApiOperation({
    summary:
      'Batch ID cards PDF (section-scoped batches arrive with M11 rosters)',
  })
  async batchIdCards(
    @Body() dto: BatchIdCardsDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { pdf, incomplete } = await this.idCards.generateBatch(
      dto.studentIds,
      user,
    );
    this.setPdfHeaders(res, 'hexschool-id-cards.pdf', incomplete.length);
    return new StreamableFile(pdf);
  }

  // ── CRUD ──────────────────────────────────────────────────────────

  @Post()
  @RequirePermissions('student.create')
  @ApiOperation({
    summary:
      'Register student (guardians linked/deduped, gap-free UID, warn-only duplicate report)',
  })
  async create(
    @Body() dto: CreateStudentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.students.create(dto, user);
  }

  @Get(':id')
  @RequirePermissions('student.view')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.students.getDetail(id, user.schoolId);
  }

  @Get(':id/full')
  @RequirePermissions('student.view')
  @ApiOperation({
    summary: 'Aggregate: profile + guardians + documents + status trail',
  })
  async getFull(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.students.getFull(id, user.schoolId);
  }

  @Put(':id')
  @RequirePermissions('student.update')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.students.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('student.delete')
  @ApiOperation({
    summary: 'Soft-delete (UID stays burned; portal account deactivated)',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.students.remove(id, user);
    return { message: 'Student deleted' };
  }

  @Put(':id/status')
  @RequirePermissions('student.status')
  @ApiOperation({
    summary:
      'Status transition with reason (exit statuses deactivate the portal account; dues check soft until M16)',
  })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentStatusDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.students.updateStatus(id, dto, user);
  }

  @Post(':id/photo')
  @RequirePermissions('student.update')
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
    return this.students.uploadPhoto(id, file, user);
  }

  @Post(':id/rotate-qr')
  @RequirePermissions('student.update')
  @ApiOperation({ summary: 'Rotate the ID-card QR token (lost/stolen card)' })
  async rotateQr(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.students.rotateQrToken(id, user);
  }

  // ── guardians ─────────────────────────────────────────────────────

  @Post(':id/guardians')
  @RequirePermissions('student.guardian.manage')
  @ApiOperation({ summary: 'Link an existing guardian to the student' })
  async linkGuardian(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkGuardianDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.guardians.link(id, dto, user);
  }

  @Put(':id/guardians/:guardianId')
  @RequirePermissions('student.guardian.manage')
  @ApiOperation({
    summary: 'Edit link attributes (relation/primary/emergency)',
  })
  async updateGuardianLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @Body() dto: UpdateGuardianLinkDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.guardians.updateLink(id, guardianId, dto, user);
  }

  @Delete(':id/guardians/:guardianId')
  @RequirePermissions('student.guardian.manage')
  async unlinkGuardian(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.guardians.unlink(id, guardianId, user);
  }

  // ── medical (restricted — roadmap M09 §6) ─────────────────────────

  @Get(':id/medical')
  @RequirePermissions('student.medical.view')
  async getMedical(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.students.getMedical(id, user.schoolId);
  }

  @Put(':id/medical')
  @RequirePermissions('student.medical.view', 'student.medical.update')
  async updateMedical(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMedicalInfoDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.students.updateMedical(id, dto, user);
  }

  // ── documents ─────────────────────────────────────────────────────

  @Get(':id/documents')
  @RequirePermissions('student.view')
  async listDocuments(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.documents.list(id, user.schoolId);
  }

  @Post(':id/documents')
  @RequirePermissions('student.document.manage')
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
    @Body() dto: UploadStudentDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.documents.upload(id, dto, file, user);
  }

  @Delete(':id/documents/:docId')
  @RequirePermissions('student.document.manage')
  async removeDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.documents.remove(id, docId, user);
    return { message: 'Document deleted' };
  }

  // ── portal account / ID card / history ────────────────────────────

  @Post(':id/create-account')
  @RequirePermissions('student.account.create')
  @ApiOperation({
    summary: 'Provision the student portal account (temp password issued)',
  })
  async createAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePortalAccountDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.accounts.createStudentAccount(id, dto, user);
  }

  @Post(':id/id-card')
  @RequirePermissions('student.idcard.generate')
  @SkipEnvelope()
  @ApiOperation({ summary: 'Single ID card PDF (CR80, QR from qr_token)' })
  async idCard(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { pdf, incomplete } = await this.idCards.generateSingle(id, user);
    this.setPdfHeaders(res, 'hexschool-id-card.pdf', incomplete.length);
    return new StreamableFile(pdf);
  }

  @Get(':id/attendance-history')
  @RequirePermissions('student.view')
  @ApiOperation({ summary: 'Attendance summary (fills with Module 12)' })
  async attendanceHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.students.attendanceHistory(id, user.schoolId);
  }

  @Get(':id/performance-history')
  @RequirePermissions('student.view')
  @ApiOperation({ summary: 'Results summary (fills with Module 15)' })
  async performanceHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.students.performanceHistory(id, user.schoolId);
  }

  private setPdfHeaders(
    res: Response,
    filename: string,
    incompleteCount: number,
  ): void {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Cards printed without a photo (placeholder used) — M09 §8.
    res.setHeader('X-Cards-Incomplete', String(incompleteCount));
  }
}
