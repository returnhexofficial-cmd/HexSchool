import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { CollectionReportQueryDto, ExpenseReportQueryDto } from '../dto';
import {
  TransportExportService,
  type ExportFile,
} from '../services/transport-export.service';
import { TransportReportsService } from '../services/transport-reports.service';

/** Same download contract as the M15/M18/M22/M23 export routes. */
function streamFile(res: Response, file: ExportFile): StreamableFile {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.filename}"`,
  );
  return new StreamableFile(file.buffer);
}

@ApiTags('transport')
@ApiBearerAuth()
@Controller('transport/reports')
export class TransportReportsController {
  constructor(
    private readonly reports: TransportReportsService,
    private readonly exports: TransportExportService,
  ) {}

  @Get('roster/:routeId')
  @RequirePermissions('transport.report')
  @ApiOperation({
    summary: 'The driver’s sheet: riders per stop with guardian phones',
  })
  roster(
    @Param('routeId', ParseUUIDPipe) routeId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.roster(routeId, user.schoolId);
  }

  @Get('roster/:routeId/export')
  @RequirePermissions('transport.export')
  @SkipEnvelope()
  async rosterXlsx(
    @Param('routeId', ParseUUIDPipe) routeId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.rosterXlsx(routeId, user.schoolId),
    );
  }

  @Get('roster/:routeId/print')
  @RequirePermissions('transport.export')
  @SkipEnvelope()
  async rosterPdf(
    @Param('routeId', ParseUUIDPipe) routeId: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.rosterPdf(routeId, user.schoolId),
    );
  }

  @Get('expenses')
  @RequirePermissions('transport.report')
  @ApiOperation({
    summary: 'Spend by type, by vehicle and by month, with cost/km',
  })
  expenses(
    @Query() query: ExpenseReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.expenseSummary(user.schoolId, query);
  }

  @Get('expenses/export')
  @RequirePermissions('transport.export')
  @SkipEnvelope()
  async expensesXlsx(
    @Query() query: ExpenseReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.expensesXlsx(user.schoolId, query),
    );
  }

  @Get('utilization')
  @RequirePermissions('transport.report')
  @ApiOperation({ summary: 'Seats against riders, per route and fleet-wide' })
  utilization(@CurrentUser() user: AccessTokenPayload) {
    return this.reports.utilization(user.schoolId);
  }

  @Get('utilization/export')
  @RequirePermissions('transport.export')
  @SkipEnvelope()
  async utilizationXlsx(
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(res, await this.exports.utilizationXlsx(user.schoolId));
  }

  @Get('collection')
  @RequirePermissions('transport.report')
  @ApiOperation({ summary: 'Transport fees expected, invoiced and collected' })
  collection(
    @Query() query: CollectionReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.collection(user.schoolId, query.month);
  }

  @Get('collection/export')
  @RequirePermissions('transport.export')
  @SkipEnvelope()
  async collectionXlsx(
    @Query() query: CollectionReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.collectionXlsx(user.schoolId, query.month),
    );
  }
}
