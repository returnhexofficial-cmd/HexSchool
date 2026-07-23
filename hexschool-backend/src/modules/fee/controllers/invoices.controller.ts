import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SkipEnvelope } from '../../../common/decorators/skip-envelope.decorator';
import { DEFAULT_SCHOOL_ID } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import {
  CancelInvoiceDto,
  CollectPaymentDto,
  GatewayCallbackDto,
  GenerateInvoicesDto,
  InitOnlinePaymentDto,
  InvoiceQueryDto,
  LedgerQueryDto,
  RecordPaymentDto,
  RefundPaymentDto,
} from '../dto';
import { CollectionService } from '../services/collection.service';
import { ExportFile, FeeExportService } from '../services/fee-export.service';
import { FeeSettingsService } from '../services/fee-settings.service';
import { InvoiceService } from '../services/invoice.service';
import { LedgerService } from '../services/ledger.service';
import { PaymentGatewayService } from '../services/payment-gateway.service';

@ApiTags('fees')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly collection: CollectionService,
    private readonly exports: FeeExportService,
    private readonly schools: SchoolsRepository,
    private readonly config: FeeSettingsService,
  ) {}

  @Get()
  @RequirePermissions('fee.view')
  @ApiOperation({ summary: 'Invoices (status / class / month filters)' })
  async list(
    @Query() query: InvoiceQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.invoices.list(query, user.schoolId);
  }

  @Get('summary')
  @RequirePermissions('fee.view')
  async summary(
    @Query('sessionId') sessionId: string | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.invoices.summary(user.schoolId, sessionId);
  }

  @Get(':id')
  @RequirePermissions('fee.view')
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.invoices.getDetail(id, user.schoolId);
  }

  @Get(':id/pdf')
  @RequirePermissions('fee.export')
  @SkipEnvelope()
  async invoicePdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const invoice = await this.invoices.getDetail(id, user.schoolId);
    const [school, config] = await Promise.all([
      this.schools.findByIdOrFail(user.schoolId),
      this.config.load(user.schoolId),
    ]);
    return send(
      res,
      await this.exports.invoicePdf(invoice, {
        schoolName: school.name,
        schoolAddress: school.address,
        footer: config.receiptFooter,
      }),
    );
  }

  @Post('generate')
  @RequirePermissions('fee.invoice.generate')
  @ApiOperation({
    summary:
      'Generate the monthly batch or an ad-hoc invoice (dryRun previews it)',
  })
  async generate(
    @Body() dto: GenerateInvoicesDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.invoices.generate(dto, user);
  }

  @Post(':id/cancel')
  @RequirePermissions('fee.invoice.cancel')
  @ApiOperation({ summary: 'Cancel an unpaid invoice with a reason' })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelInvoiceDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.invoices.cancel(id, dto, user);
  }

  @Get(':id/payments')
  @RequirePermissions('fee.view')
  async payments(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.collection.listForInvoice(id, user.schoolId);
  }

  @Post(':id/payments')
  @RequirePermissions('fee.collect')
  @ApiOperation({ summary: 'Record an offline payment against one invoice' })
  async pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.collection.recordPayment(id, dto, user);
  }
}

@ApiTags('fees')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly collection: CollectionService,
    private readonly gateways: PaymentGatewayService,
    private readonly exports: FeeExportService,
    private readonly schools: SchoolsRepository,
    private readonly config: FeeSettingsService,
  ) {}

  @Post('collect')
  @RequirePermissions('fee.collect')
  @ApiOperation({
    summary:
      'The collection desk: one amount across several invoices, oldest first',
  })
  async collect(
    @Body() dto: CollectPaymentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.collection.collect(dto, user);
  }

  @Get(':id')
  @RequirePermissions('fee.view')
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.collection.getPayment(id, user.schoolId);
  }

  @Get(':id/receipt.pdf')
  @RequirePermissions('fee.export')
  @SkipEnvelope()
  @ApiOperation({ summary: 'Receipt PDF (?layout=thermal for an 80 mm roll)' })
  async receipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('layout') layout: string | undefined,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const payment = await this.collection.getPayment(id, user.schoolId);
    const [school, config] = await Promise.all([
      this.schools.findByIdOrFail(user.schoolId),
      this.config.load(user.schoolId),
    ]);
    return send(
      res,
      await this.exports.receiptPdf(
        payment,
        {
          schoolName: school.name,
          schoolAddress: school.address,
          footer: config.receiptFooter,
        },
        layout === 'thermal' ? 'thermal' : 'a5',
      ),
    );
  }

  @Post(':id/refund')
  @RequirePermissions('fee.refund')
  @ApiOperation({ summary: 'Refund a payment, wholly or in part' })
  async refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.collection.refund(id, dto, user);
  }

  // ── online ──────────────────────────────────────────────────────────

  @Post('online/init')
  @RequirePermissions('fee.view')
  @ApiOperation({
    summary: 'Open a gateway checkout session for one or more invoices',
  })
  async init(
    @Body() dto: InitOnlinePaymentDto,
    @CurrentUser() user: AccessTokenPayload,
    @Req() req: Request,
  ) {
    const baseUrl = `${req.protocol}://${req.get('host')}/api/v1`;
    return this.gateways.initiate(dto, user, baseUrl);
  }

  /**
   * The gateway's callback / IPN. Public by necessity — the gateway
   * calls it, not a logged-in user — and therefore trusts nothing in the
   * body beyond which payment it concerns. `verify()` decides the rest.
   */
  @Public()
  @Post('callback/:gateway')
  @ApiOperation({ summary: 'Gateway callback (server-side verified)' })
  async callback(
    @Param('gateway') gateway: string,
    @Body() body: GatewayCallbackDto,
    @Query() query: Record<string, string>,
  ) {
    return this.gateways.handleCallback(
      gateway,
      // Gateways vary between POST bodies and GET query strings; hand
      // the adapter both and let it pick what it understands.
      { ...query, ...(body as unknown as Record<string, unknown>) },
      DEFAULT_SCHOOL_ID,
    );
  }

  @Post(':id/reconcile')
  @RequirePermissions('fee.collect')
  @ApiOperation({
    summary: 'Re-ask the gateway about a payment stuck at PENDING',
  })
  async reconcile(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.gateways.reconcile(id, user.schoolId);
  }
}

@ApiTags('fees')
@ApiBearerAuth()
@Controller('students')
export class StudentFeesController {
  constructor(private readonly ledger: LedgerService) {}

  @Get(':id/dues')
  @RequirePermissions('fee.view')
  @ApiOperation({ summary: 'Outstanding dues for a student' })
  async dues(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: LedgerQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const ledger = await this.ledger.studentLedger(
      id,
      user.schoolId,
      query.sessionId,
    );
    return {
      studentId: id,
      outstanding: ledger.outstanding,
      totalBilled: ledger.totalBilled,
      totalPaid: ledger.totalPaid,
    };
  }

  @Get(':id/ledger')
  @RequirePermissions('fee.view')
  @ApiOperation({ summary: 'Running money history with a balance column' })
  async ledgerFor(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: LedgerQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.ledger.studentLedger(id, user.schoolId, query.sessionId);
  }
}

function send(res: Response, file: ExportFile): StreamableFile {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  return new StreamableFile(file.buffer);
}
