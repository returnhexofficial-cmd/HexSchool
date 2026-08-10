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
  AppointmentQueryDto,
  CheckInVisitorDto,
  CheckOutVisitorDto,
  DecideAppointmentDto,
  ReportWindowDto,
  UpdateVisitorDto,
  UpsertAppointmentDto,
  VisitorQueryDto,
} from '../dto';
import {
  CommunityExportService,
  type ExportFile,
} from '../services/community-export.service';
import { CommunityPdfService } from '../services/community-pdf.service';
import { CommunityReportsService } from '../services/community-reports.service';
import { VisitorsService } from '../services/visitors.service';

function streamFile(res: Response, file: ExportFile): StreamableFile {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.filename}"`,
  );
  return new StreamableFile(file.buffer);
}

/** Roadmap §4's `CRUD /api/v1/visitors (+ /:id/checkout)`. */
@ApiTags('visitors')
@ApiBearerAuth()
@Controller('visitors')
export class VisitorsController {
  constructor(
    private readonly visitors: VisitorsService,
    private readonly reports: CommunityReportsService,
    private readonly exports: CommunityExportService,
    private readonly pdf: CommunityPdfService,
  ) {}

  // ── fixed segments before `:id` ─────────────────────────────────────

  /** The live board — the question the whole gate register exists for. */
  @Get('inside')
  @RequirePermissions('visitor.view')
  @ApiOperation({ summary: 'Who is in the building right now' })
  inside(@CurrentUser() user: AccessTokenPayload) {
    return this.visitors.inside(user);
  }

  @Get('hosts')
  @RequirePermissions('visitor.view')
  @ApiOperation({ summary: 'Everybody a visitor could ask for' })
  hosts(@CurrentUser() user: AccessTokenPayload) {
    return this.visitors.hosts(user);
  }

  @Get('reports/register')
  @RequirePermissions('visitor.report')
  @ApiOperation({ summary: 'The daily gate book' })
  register(
    @Query() query: ReportWindowDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.visitorRegister(query, user.schoolId);
  }

  @Get('reports/register/export')
  @RequirePermissions('visitor.export')
  @SkipEnvelope()
  async registerXlsx(
    @Query() query: ReportWindowDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.visitorRegisterXlsx(query, user.schoolId),
    );
  }

  @Get('reports/register/pdf')
  @RequirePermissions('visitor.export')
  @SkipEnvelope()
  async registerPdf(
    @Query() query: ReportWindowDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.visitorRegisterPdf(query, user.schoolId),
    );
  }

  // ── the desk ────────────────────────────────────────────────────────

  @Get()
  @RequirePermissions('visitor.view')
  list(
    @Query() query: VisitorQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.visitors.list(query, user);
  }

  @Get(':id')
  @RequirePermissions('visitor.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.visitors.get(id, user);
  }

  /** The printed card. A6 landscape — it is carried, not filed. */
  @Get(':id/gate-pass')
  @RequirePermissions('visitor.manage')
  @SkipEnvelope()
  async gatePass(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const visitor = await this.visitors.get(id, user);
    const buffer = await this.pdf.gatePass(
      visitor,
      user.schoolId,
      visitor.hostName,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="gate-pass-${visitor.gatePassNo ?? visitor.id}.pdf"`,
    );
    return new StreamableFile(buffer);
  }

  @Post()
  @RequirePermissions('visitor.manage')
  @ApiOperation({ summary: 'Check a visitor in' })
  checkIn(
    @Body() dto: CheckInVisitorDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.visitors.checkIn(dto, user);
  }

  @Post(':id/checkout')
  @RequirePermissions('visitor.manage')
  @ApiOperation({ summary: 'Check a visitor out' })
  checkOut(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CheckOutVisitorDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.visitors.checkOut(id, dto, user);
  }

  @Patch(':id')
  @RequirePermissions('visitor.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVisitorDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.visitors.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('visitor.delete')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.visitors.remove(id, user);
  }
}

/** Roadmap §4's `CRUD /api/v1/appointments (+approve/reject)`. */
@ApiTags('visitors')
@ApiBearerAuth()
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly visitors: VisitorsService) {}

  @Get()
  @RequirePermissions('appointment.view')
  list(
    @Query() query: AppointmentQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.visitors.listAppointments(query, user);
  }

  @Get(':id')
  @RequirePermissions('appointment.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.visitors.getAppointment(id, user);
  }

  @Post()
  @RequirePermissions('appointment.manage')
  create(
    @Body() dto: UpsertAppointmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.visitors.createAppointment(dto, user);
  }

  @Put(':id')
  @RequirePermissions('appointment.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertAppointmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.visitors.updateAppointment(id, dto, user);
  }

  /**
   * Approve, refuse, or record that nobody turned up. A separate code from
   * `appointment.manage`: recording a request is clerical, committing
   * somebody else's diary is not.
   */
  @Put(':id/decision')
  @RequirePermissions('appointment.decide')
  @ApiOperation({ summary: 'Approve, refuse, or mark a no-show' })
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideAppointmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.visitors.decideAppointment(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('appointment.manage')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.visitors.removeAppointment(id, user);
  }
}
