import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireAnyPermission } from '../../../common/decorators/require-permissions.decorator';
import { PermissionQueryDto } from '../dto';
import { PermissionsRepository } from '../repositories/permissions.repository';

/**
 * Read-only: the catalog is code-defined (registry) and seeder-synced —
 * there is deliberately no create/update/delete API.
 */
@ApiTags('permissions')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissions: PermissionsRepository) {}

  @Get()
  @RequireAnyPermission('permission.view', 'role.view')
  @ApiOperation({
    summary: 'Permission catalog (grouped client-side by module)',
  })
  async list(@Query() query: PermissionQueryDto) {
    return this.permissions.findCatalog(query.includeOrphaned ?? false);
  }
}
