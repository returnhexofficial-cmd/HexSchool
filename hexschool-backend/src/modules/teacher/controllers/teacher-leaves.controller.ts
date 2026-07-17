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
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CreateLeaveDto, LeaveQueryDto, UpdateLeaveDto } from '../dto';
import { TeacherLeavesService } from '../services/teacher-leaves.service';

@ApiTags('teacher-leaves')
@ApiBearerAuth()
@Controller('teacher-leaves')
export class TeacherLeavesController {
  constructor(private readonly leaves: TeacherLeavesService) {}

  @Get()
  @RequirePermissions('teacher.view')
  @ApiOperation({ summary: 'Leave list (?teacherId=&status=&type=)' })
  async list(
    @Query() query: LeaveQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.leaves.list(query, user.schoolId);
  }

  @Post()
  @RequirePermissions('teacher.leave.manage')
  @ApiOperation({
    summary: 'Record a leave request (must fall within the current session)',
  })
  async create(
    @Body() dto: CreateLeaveDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.leaves.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('teacher.leave.manage')
  @ApiOperation({ summary: 'Edit a PENDING leave' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeaveDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.leaves.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('teacher.leave.manage')
  @ApiOperation({ summary: 'Delete a PENDING leave' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.leaves.remove(id, user);
    return { message: 'Leave deleted' };
  }

  @Post(':id/approve')
  @RequirePermissions('teacher.leave.approve')
  @ApiOperation({
    summary:
      'Approve (blocked when overlapping an approved leave; emits M12 hook)',
  })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.leaves.approve(id, user);
  }

  @Post(':id/reject')
  @RequirePermissions('teacher.leave.approve')
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.leaves.reject(id, user);
  }
}
