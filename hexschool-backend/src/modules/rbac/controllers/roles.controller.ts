import {
  Body,
  Controller,
  Delete,
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
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CreateRoleDto, UpdateRoleDto, UpdateRolePermissionsDto } from '../dto';
import { RolesService } from '../services/roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('role.view')
  @ApiOperation({ summary: 'List roles (with grant/assignment counts)' })
  async list(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.roles.list(query, user.schoolId);
  }

  @Get(':id')
  @RequirePermissions('role.view')
  @ApiOperation({ summary: 'One role with its permission codes' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.roles.getById(id, user.schoolId);
  }

  @Post()
  @RequirePermissions('role.create')
  @ApiOperation({ summary: 'Create a custom role' })
  async create(
    @Body() dto: CreateRoleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.roles.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('role.update')
  @ApiOperation({
    summary:
      'Rename/edit a role (optimistic concurrency via expectedUpdatedAt)',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.roles.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('role.delete')
  @ApiOperation({ summary: 'Soft-delete a custom role (system roles: 400)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.roles.remove(id, user);
    return { message: 'Role deleted' };
  }

  @Put(':id/permissions')
  @RequirePermissions('role.permission.assign')
  @ApiOperation({
    summary: "Replace a role's permission set (system core codes are locked)",
  })
  async setPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRolePermissionsDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.roles.setPermissions(id, dto, user);
  }
}
