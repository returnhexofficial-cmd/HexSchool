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
import {
  InventoryReportQueryDto,
  ItemLedgerQueryDto,
  WarrantyReportQueryDto,
} from '../dto';
import {
  InventoryExportService,
  type ExportFile,
} from '../services/inventory-export.service';
import { InventoryReportsService } from '../services/inventory-reports.service';

/** Same download contract as the M15/M18/M22/M23/M25 export routes. */
function streamFile(res: Response, file: ExportFile): StreamableFile {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.filename}"`,
  );
  return new StreamableFile(file.buffer);
}

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/reports')
export class InventoryReportsController {
  constructor(
    private readonly reports: InventoryReportsService,
    private readonly exports: InventoryExportService,
  ) {}

  @Get('stock')
  @RequirePermissions('inventory.report')
  @ApiOperation({
    summary: 'Current balance per item, valued at the last price paid',
  })
  stock(
    @Query() query: InventoryReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.stockValuation(user.schoolId, query);
  }

  @Get('stock/export')
  @RequirePermissions('inventory.export')
  @SkipEnvelope()
  async stockXlsx(
    @Query() query: InventoryReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(res, await this.exports.stockXlsx(user.schoolId, query));
  }

  @Get('low-stock')
  @RequirePermissions('inventory.report')
  @ApiOperation({ summary: 'Items at or below their reorder level' })
  lowStock(@CurrentUser() user: AccessTokenPayload) {
    return this.reports.lowStock(user.schoolId);
  }

  @Get('ledger/:itemId')
  @RequirePermissions('inventory.report')
  @ApiOperation({ summary: 'Every movement of one item, oldest first' })
  itemLedger(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Query() query: ItemLedgerQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.itemLedger(user.schoolId, itemId, query);
  }

  @Get('ledger/:itemId/export')
  @RequirePermissions('inventory.export')
  @SkipEnvelope()
  async itemLedgerXlsx(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Query() query: ItemLedgerQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.itemLedgerXlsx(user.schoolId, itemId, query),
    );
  }

  @Get('purchases')
  @RequirePermissions('inventory.report')
  @ApiOperation({ summary: 'Received deliveries by supplier and month' })
  purchases(
    @Query() query: InventoryReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.purchaseSummary(user.schoolId, query);
  }

  @Get('purchases/export')
  @RequirePermissions('inventory.export')
  @SkipEnvelope()
  async purchasesXlsx(
    @Query() query: InventoryReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.purchasesXlsx(user.schoolId, query),
    );
  }

  @Get('assets')
  @RequirePermissions('inventory.report')
  @ApiOperation({
    summary: 'The asset register by location, custodian and status',
  })
  assets(
    @Query() query: InventoryReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.assetRegister(user.schoolId, query);
  }

  @Get('assets/export')
  @RequirePermissions('inventory.export')
  @SkipEnvelope()
  async assetsXlsx(
    @Query() query: InventoryReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(res, await this.exports.assetsXlsx(user.schoolId, query));
  }

  /** The sheet somebody carries around a building with a pen. */
  @Get('assets/export/pdf')
  @RequirePermissions('inventory.export')
  @SkipEnvelope()
  async assetsPdf(
    @Query() query: InventoryReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(res, await this.exports.assetsPdf(user.schoolId, query));
  }

  @Get('warranty')
  @RequirePermissions('inventory.report')
  @ApiOperation({
    summary: 'Warranties lapsed, lapsing, or never recorded at all',
  })
  warranty(
    @Query() query: WarrantyReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.warranty(user.schoolId, query.days);
  }

  @Get('warranty/export')
  @RequirePermissions('inventory.export')
  @SkipEnvelope()
  async warrantyXlsx(
    @Query() query: WarrantyReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.warrantyXlsx(user.schoolId, query.days),
    );
  }

  @Get('consumption')
  @RequirePermissions('inventory.report')
  @ApiOperation({
    summary: 'What each department consumed over a window, net of returns',
  })
  consumption(
    @Query() query: InventoryReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.consumption(user.schoolId, query);
  }

  @Get('consumption/export')
  @RequirePermissions('inventory.export')
  @SkipEnvelope()
  async consumptionXlsx(
    @Query() query: InventoryReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.consumptionXlsx(user.schoolId, query),
    );
  }
}
