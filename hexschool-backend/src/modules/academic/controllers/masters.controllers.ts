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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  CreateDepartmentDto,
  CreateGroupDto,
  CreateShiftDto,
  CreateSubjectDto,
  UpdateDepartmentDto,
  UpdateGroupDto,
  UpdateShiftDto,
  UpdateSubjectDto,
} from '../dto';
import { MastersService } from '../services/masters.service';

/**
 * The four simple masters share one file — each is a thin
 * DataTable-style CRUD surface over MastersService (roadmap M06 §4).
 * Classes (with the subject mapping) and sections have their own
 * controllers.
 */

@ApiTags('departments')
@ApiBearerAuth()
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly masters: MastersService) {}

  @Get()
  @RequirePermissions('structure.view')
  async list(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.masters.listDepartments(query, user.schoolId);
  }

  @Post()
  @RequirePermissions('department.manage')
  async create(
    @Body() dto: CreateDepartmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.masters.createDepartment(dto, user);
  }

  @Put(':id')
  @RequirePermissions('department.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.masters.updateDepartment(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('department.manage')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.masters.removeDepartment(id, user);
    return { message: 'Department deleted' };
  }
}

@ApiTags('shifts')
@ApiBearerAuth()
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly masters: MastersService) {}

  @Get()
  @RequirePermissions('structure.view')
  async list(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.masters.listShifts(query, user.schoolId);
  }

  @Post()
  @RequirePermissions('shift.manage')
  async create(
    @Body() dto: CreateShiftDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.masters.createShift(dto, user);
  }

  @Put(':id')
  @RequirePermissions('shift.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShiftDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.masters.updateShift(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('shift.manage')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.masters.removeShift(id, user);
    return { message: 'Shift deleted' };
  }
}

@ApiTags('groups')
@ApiBearerAuth()
@Controller('groups')
export class GroupsController {
  constructor(private readonly masters: MastersService) {}

  @Get()
  @RequirePermissions('structure.view')
  async list(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.masters.listGroups(query, user.schoolId);
  }

  @Post()
  @RequirePermissions('group.manage')
  async create(
    @Body() dto: CreateGroupDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.masters.createGroup(dto, user);
  }

  @Put(':id')
  @RequirePermissions('group.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGroupDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.masters.updateGroup(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('group.manage')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.masters.removeGroup(id, user);
    return { message: 'Group deleted' };
  }
}

@ApiTags('subjects')
@ApiBearerAuth()
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly masters: MastersService) {}

  @Get()
  @RequirePermissions('structure.view')
  async list(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.masters.listSubjects(query, user.schoolId);
  }

  @Post()
  @RequirePermissions('subject.manage')
  async create(
    @Body() dto: CreateSubjectDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.masters.createSubject(dto, user);
  }

  @Put(':id')
  @RequirePermissions('subject.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubjectDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.masters.updateSubject(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('subject.manage')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.masters.removeSubject(id, user);
    return { message: 'Subject deleted' };
  }
}
