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
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SkipEnvelope } from '../../../common/decorators/skip-envelope.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  AlumniDecisionDto,
  AlumniEventQueryDto,
  AlumniQueryDto,
  CancelDonationDto,
  CreateDonationDto,
  DonationQueryDto,
  RegisterForEventDto,
  ReportWindowDto,
  UpdateRegistrationDto,
  UpsertAlumniDto,
  UpsertAlumniEventDto,
} from '../dto';
import { AlumniEventsService } from '../services/alumni-events.service';
import { AlumniService } from '../services/alumni.service';
import {
  CommunityExportService,
  type ExportFile,
} from '../services/community-export.service';
import { CommunityPdfService } from '../services/community-pdf.service';
import { CommunityReportsService } from '../services/community-reports.service';
import { DonationsService } from '../services/donations.service';

function streamFile(res: Response, file: ExportFile): StreamableFile {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.filename}"`,
  );
  return new StreamableFile(file.buffer);
}

/** Roadmap §4's `CRUD /api/v1/alumni (+ /:id/approve)`. */
@ApiTags('alumni')
@ApiBearerAuth()
@Controller('alumni')
export class AlumniController {
  constructor(
    private readonly alumni: AlumniService,
    private readonly reports: CommunityReportsService,
    private readonly exports: CommunityExportService,
  ) {}

  @Get('reports/directory')
  @RequirePermissions('alumni.export')
  @ApiOperation({ summary: 'Approved alumni by batch, with contacts' })
  directory(@CurrentUser() user: AccessTokenPayload) {
    return this.reports.alumniDirectory(user.schoolId);
  }

  @Get('reports/directory/export')
  @RequirePermissions('alumni.export')
  @SkipEnvelope()
  async directoryXlsx(
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.alumniDirectoryXlsx(user.schoolId),
    );
  }

  @Get()
  @RequirePermissions('alumni.view')
  @ApiOperation({ summary: 'The directory and the approval queue' })
  list(
    @Query() query: AlumniQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.alumni.list(query, user);
  }

  @Get(':id')
  @RequirePermissions('alumni.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.alumni.get(id, user);
  }

  /** Roadmap §4's match hint. It ranks; the approver decides. */
  @Get(':id/match-hints')
  @RequirePermissions('alumni.approve')
  @ApiOperation({ summary: 'Past graduates this claim might be' })
  matchHints(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.alumni.matchHints(id, user);
  }

  @Post()
  @RequirePermissions('alumni.manage')
  create(
    @Body() dto: UpsertAlumniDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.alumni.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('alumni.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertAlumniDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.alumni.update(id, dto, user);
  }

  @Put(':id/decision')
  @RequirePermissions('alumni.approve')
  @ApiOperation({ summary: 'Approve or reject a registration' })
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AlumniDecisionDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.alumni.decide(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('alumni.manage')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.alumni.remove(id, user);
  }
}

/** Roadmap §4's `CRUD /api/v1/alumni-events (+registrations)`. */
@ApiTags('alumni')
@ApiBearerAuth()
@Controller('alumni-events')
export class AlumniEventsController {
  constructor(private readonly events: AlumniEventsService) {}

  @Get()
  @RequirePermissions('alumni.view')
  list(
    @Query() query: AlumniEventQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.events.list(query, user);
  }

  @Get(':id')
  @RequirePermissions('alumni.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.events.get(id, user);
  }

  @Get(':id/registrations')
  @RequirePermissions('alumni.view')
  registrations(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.events.listRegistrations(id, user);
  }

  @Post()
  @RequirePermissions('alumni.event.manage')
  create(
    @Body() dto: UpsertAlumniEventDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.events.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('alumni.event.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertAlumniEventDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.events.update(id, dto, user);
  }

  @Post(':id/registrations')
  @RequirePermissions('alumni.event.manage')
  @ApiOperation({ summary: 'Register an alumnus — over capacity warns' })
  register(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegisterForEventDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.events.register(id, dto, user);
  }

  @Put('registrations/:registrationId')
  @RequirePermissions('alumni.event.manage')
  updateRegistration(
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
    @Body() dto: UpdateRegistrationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.events.updateRegistration(registrationId, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('alumni.event.manage')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.events.remove(id, user);
  }
}

/** Roadmap §4's `CRUD /api/v1/donations` — minus the U, deliberately. */
@ApiTags('alumni')
@ApiBearerAuth()
@Controller('donations')
export class DonationsController {
  constructor(
    private readonly donations: DonationsService,
    private readonly reports: CommunityReportsService,
    private readonly exports: CommunityExportService,
    private readonly pdf: CommunityPdfService,
  ) {}

  @Get('reports/summary')
  @RequirePermissions('alumni.report')
  @ApiOperation({ summary: 'What was raised, by purpose, method and month' })
  summary(
    @Query() query: ReportWindowDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.donationSummary(query, user.schoolId);
  }

  @Get('reports/summary/export')
  @RequirePermissions('alumni.export')
  @SkipEnvelope()
  async summaryXlsx(
    @Query() query: ReportWindowDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.donationSummaryXlsx(query, user.schoolId),
    );
  }

  @Get('reports/register')
  @RequirePermissions('alumni.export')
  register(
    @Query() query: ReportWindowDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.donationRegister(query, user.schoolId);
  }

  @Get('reports/register/export')
  @RequirePermissions('alumni.export')
  @SkipEnvelope()
  async registerXlsx(
    @Query() query: ReportWindowDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.donationRegisterXlsx(query, user.schoolId),
    );
  }

  @Get()
  @RequirePermissions('alumni.donation.view')
  list(
    @Query() query: DonationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.donations.list(query, user);
  }

  @Get(':id')
  @RequirePermissions('alumni.donation.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.donations.get(id, user);
  }

  @Get(':id/receipt')
  @RequirePermissions('alumni.donation.view')
  @SkipEnvelope()
  async receipt(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const donation = await this.donations.get(id, user);
    const buffer = await this.pdf.donationReceipt(donation, user.schoolId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="receipt-${donation.receiptNo}.pdf"`,
    );
    return new StreamableFile(buffer);
  }

  @Post()
  @RequirePermissions('alumni.donation.create')
  @ApiOperation({ summary: 'Record a donation and issue its receipt' })
  create(
    @Body() dto: CreateDonationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.donations.create(dto, user);
  }

  /**
   * **There is no PUT.** Roadmap §6 makes a receipt immutable, so the only
   * correction is this — and it needs a different permission from taking
   * the money (the M16/M20/M21/M23/M24/M25/M26/M27 separation).
   */
  @Post(':id/cancel')
  @RequirePermissions('alumni.donation.cancel')
  @ApiOperation({ summary: 'Cancel a receipt — it stays in the register' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDonationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.donations.cancel(id, dto, user);
  }
}
