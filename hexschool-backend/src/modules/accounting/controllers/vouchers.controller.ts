import {
  Body,
  Controller,
  Get,
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
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import {
  CancelVoucherDto,
  CreateVoucherDto,
  OpeningBalancesDto,
  SettlementDto,
  UpdateVoucherDto,
  VoucherQueryDto,
} from '../dto';
import { AccountingExportService } from '../services/accounting-export.service';
import { AccountingSettingsService } from '../services/accounting-settings.service';
import { AccountingToolsService } from '../services/accounting-tools.service';
import { VoucherService } from '../services/voucher.service';

@ApiTags('accounting')
@ApiBearerAuth()
@Controller('vouchers')
export class VouchersController {
  constructor(
    private readonly vouchers: VoucherService,
    private readonly tools: AccountingToolsService,
    private readonly exports: AccountingExportService,
    private readonly schools: SchoolsRepository,
    private readonly settings: AccountingSettingsService,
  ) {}

  @Get()
  @RequirePermissions('accounting.view')
  @ApiOperation({
    summary: 'List vouchers (date range, type, status, account)',
  })
  async list(
    @Query() query: VoucherQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const { rows, total, page, limit } = await this.vouchers.list(
      query,
      user.schoolId,
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

  @Get(':id')
  @RequirePermissions('accounting.view')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.vouchers.getDetail(id, user.schoolId);
  }

  @Post()
  @RequirePermissions('voucher.create')
  @ApiOperation({
    summary: 'Create a voucher (draft, or posted with `post: true`)',
  })
  async create(
    @Body() dto: CreateVoucherDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.vouchers.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('voucher.create')
  @ApiOperation({ summary: 'Edit a DRAFT voucher (a posted one is immutable)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVoucherDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.vouchers.update(id, dto, user);
  }

  @Post(':id/post')
  @RequirePermissions('voucher.post')
  @ApiOperation({ summary: 'Post a draft — validated again at this moment' })
  async post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.vouchers.post(id, user);
  }

  @Post(':id/cancel')
  @RequirePermissions('voucher.cancel')
  @ApiOperation({
    summary:
      'Cancel a voucher — a posted one writes a reversal, never a delete',
  })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelVoucherDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.vouchers.cancel(id, dto, user);
  }

  @Get(':id/print.pdf')
  @RequirePermissions('accounting.export')
  @SkipEnvelope()
  @ApiOperation({ summary: 'Printable voucher (A5 landscape)' })
  async print(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const [voucher, school, config] = await Promise.all([
      this.vouchers.getDetail(id, user.schoolId),
      this.schools.findByIdOrFail(user.schoolId),
      this.settings.load(user.schoolId),
    ]);
    const file = await this.exports.voucherPdf(voucher, {
      schoolName: school.name,
      schoolAddress: school.address ?? null,
      footer: config.reportFooter,
    });
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    return new StreamableFile(file.buffer);
  }

  // ── the two §8 tools ────────────────────────────────────────────────

  @Post('tools/settlement')
  @RequirePermissions('voucher.post')
  @ApiOperation({
    summary:
      'Record a gateway settlement: Dr bank (net) + Dr charges, Cr clearing (gross)',
  })
  async settlement(
    @Body() dto: SettlementDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.tools.settle(dto, user);
  }

  @Post('tools/opening-balances')
  @RequirePermissions('voucher.post')
  @ApiOperation({
    summary:
      'Opening-balance journal for a mid-year adoption (balances through equity)',
  })
  async openingBalances(
    @Body() dto: OpeningBalancesDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.tools.openingBalances(dto, user);
  }
}
