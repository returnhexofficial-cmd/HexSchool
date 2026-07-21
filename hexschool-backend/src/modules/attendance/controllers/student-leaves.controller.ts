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
import {
  CreateStudentLeaveDto,
  DecideStudentLeaveDto,
  StudentLeaveQueryDto,
  UpdateStudentLeaveDto,
} from '../dto';
import { StudentLeavesService } from '../services/student-leaves.service';

@ApiTags('student-leaves')
@ApiBearerAuth()
@Controller('student-leaves')
export class StudentLeavesController {
  constructor(private readonly leaves: StudentLeavesService) {}

  @Get()
  @RequirePermissions('student.leave.view')
  @ApiOperation({ summary: 'List leave applications (status/date filters)' })
  async list(
    @Query() query: StudentLeaveQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.leaves.list(query, user.schoolId);
  }

  @Get(':id')
  @RequirePermissions('student.leave.view')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.leaves.getDetail(id, user.schoolId);
  }

  @Post()
  @RequirePermissions('student.leave.manage')
  @ApiOperation({ summary: 'Raise a leave application for a student' })
  async create(
    @Body() dto: CreateStudentLeaveDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.leaves.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('student.leave.manage')
  @ApiOperation({ summary: 'Edit a PENDING application' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentLeaveDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.leaves.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('student.leave.manage')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.leaves.remove(id, user);
    return { message: 'Leave application deleted' };
  }

  @Post(':id/approve')
  @RequirePermissions('student.leave.approve')
  @ApiOperation({
    summary: 'Approve — retro-marks recorded ABSENT days in the range as LEAVE',
  })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideStudentLeaveDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.leaves.approve(id, dto, user);
  }

  @Post(':id/reject')
  @RequirePermissions('student.leave.approve')
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideStudentLeaveDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.leaves.reject(id, dto, user);
  }
}
