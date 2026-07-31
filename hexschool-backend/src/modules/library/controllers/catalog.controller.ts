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
  BookQueryDto,
  CopyQueryDto,
  CreateBookDto,
  GenerateCopiesDto,
  LabelSheetDto,
  MarkCopyDto,
  MasterQueryDto,
  UpdateBookDto,
  UpdateCopyDto,
  UpsertAuthorDto,
  UpsertCategoryDto,
  UpsertPublisherDto,
} from '../dto';
import { BookCopiesService } from '../services/book-copies.service';
import { CatalogService } from '../services/catalog.service';
import {
  LibraryExportService,
  type ExportFile,
} from '../services/library-export.service';

/** Same download contract as the M15/M18/M22 export routes. */
export function streamFile(res: Response, file: ExportFile): StreamableFile {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.filename}"`,
  );
  return new StreamableFile(file.buffer);
}

@ApiTags('library')
@ApiBearerAuth()
@Controller('library')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly copies: BookCopiesService,
    private readonly exports: LibraryExportService,
  ) {}

  // ── masters ─────────────────────────────────────────────────────────

  @Get('categories')
  @RequirePermissions('library.view')
  listCategories(
    @Query() query: MasterQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.listCategories(query, user);
  }

  @Post('categories')
  @RequirePermissions('library.catalog.manage')
  createCategory(
    @Body() dto: UpsertCategoryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.createCategory(dto, user);
  }

  @Patch('categories/:id')
  @RequirePermissions('library.catalog.manage')
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertCategoryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.updateCategory(id, dto, user);
  }

  @Delete('categories/:id')
  @RequirePermissions('library.catalog.manage')
  @HttpCode(204)
  async removeCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.catalog.removeCategory(id, user);
  }

  @Get('authors')
  @RequirePermissions('library.view')
  listAuthors(
    @Query() query: MasterQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.listAuthors(query, user);
  }

  @Post('authors')
  @RequirePermissions('library.catalog.manage')
  createAuthor(
    @Body() dto: UpsertAuthorDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.createAuthor(dto, user);
  }

  @Patch('authors/:id')
  @RequirePermissions('library.catalog.manage')
  updateAuthor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertAuthorDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.updateAuthor(id, dto, user);
  }

  @Delete('authors/:id')
  @RequirePermissions('library.catalog.manage')
  @HttpCode(204)
  async removeAuthor(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.catalog.removeAuthor(id, user);
  }

  @Get('publishers')
  @RequirePermissions('library.view')
  listPublishers(
    @Query() query: MasterQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.listPublishers(query, user);
  }

  @Post('publishers')
  @RequirePermissions('library.catalog.manage')
  createPublisher(
    @Body() dto: UpsertPublisherDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.createPublisher(dto, user);
  }

  @Patch('publishers/:id')
  @RequirePermissions('library.catalog.manage')
  updatePublisher(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertPublisherDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.updatePublisher(id, dto, user);
  }

  @Delete('publishers/:id')
  @RequirePermissions('library.catalog.manage')
  @HttpCode(204)
  async removePublisher(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.catalog.removePublisher(id, user);
  }

  // ── copies (before `books/:id`, or the router eats the literal) ──────

  @Get('copies')
  @RequirePermissions('library.view')
  listCopies(
    @Query() query: CopyQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.copies.list(query, user);
  }

  @Get('copies/status-totals')
  @RequirePermissions('library.view')
  copyTotals(@CurrentUser() user: AccessTokenPayload) {
    return this.copies.statusTotals(user.schoolId);
  }

  @Get('copies/by-accession/:accessionNo')
  @RequirePermissions('library.view')
  @ApiOperation({
    summary:
      'The desk scan lookup — the copy plus its open loan, if it has one',
  })
  byAccession(
    @Param('accessionNo') accessionNo: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.copies.byAccession(accessionNo, user.schoolId);
  }

  @Post('copies/labels')
  @RequirePermissions('library.export')
  @SkipEnvelope()
  @ApiOperation({ summary: 'A4 sheet of Code 128 spine labels' })
  async labels(
    @Body() dto: LabelSheetDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return streamFile(
      res,
      await this.exports.labelSheet(dto.copyIds, user.schoolId),
    );
  }

  @Get('copies/:id')
  @RequirePermissions('library.view')
  copyDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.copies.getDetail(id, user.schoolId);
  }

  @Patch('copies/:id')
  @RequirePermissions('library.copy.manage')
  updateCopy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCopyDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.copies.update(id, dto, user);
  }

  @Post('copies/:id/mark')
  @RequirePermissions('library.copy.manage')
  @ApiOperation({
    summary:
      'Write a copy off as LOST/DAMAGED/WITHDRAWN — closes its open loan and charges the borrower',
  })
  markCopy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkCopyDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.copies.mark(id, dto, user);
  }

  @Delete('copies/:id')
  @RequirePermissions('library.copy.manage')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Delete a mis-entered copy — refused once it has ever been on loan',
  })
  async removeCopy(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.copies.remove(id, user);
  }

  // ── books ───────────────────────────────────────────────────────────

  @Get('books')
  @RequirePermissions('library.view')
  listBooks(
    @Query() query: BookQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.listWithMeta(this.catalog.listBooks(query, user));
  }

  @Get('books/:id')
  @RequirePermissions('library.view')
  bookDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.getBook(id, user.schoolId);
  }

  @Post('books')
  @RequirePermissions('library.catalog.manage')
  createBook(
    @Body() dto: CreateBookDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.createBook(dto, user);
  }

  @Patch('books/:id')
  @RequirePermissions('library.catalog.manage')
  updateBook(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBookDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.updateBook(id, dto, user);
  }

  @Delete('books/:id')
  @RequirePermissions('library.catalog.manage')
  @HttpCode(204)
  async removeBook(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.catalog.removeBook(id, user);
  }

  @Post('books/:id/copies')
  @RequirePermissions('library.copy.manage')
  @ApiOperation({
    summary: 'Bulk-generate N copies with sequential accession numbers',
  })
  generateCopies(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateCopiesDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.copies.generate(id, dto, user);
  }

  private async listWithMeta<T>(
    promise: Promise<{ rows: T[]; total: number; page: number; limit: number }>,
  ) {
    const { rows, total, page, limit } = await promise;
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
}
