import {
  Body,
  Controller,
  Get,
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
  ApplicationQueryDto,
  RecordPaymentDto,
  SetPaymentStatusDto,
  UpdateApplicationStatusDto,
} from '../dto';
import { AdmissionApplicationsService } from '../services/admission-applications.service';
import { AdmitCardService } from '../services/admit-card.service';

@ApiTags('admission')
@ApiBearerAuth()
@Controller('admission-applications')
export class AdmissionApplicationsController {
  constructor(
    private readonly applications: AdmissionApplicationsService,
    private readonly admitCards: AdmitCardService,
  ) {}

  @Get()
  @RequirePermissions('admission.view')
  @ApiOperation({
    summary:
      'Applications (filter: cycle/class/status/payment; search: name/app no/phone)',
  })
  async list(
    @Query() query: ApplicationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.applications.list(query, user.schoolId);
  }

  @Get(':id')
  @RequirePermissions('admission.view')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.applications.getDetail(id, user.schoolId);
  }

  @Put(':id/status')
  @RequirePermissions('admission.application.review')
  @ApiOperation({
    summary:
      'Manual review transition (engine-owned statuses have their own endpoints)',
  })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationStatusDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.applications.updateStatus(id, dto, user);
  }

  @Post(':id/payment')
  @RequirePermissions('admission.payment.record')
  @ApiOperation({
    summary: 'Record an offline fee payment (gateway wiring arrives in M16)',
  })
  async recordPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.applications.recordPayment(id, dto, user);
  }

  @Put(':id/payment-status')
  @RequirePermissions('admission.payment.waive')
  @ApiOperation({
    summary: 'Waive or refund the application fee (with reason)',
  })
  async setPaymentStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPaymentStatusDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.applications.setPaymentStatus(id, dto, user);
  }

  @Post(':id/admit')
  @RequirePermissions('admission.admit')
  @ApiOperation({
    summary:
      'Convert SELECTED application → student (M09 path: UID + guardian dedup). Idempotent for ADMITTED.',
  })
  async admit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.applications.admit(id, user);
  }

  @Get(':id/admit-card')
  @RequirePermissions('admission.view')
  @SkipEnvelope()
  @ApiOperation({ summary: 'Admit card PDF (admin download)' })
  async admitCard(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const pdf = await this.admitCards.generateById(id, user.schoolId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="admit-card.pdf"',
    );
    return new StreamableFile(pdf);
  }
}
