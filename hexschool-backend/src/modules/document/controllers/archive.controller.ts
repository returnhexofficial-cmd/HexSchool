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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  ArchiveFileQueryDto,
  UpdateFileDto,
  UpsertFileDto,
  UpsertFolderDto,
} from '../dto';
import { ArchiveService } from '../services/archive.service';

/** Roadmap §4's `CRUD /api/v1/archive/folders|files`. */
@ApiTags('archive')
@ApiBearerAuth()
@Controller('archive')
export class ArchiveController {
  constructor(private readonly archive: ArchiveService) {}

  // ── folders ─────────────────────────────────────────────────────────

  @Get('folders')
  @RequirePermissions('archive.view')
  @ApiOperation({ summary: 'The whole folder tree with file counts' })
  tree(@CurrentUser() user: AccessTokenPayload) {
    return this.archive.tree(user);
  }

  @Post('folders')
  @RequirePermissions('archive.manage')
  createFolder(
    @Body() dto: UpsertFolderDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.archive.createFolder(dto, user);
  }

  @Put('folders/:id')
  @RequirePermissions('archive.manage')
  updateFolder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertFolderDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.archive.updateFolder(id, dto, user);
  }

  @Delete('folders/:id')
  @RequirePermissions('archive.manage')
  @HttpCode(204)
  async removeFolder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.archive.removeFolder(id, user);
  }

  // ── files ───────────────────────────────────────────────────────────

  @Get('tags')
  @RequirePermissions('archive.view')
  @ApiOperation({ summary: 'Every tag in use, with counts — the filter chips' })
  tags(@CurrentUser() user: AccessTokenPayload) {
    return this.archive.tags(user);
  }

  @Get('files')
  @RequirePermissions('archive.view')
  @ApiOperation({ summary: 'Filed documents, filtered by folder, tag or link' })
  listFiles(
    @Query() query: ArchiveFileQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.archive.listFiles(query, user);
  }

  @Get('files/:id')
  @RequirePermissions('archive.view')
  getFile(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.archive.getFile(id, user);
  }

  /** A fresh signed URL per read — the M04 logo convention. */
  @Get('files/:id/download')
  @RequirePermissions('archive.view')
  async downloadUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return { url: await this.archive.downloadUrl(id, user) };
  }

  @Post('files')
  @RequirePermissions('archive.upload')
  createFile(
    @Body() dto: UpsertFileDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.archive.createFile(dto, user);
  }

  @Patch('files/:id')
  @RequirePermissions('archive.upload')
  updateFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFileDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.archive.updateFile(id, dto, user);
  }

  @Delete('files/:id')
  @RequirePermissions('archive.delete')
  @HttpCode(204)
  async removeFile(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.archive.removeFile(id, user);
  }
}
