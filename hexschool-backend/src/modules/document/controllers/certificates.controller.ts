import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CertificateType } from '../../../common/constants';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SkipEnvelope } from '../../../common/decorators/skip-envelope.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  BulkPrizeDto,
  CertificateQueryDto,
  ClearanceQueryDto,
  CreateCertificateDto,
  LegacyCertificateDto,
  PreviewTemplateDto,
  RegisterReportQueryDto,
  ReissueCertificateDto,
  RevokeCertificateDto,
  TemplateQueryDto,
  UpsertTemplateDto,
} from '../dto';
import {
  CertificateExportService,
  type ExportFile,
} from '../services/certificate-export.service';
import { CertificatePdfService } from '../services/certificate-pdf.service';
import { CertificateReportsService } from '../services/certificate-reports.service';
import { CertificateTemplatesService } from '../services/certificate-templates.service';
import { CertificatesService } from '../services/certificates.service';
import { PrizeWizardService } from '../services/prize-wizard.service';

function streamFile(res: Response, file: ExportFile): StreamableFile {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.filename}"`,
  );
  return new StreamableFile(file.buffer);
}

/** Roadmap §4's `CRUD /api/v1/certificate-templates (+ /:id/preview)`. */
@ApiTags('certificates')
@ApiBearerAuth()
@Controller('certificate-templates')
export class CertificateTemplatesController {
  constructor(private readonly templates: CertificateTemplatesService) {}

  @Get('variables')
  @RequirePermissions('certificate.view')
  @ApiOperation({ summary: 'The variable palette a template may reference' })
  variables() {
    return { variables: this.templates.variables() };
  }

  @Get()
  @RequirePermissions('certificate.view')
  list(
    @Query() query: TemplateQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.templates.list(query, user);
  }

  @Get(':id')
  @RequirePermissions('certificate.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.templates.get(id, user);
  }

  @Post()
  @RequirePermissions('certificate.template.manage')
  create(
    @Body() dto: UpsertTemplateDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.templates.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('certificate.template.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertTemplateDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.templates.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('certificate.template.manage')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.templates.remove(id, user);
  }

  /**
   * POST rather than GET: the designer previews **unsaved** editor content,
   * so the body carries markup that has no id yet and is far too long for
   * a query string.
   */
  @Post(':id/preview')
  @RequirePermissions('certificate.view')
  @ApiOperation({
    summary: 'Render a template against a student or a specimen',
  })
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PreviewTemplateDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.templates.preview(id, dto, user);
  }

  /** Preview before the template has ever been saved. */
  @Post('preview')
  @RequirePermissions('certificate.view')
  previewDraft(
    @Body() dto: PreviewTemplateDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.templates.preview(null, dto, user);
  }
}

/** Roadmap §4's certificate endpoints and the issuance register. */
@ApiTags('certificates')
@ApiBearerAuth()
@Controller('certificates')
export class CertificatesController {
  constructor(
    private readonly certificates: CertificatesService,
    private readonly pdf: CertificatePdfService,
    private readonly prizes: PrizeWizardService,
    private readonly reports: CertificateReportsService,
    private readonly exports: CertificateExportService,
  ) {}

  // ── reports come before `:id`, or the router eats them ──────────────

  @Get('reports/register')
  @RequirePermissions('certificate.export')
  @ApiOperation({ summary: 'Everything issued over a window' })
  register(
    @Query() query: RegisterReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.register(query, user.schoolId);
  }

  @Get('reports/register/export')
  @RequirePermissions('certificate.export')
  @SkipEnvelope()
  async registerXlsx(
    @Query() query: RegisterReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.registerXlsx(query, user.schoolId),
    );
  }

  @Get('reports/register/pdf')
  @RequirePermissions('certificate.export')
  @SkipEnvelope()
  async registerPdf(
    @Query() query: RegisterReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.registerPdf(query, user.schoolId),
    );
  }

  @Get('reports/summary')
  @RequirePermissions('certificate.export')
  summary(
    @Query() query: RegisterReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.summary(query, user.schoolId);
  }

  @Get('reports/summary/export')
  @RequirePermissions('certificate.export')
  @SkipEnvelope()
  async summaryXlsx(
    @Query() query: RegisterReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.summaryXlsx(query, user.schoolId),
    );
  }

  /** The wizard's clearance panel, before anything is written. */
  @Get('clearance')
  @RequirePermissions('certificate.view')
  @ApiOperation({ summary: 'Fee, library and hostel clearance for a student' })
  clearance(
    @Query() query: ClearanceQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.certificates.checkClearance(
      query.studentId,
      query.type ?? CertificateType.TRANSFER,
      user,
    );
  }

  // ── register ────────────────────────────────────────────────────────

  @Get()
  @RequirePermissions('certificate.view')
  @ApiOperation({ summary: 'The issuance register' })
  list(
    @Query() query: CertificateQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.certificates.list(query, user);
  }

  @Get(':id')
  @RequirePermissions('certificate.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.certificates.get(id, user);
  }

  /**
   * Re-rendered on demand from the certificate's own frozen columns, so a
   * missing S3 object is a re-render rather than a loss.
   */
  @Get(':id/pdf')
  @RequirePermissions('certificate.view')
  @SkipEnvelope()
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const certificate = await this.certificates.get(id, user);
    const pdf = await this.pdf.render(certificate, user.schoolId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${certificate.certificateNo ?? 'certificate'}.pdf"`,
    );
    return new StreamableFile(pdf);
  }

  // ── writes ──────────────────────────────────────────────────────────

  @Post()
  @RequirePermissions('certificate.issue')
  @ApiOperation({ summary: 'Create a draft, or issue in one step' })
  create(
    @Body() dto: CreateCertificateDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.certificates.create(dto, user);
  }

  @Post(':id/issue')
  @RequirePermissions('certificate.issue')
  @ApiOperation({ summary: 'Issue a saved draft' })
  issue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCertificateDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.certificates.issueDraft(id, dto, user);
  }

  @Post(':id/reissue')
  @RequirePermissions('certificate.issue')
  @ApiOperation({ summary: 'A watermarked duplicate, or a correction' })
  reissue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReissueCertificateDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.certificates.reissue(id, dto, user);
  }

  @Post(':id/revoke')
  @RequirePermissions('certificate.revoke')
  @ApiOperation({ summary: 'Revoke an issued certificate, with a reason' })
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeCertificateDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.certificates.revoke(id, dto, user);
  }

  @Post('legacy')
  @RequirePermissions('certificate.legacy')
  @ApiOperation({ summary: 'Backfill a pre-system certificate' })
  legacy(
    @Body() dto: LegacyCertificateDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.certificates.createLegacy(dto, user);
  }

  @Post('bulk-prize')
  @RequirePermissions('certificate.issue')
  @ApiOperation({ summary: 'Top-N-per-class prize certificates from an exam' })
  bulkPrize(
    @Body() dto: BulkPrizeDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.prizes.run(dto, user);
  }

  @Delete(':id')
  @RequirePermissions('certificate.issue')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a draft (an issued one is revoked)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.certificates.removeDraft(id, user);
  }
}
