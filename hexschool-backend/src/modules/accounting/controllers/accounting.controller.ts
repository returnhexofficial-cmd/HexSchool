import {
  Body,
  Controller,
  Get,
  Put,
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
import { AccountingReportQueryDto, UpdatePostingMapDto } from '../dto';
import {
  AccountingExportService,
  ExportFile,
  ReportContext,
} from '../services/accounting-export.service';
import { AccountingReportsService } from '../services/accounting-reports.service';
import { AccountingSettingsService } from '../services/accounting-settings.service';
import { PostingMapService } from '../services/posting-map.service';

@ApiTags('accounting')
@ApiBearerAuth()
@Controller('accounting')
export class AccountingController {
  constructor(
    private readonly reports: AccountingReportsService,
    private readonly map: PostingMapService,
    private readonly exports: AccountingExportService,
    private readonly schools: SchoolsRepository,
    private readonly settings: AccountingSettingsService,
  ) {}

  // ── posting map ─────────────────────────────────────────────────────

  @Get('posting-map')
  @RequirePermissions('accounting.view')
  @ApiOperation({
    summary: 'Fee head → income account, method → funds account',
  })
  async postingMap(@CurrentUser() user: AccessTokenPayload) {
    return this.map.list(user.schoolId);
  }

  @Put('posting-map')
  @RequirePermissions('accounting.posting-map.manage')
  async updatePostingMap(
    @Body() dto: UpdatePostingMapDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.map.update(dto, user);
  }

  // ── reports (JSON) ──────────────────────────────────────────────────

  @Get('reports/cash-book')
  @RequirePermissions('accounting.report')
  async cashBook(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.cashBook(query, user.schoolId);
  }

  @Get('reports/bank-book')
  @RequirePermissions('accounting.report')
  async bankBook(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.bankBook(query, user.schoolId);
  }

  @Get('reports/ledger')
  @RequirePermissions('accounting.report')
  @ApiOperation({ summary: 'General ledger for one account, running balance' })
  async ledger(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.ledger(query, user.schoolId);
  }

  @Get('reports/trial-balance')
  @RequirePermissions('accounting.report')
  async trialBalance(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.trialBalance(query, user.schoolId);
  }

  @Get('reports/income-statement')
  @RequirePermissions('accounting.report')
  async incomeStatement(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.incomeStatement(query, user.schoolId);
  }

  @Get('reports/balance-sheet')
  @RequirePermissions('accounting.report')
  async balanceSheet(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.balanceSheet(query, user.schoolId);
  }

  @Get('reports/receipts-payments')
  @RequirePermissions('accounting.report')
  async receiptsPayments(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.receiptsPayments(query, user.schoolId);
  }

  @Get('reports/budget-vs-actual')
  @RequirePermissions('accounting.report')
  async budgetVsActual(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.budgetVsActual(query, user.schoolId);
  }

  // ── reports (files) ─────────────────────────────────────────────────

  @Get('reports/cash-book.xlsx')
  @RequirePermissions('accounting.export')
  @SkipEnvelope()
  async cashBookXlsx(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.cashBook(query, user.schoolId);
    return send(res, await this.exports.bookXlsx(report, 'Cash book'));
  }

  @Get('reports/bank-book.xlsx')
  @RequirePermissions('accounting.export')
  @SkipEnvelope()
  async bankBookXlsx(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.bankBook(query, user.schoolId);
    return send(res, await this.exports.bookXlsx(report, 'Bank book'));
  }

  @Get('reports/ledger.xlsx')
  @RequirePermissions('accounting.export')
  @SkipEnvelope()
  async ledgerXlsx(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.ledger(query, user.schoolId);
    return send(res, await this.exports.ledgerXlsx(report));
  }

  @Get('reports/trial-balance.xlsx')
  @RequirePermissions('accounting.export')
  @SkipEnvelope()
  async trialBalanceXlsx(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.trialBalance(query, user.schoolId);
    return send(res, await this.exports.trialBalanceXlsx(report));
  }

  @Get('reports/income-statement.xlsx')
  @RequirePermissions('accounting.export')
  @SkipEnvelope()
  async incomeStatementXlsx(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.incomeStatement(query, user.schoolId);
    return send(res, await this.exports.incomeStatementXlsx(report));
  }

  @Get('reports/balance-sheet.xlsx')
  @RequirePermissions('accounting.export')
  @SkipEnvelope()
  async balanceSheetXlsx(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.balanceSheet(query, user.schoolId);
    return send(res, await this.exports.balanceSheetXlsx(report));
  }

  @Get('reports/receipts-payments.xlsx')
  @RequirePermissions('accounting.export')
  @SkipEnvelope()
  async receiptsPaymentsXlsx(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.receiptsPayments(query, user.schoolId);
    return send(res, await this.exports.receiptsPaymentsXlsx(report));
  }

  @Get('reports/budget-vs-actual.xlsx')
  @RequirePermissions('accounting.export')
  @SkipEnvelope()
  async budgetVsActualXlsx(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.budgetVsActual(query, user.schoolId);
    return send(res, await this.exports.budgetVarianceXlsx(report));
  }

  // ── statement PDFs ──────────────────────────────────────────────────

  @Get('reports/trial-balance.pdf')
  @RequirePermissions('accounting.export')
  @SkipEnvelope()
  async trialBalancePdf(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.trialBalance(query, user.schoolId);
    const context = await this.context(user.schoolId);
    return send(
      res,
      await this.exports.statementPdf({
        title: 'Trial Balance',
        subtitle: `${report.from} → ${report.to}`,
        context,
        sections: [
          {
            heading: 'Debit balances',
            rows: report.rows
              .filter((row) => row.debit > 0)
              .map(
                (row) =>
                  [`${row.code} ${row.name}`, row.debit] as [string, number],
              ),
            total: ['Total debits', report.debitTotal],
          },
          {
            heading: 'Credit balances',
            rows: report.rows
              .filter((row) => row.credit > 0)
              .map(
                (row) =>
                  [`${row.code} ${row.name}`, row.credit] as [string, number],
              ),
            total: ['Total credits', report.creditTotal],
          },
        ],
        note: report.balanced
          ? undefined
          : `OUT OF BALANCE by ${report.difference.toFixed(2)}`,
      }),
    );
  }

  @Get('reports/income-statement.pdf')
  @RequirePermissions('accounting.export')
  @SkipEnvelope()
  async incomeStatementPdf(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.incomeStatement(query, user.schoolId);
    const context = await this.context(user.schoolId);
    return send(
      res,
      await this.exports.statementPdf({
        title: 'Income & Expenditure',
        subtitle: `${report.from} → ${report.to}`,
        context,
        sections: [
          {
            heading: 'Income',
            rows: report.income.map(
              (line) =>
                [`${line.code} ${line.name}`, line.amount] as [string, number],
            ),
            total: ['Total income', report.incomeTotal],
          },
          {
            heading: 'Expenditure',
            rows: report.expense.map(
              (line) =>
                [`${line.code} ${line.name}`, line.amount] as [string, number],
            ),
            total: ['Total expenditure', report.expenseTotal],
          },
        ],
        note: `${report.surplus >= 0 ? 'Surplus' : 'Deficit'} for the period: ${Math.abs(report.surplus).toFixed(2)}`,
      }),
    );
  }

  @Get('reports/balance-sheet.pdf')
  @RequirePermissions('accounting.export')
  @SkipEnvelope()
  async balanceSheetPdf(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.balanceSheet(query, user.schoolId);
    const context = await this.context(user.schoolId);
    return send(
      res,
      await this.exports.statementPdf({
        title: 'Balance Sheet',
        subtitle: `as at ${report.to}`,
        context,
        sections: [
          {
            heading: 'Assets',
            rows: report.assets.map(
              (line) =>
                [`${line.code} ${line.name}`, line.amount] as [string, number],
            ),
            total: ['Total assets', report.assetTotal],
          },
          {
            heading: 'Liabilities',
            rows: report.liabilities.map(
              (line) =>
                [`${line.code} ${line.name}`, line.amount] as [string, number],
            ),
            total: ['Total liabilities', report.liabilityTotal],
          },
          {
            heading: 'Equity & fund',
            rows: [
              ...report.equity.map(
                (line) =>
                  [`${line.code} ${line.name}`, line.amount] as [
                    string,
                    number,
                  ],
              ),
              ['Surplus for the period', report.surplus] as [string, number],
            ],
            total: ['Total equity & liabilities', report.fundedTotal],
          },
        ],
        note: report.balanced
          ? undefined
          : `OUT OF BALANCE by ${report.difference.toFixed(2)}`,
      }),
    );
  }

  @Get('reports/receipts-payments.pdf')
  @RequirePermissions('accounting.export')
  @SkipEnvelope()
  async receiptsPaymentsPdf(
    @Query() query: AccountingReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.receiptsPayments(query, user.schoolId);
    const context = await this.context(user.schoolId);
    return send(
      res,
      await this.exports.statementPdf({
        title: 'Receipts & Payments',
        subtitle: `${report.from} → ${report.to}`,
        context,
        sections: [
          {
            heading: 'Receipts',
            rows: [
              ['Opening cash & bank', report.openingCash] as [string, number],
              ...report.receipts.map(
                (line) =>
                  [`${line.code} ${line.name}`, line.amount] as [
                    string,
                    number,
                  ],
              ),
            ],
            total: ['Total receipts', report.receiptTotal],
          },
          {
            heading: 'Payments',
            rows: report.payments.map(
              (line) =>
                [`${line.code} ${line.name}`, line.amount] as [string, number],
            ),
            total: ['Total payments', report.paymentTotal],
          },
        ],
        note: `Closing cash & bank: ${report.closingCash.toFixed(2)}`,
      }),
    );
  }

  private async context(schoolId: string): Promise<ReportContext> {
    const [school, config] = await Promise.all([
      this.schools.findByIdOrFail(schoolId),
      this.settings.load(schoolId),
    ]);
    return {
      schoolName: school.name,
      schoolAddress: school.address ?? null,
      footer: config.reportFooter,
    };
  }
}

function send(res: Response, file: ExportFile): StreamableFile {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.filename}"`,
  );
  return new StreamableFile(file.buffer);
}
