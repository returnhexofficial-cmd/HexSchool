import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
  CloseStockCheckDto,
  LibraryReportQueryDto,
  MasterQueryDto,
  ScanStockDto,
  StartStockCheckDto,
} from '../dto';
import { LibraryClearanceService } from '../services/library-clearance.service';
import { LibraryExportService } from '../services/library-export.service';
import { LibraryReportsService } from '../services/library-reports.service';
import { StockVerificationService } from '../services/stock-verification.service';
import { streamFile } from './catalog.controller';

@ApiTags('library')
@ApiBearerAuth()
@Controller('library')
export class LibraryReportsController {
  constructor(
    private readonly reports: LibraryReportsService,
    private readonly exports: LibraryExportService,
    private readonly stock: StockVerificationService,
    private readonly clearance: LibraryClearanceService,
  ) {}

  // ── reports ─────────────────────────────────────────────────────────

  @Get('reports/summary')
  @RequirePermissions('library.view')
  @ApiOperation({
    summary: 'Desk figures for the window — loans, returns, money',
  })
  summary(
    @Query() query: LibraryReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const { from, to } = this.window(query);
    return this.reports.summary(user.schoolId, from, to);
  }

  @Get('reports/issued')
  @RequirePermissions('library.report')
  issued(@CurrentUser() user: AccessTokenPayload) {
    return this.reports.issued(user.schoolId);
  }

  @Get('reports/overdue')
  @RequirePermissions('library.report')
  overdue(@CurrentUser() user: AccessTokenPayload) {
    return this.reports.overdue(user.schoolId);
  }

  @Get('reports/popular')
  @RequirePermissions('library.report')
  popular(
    @Query() query: LibraryReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const { from, to } = this.window(query);
    return this.reports.popular(user.schoolId, from, to, query.limit ?? 20);
  }

  @Get('reports/stock')
  @RequirePermissions('library.report')
  stockReport(@CurrentUser() user: AccessTokenPayload) {
    return this.reports.stock(user.schoolId);
  }

  @Get('reports/member/:id')
  @RequirePermissions('library.report')
  memberReport(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.memberHistory(id, user.schoolId);
  }

  /**
   * The library half of a person's school clearance. M09 consults this
   * through the `LIBRARY_CLEARANCE` token rather than over HTTP; the
   * endpoint exists for the office's own screen and for M27.
   */
  @Get('clearance/:personType/:personId')
  @RequirePermissions('library.view')
  clearanceFor(
    @Param('personType') personType: 'STUDENT' | 'TEACHER' | 'STAFF',
    @Param('personId', ParseUUIDPipe) personId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.clearance.clearanceForPerson(
      user.schoolId,
      personType,
      personId,
    );
  }

  // ── exports ─────────────────────────────────────────────────────────

  @Get('reports/overdue.xlsx')
  @RequirePermissions('library.export')
  @SkipEnvelope()
  async overdueXlsx(
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return streamFile(res, await this.exports.overdueXlsx(user.schoolId));
  }

  @Get('reports/stock.xlsx')
  @RequirePermissions('library.export')
  @SkipEnvelope()
  async stockXlsx(
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return streamFile(res, await this.exports.stockXlsx(user.schoolId));
  }

  @Get('reports/popular.xlsx')
  @RequirePermissions('library.export')
  @SkipEnvelope()
  async popularXlsx(
    @Query() query: LibraryReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { from, to } = this.window(query);
    return streamFile(
      res,
      await this.exports.popularXlsx(
        user.schoolId,
        from,
        to,
        query.limit ?? 20,
      ),
    );
  }

  @Get('reports/member/:id.xlsx')
  @RequirePermissions('library.export')
  @SkipEnvelope()
  async memberXlsx(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return streamFile(
      res,
      await this.exports.memberHistoryXlsx(id, user.schoolId),
    );
  }

  // ── stock verification ──────────────────────────────────────────────

  @Get('stock-checks')
  @RequirePermissions('library.stock.verify')
  listStockChecks(
    @Query() query: MasterQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.stock.list(query.page, query.limit, user.schoolId);
  }

  @Post('stock-checks')
  @RequirePermissions('library.stock.verify')
  @ApiOperation({ summary: 'Open a physical count — one at a time per school' })
  startStockCheck(
    @Body() dto: StartStockCheckDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.stock.start(dto, user);
  }

  @Post('stock-checks/:id/scan')
  @RequirePermissions('library.stock.verify')
  @ApiOperation({
    summary:
      'Record a batch of scans — a code matching no copy is recorded, not rejected',
  })
  scan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScanStockDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.stock.scan(id, dto, user);
  }

  @Get('stock-checks/:id/diff')
  @RequirePermissions('library.stock.verify')
  stockDiff(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.stock.preview(id, user.schoolId);
  }

  @Post('stock-checks/:id/close')
  @RequirePermissions('library.stock.verify')
  closeStockCheck(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseStockCheckDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.stock.close(id, dto, user);
  }

  @Post('stock-checks/:id/cancel')
  @RequirePermissions('library.stock.verify')
  cancelStockCheck(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.stock.cancel(id, user);
  }

  /** Defaults to the last 30 days — the window every desk report uses. */
  private window(query: LibraryReportQueryDto): { from: Date; to: Date } {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - 30 * 86_400_000);
    return { from, to };
  }
}
