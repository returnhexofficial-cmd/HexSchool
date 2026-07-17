import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { UpdateUserStatusDto, UsersQueryDto } from '../dto';
import { UsersAdminService } from '../services/users-admin.service';

/**
 * User administration surface (roadmap M07 §4). Completes the /users
 * resource started by M03's UserRolesController (which keeps the
 * /users/:id/roles endpoints).
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersAdmin: UsersAdminService) {}

  @Get()
  @RequirePermissions('user.view')
  @ApiOperation({ summary: 'All user accounts (filter: type/status/role)' })
  async list(
    @Query() query: UsersQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.usersAdmin.list(query, user.schoolId);
  }

  @Put(':id/status')
  @RequirePermissions('user.status')
  @ApiOperation({
    summary: 'Activate/deactivate/suspend (revokes sessions when not ACTIVE)',
  })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.usersAdmin.updateStatus(id, dto, user);
    return { message: 'User status updated' };
  }

  @Post(':id/reset-password')
  @RequirePermissions('user.password.reset')
  @ApiOperation({
    summary:
      'Admin reset: temp password (forced change), sessions revoked, sent by SMS/email',
  })
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.usersAdmin.resetPassword(id, user);
  }
}
