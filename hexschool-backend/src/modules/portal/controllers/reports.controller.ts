import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { ReportsService } from '../services/reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @ApiOperation({
    summary: 'The reports the caller may run — powers the Reports hub',
  })
  list(@CurrentUser() user: AccessTokenPayload) {
    return this.reports.listFor(user);
  }
}
