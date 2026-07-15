import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { AuditLogQueryDto } from '../dto/audit-log-query.dto';
import { AuditService } from '../services/audit.service';

/** Read-only by design: audit logs are immutable (roadmap M03 §6). */
@ApiTags('audit-logs')
@ApiBearerAuth()
@Controller('audit-logs')
@RequirePermissions('audit.view')
export class AuditLogsController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({
    summary: 'List audit logs (filter: user, entity, action, date range)',
  })
  async list(
    @Query() query: AuditLogQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.audit.list(query, user.schoolId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One audit entry with its old/new value diff' })
  async getById(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.audit.getById(id, user.schoolId);
  }
}
