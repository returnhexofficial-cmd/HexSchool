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
  CheckNidQueryDto,
  CreateStaffDto,
  StaffQueryDto,
  UpdateStaffDto,
  UpdateStaffStatusDto,
  UploadStaffDocumentDto,
} from '../dto';
import { StaffDocumentsService } from '../services/staff-documents.service';
import { StaffService } from '../services/staff.service';

const FILE_BODY_SCHEMA = {
  schema: {
    type: 'object',
    properties: { file: { type: 'string', format: 'binary' } },
  },
};

@ApiTags('staff')
@ApiBearerAuth()
@Controller('staff')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly documents: StaffDocumentsService,
  ) {}

  @Get()
  @RequirePermissions('staff.view')
  @ApiOperation({
    summary: 'Staff list (filter: designation/department/status)',
  })
  async list(
    @Query() query: StaffQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.staff.list(query, user.schoolId);
  }

  /** Declared before :id so "check-nid" never hits the UUID pipe. */
  @Get('check-nid')
  @RequirePermissions('staff.view')
  @ApiOperation({ summary: 'Duplicate-NID soft check (warn, never block)' })
  async checkNid(
    @Query() query: CheckNidQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return {
      exists: await this.staff.nidExists(
        query.nid,
        user.schoolId,
        query.excludeId,
      ),
    };
  }

  @Get(':id')
  @RequirePermissions('staff.view')
  @ApiOperation({
    summary: 'Staff detail (profile + account + signed photo URL)',
  })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.staff.getDetail(id, user.schoolId);
  }

  @Post()
  @RequirePermissions('staff.create')
  @ApiOperation({
    summary:
      'Create staff (+ user account with temp password, gap-free employee ID)',
  })
  async create(
    @Body() dto: CreateStaffDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.staff.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('staff.update')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.staff.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('staff.delete')
  @ApiOperation({
    summary:
      'Soft-delete staff (account deactivated; employee ID stays burned)',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.staff.remove(id, user);
    return { message: 'Staff member deleted' };
  }

  @Put(':id/status')
  @RequirePermissions('staff.status')
  @ApiOperation({
    summary:
      'Status transition with reason (RESIGNED/TERMINATED deactivates the account)',
  })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffStatusDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.staff.updateStatus(id, dto, user);
  }

  @Post(':id/photo')
  @RequirePermissions('staff.update')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY_SCHEMA)
  @ApiOperation({
    summary: 'Upload staff photo (≤2 MB, normalized to 512px PNG)',
  })
  async uploadPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.staff.uploadPhoto(id, file, user);
  }

  // ── documents ─────────────────────────────────────────────────────

  @Get(':id/documents')
  @RequirePermissions('staff.view')
  async listDocuments(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.documents.list(id, user.schoolId);
  }

  @Post(':id/documents')
  @RequirePermissions('staff.document.manage')
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
  @ApiOperation({ summary: 'Upload staff document (PDF/JPG/PNG, ≤10 MB)' })
  async uploadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadStaffDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.documents.upload(id, dto, file, user);
  }

  @Delete(':id/documents/:docId')
  @RequirePermissions('staff.document.manage')
  async removeDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.documents.remove(id, docId, user);
    return { message: 'Document deleted' };
  }
}
