import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { AdmissionReportsService } from '../services/admission-reports.service';

class SummaryQueryDto {
  @IsOptional()
  @IsUUID()
  cycleId?: string;
}

@ApiTags('admission')
@ApiBearerAuth()
@Controller('admission-reports')
export class AdmissionReportsController {
  constructor(private readonly reports: AdmissionReportsService) {}

  @Get('summary')
  @RequirePermissions('admission.view')
  @ApiOperation({
    summary: 'Funnel summary (applied/selected/admitted; per class w/ cycle)',
  })
  async summary(
    @Query() query: SummaryQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.summary(user.schoolId, query.cycleId);
  }
}
