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
import { PermissionsService } from '../../rbac/services/permissions.service';
import {
  AssignTicketDto,
  CreateTicketDto,
  ReportWindowDto,
  TicketCommentDto,
  TicketQueryDto,
  TicketStatusDto,
} from '../dto';
import {
  CommunityExportService,
  type ExportFile,
} from '../services/community-export.service';
import { CommunityReportsService } from '../services/community-reports.service';
import { TicketsService } from '../services/tickets.service';

function streamFile(res: Response, file: ExportFile): StreamableFile {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.filename}"`,
  );
  return new StreamableFile(file.buffer);
}

/** Roadmap §4's `CRUD /api/v1/tickets (+ /:id/assign|status|comments)`. */
@ApiTags('tickets')
@ApiBearerAuth()
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly reports: CommunityReportsService,
    private readonly exports: CommunityExportService,
    private readonly permissions: PermissionsService,
  ) {}

  // ── reports come before `:id`, or the router eats them ──────────────

  @Get('reports/summary')
  @RequirePermissions('ticket.report')
  @ApiOperation({ summary: 'Volume, resolution time and SLA compliance' })
  async summary(
    @Query() query: ReportWindowDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.ticketSummary(
      query,
      user.schoolId,
      await this.maySeeSensitive(user),
    );
  }

  @Get('reports/summary/export')
  @RequirePermissions('ticket.export')
  @SkipEnvelope()
  async summaryXlsx(
    @Query() query: ReportWindowDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.ticketSummaryXlsx(
        query,
        user.schoolId,
        await this.maySeeSensitive(user),
      ),
    );
  }

  @Get('reports/register')
  @RequirePermissions('ticket.export')
  @ApiOperation({ summary: 'Every ticket raised over a window' })
  async register(
    @Query() query: ReportWindowDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.ticketRegister(
      query,
      user.schoolId,
      await this.maySeeSensitive(user),
    );
  }

  @Get('reports/register/export')
  @RequirePermissions('ticket.export')
  @SkipEnvelope()
  async registerXlsx(
    @Query() query: ReportWindowDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    return streamFile(
      res,
      await this.exports.ticketRegisterXlsx(
        query,
        user.schoolId,
        await this.maySeeSensitive(user),
      ),
    );
  }

  // ── inbox ───────────────────────────────────────────────────────────

  @Get()
  @RequirePermissions('ticket.view')
  @ApiOperation({ summary: 'The complaints inbox' })
  list(
    @Query() query: TicketQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.tickets.list(query, user);
  }

  @Get(':id')
  @RequirePermissions('ticket.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.tickets.get(id, user);
  }

  @Get(':id/comments')
  @RequirePermissions('ticket.view')
  @ApiOperation({ summary: 'The thread, internal notes included' })
  thread(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.tickets.thread(id, user);
  }

  // ── writes ──────────────────────────────────────────────────────────

  @Post()
  @RequirePermissions('ticket.create')
  @ApiOperation({ summary: 'Log a walk-in complaint' })
  create(
    @Body() dto: CreateTicketDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.tickets.create(dto, user);
  }

  @Put(':id/assign')
  @RequirePermissions('ticket.assign')
  @ApiOperation({ summary: 'Assign, prioritize, recategorize, restrict' })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.tickets.assign(id, dto, user);
  }

  /**
   * The permission is `ticket.respond`; the **relationship** (assignee or
   * inbox manager, roadmap §6) is checked in `ticket.engine`, because "your
   * own ticket" is not something a permission code can express.
   */
  @Put(':id/status')
  @RequirePermissions('ticket.respond')
  @ApiOperation({ summary: 'Move a ticket through the workflow' })
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TicketStatusDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.tickets.setStatus(id, dto, user);
  }

  @Post(':id/comments')
  @RequirePermissions('ticket.respond')
  @ApiOperation({ summary: 'Reply, or leave an internal note' })
  comment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TicketCommentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.tickets.comment(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('ticket.delete')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove spam from the public form' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.tickets.remove(id, user);
  }

  private async maySeeSensitive(user: AccessTokenPayload): Promise<boolean> {
    if (user.userType === 'SUPER_ADMIN') return true;
    const codes = await this.permissions.getUserPermissionCodes(user.sub);
    return codes.includes('ticket.sensitive.view');
  }
}
