import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SetUserRolesDto } from '../dto';
import { RolesService } from '../services/roles.service';

/**
 * Role assignment endpoints under /users/:id/roles (roadmap M03 §APIs).
 * The full user-admin surface (list/status/reset-password) arrives with
 * Module 07 — this controller only owns the RBAC slice.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UserRolesController {
  constructor(private readonly roles: RolesService) {}

  @Get(':id/roles')
  @RequirePermissions('user.role.view')
  @ApiOperation({ summary: "A user's assigned roles" })
  async getUserRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.roles.getUserRoles(id, user.schoolId);
  }

  @Put(':id/roles')
  @RequirePermissions('user.role.assign')
  @ApiOperation({
    summary:
      "Replace a user's role set (must keep ≥1; last super-admin protected)",
  })
  async setUserRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserRolesDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.roles.setUserRoles(id, dto, user);
  }
}
