import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  AssignmentQueryDto,
  CreateAssignmentDto,
  TransferAssignmentsDto,
  WorkloadQueryDto,
} from '../dto';
import { TeacherAssignmentsService } from '../services/teacher-assignments.service';

@ApiTags('teacher-assignments')
@ApiBearerAuth()
@Controller('teacher-assignments')
export class TeacherAssignmentsController {
  constructor(private readonly assignments: TeacherAssignmentsService) {}

  @Get()
  @RequirePermissions('teacher.view')
  @ApiOperation({ summary: 'Assignments (?sessionId=&sectionId=&teacherId=)' })
  async list(
    @Query() query: AssignmentQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.list(query, user.schoolId);
  }

  /** Static path — declared before :id (M07 route-order convention). */
  @Get('workload')
  @RequirePermissions('teacher.view')
  @ApiOperation({ summary: 'Per-teacher assignment counts (interim workload)' })
  async workload(
    @Query() query: WorkloadQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.workload(query.sessionId, user.schoolId);
  }

  @Post()
  @RequirePermissions('teacher.assign')
  @ApiOperation({
    summary:
      'Assign teacher to (session, section, subject) — replaces the current holder',
  })
  async assign(
    @Body() dto: CreateAssignmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.assign(dto, user);
  }

  @Post('transfer')
  @RequirePermissions('teacher.assign')
  @ApiOperation({
    summary:
      "Bulk-move one teacher's assignments in a session to another teacher (resign helper)",
  })
  async transfer(
    @Body() dto: TransferAssignmentsDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.transfer(dto, user);
  }

  @Delete(':id')
  @RequirePermissions('teacher.assign')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.assignments.remove(id, user);
    return { message: 'Assignment removed' };
  }
}
