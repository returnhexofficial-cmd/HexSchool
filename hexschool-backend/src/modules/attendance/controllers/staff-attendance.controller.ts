import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { MarkStaffAttendanceDto, StaffAttendanceQueryDto } from '../dto';
import { StaffAttendanceService } from '../services/staff-attendance.service';

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance/staff')
export class StaffAttendanceController {
  constructor(private readonly staffAttendance: StaffAttendanceService) {}

  @Get()
  @RequirePermissions('attendance.staff.view')
  @ApiOperation({
    summary: 'Employee attendance sheet for a date (teachers + staff)',
  })
  async sheet(
    @Query() query: StaffAttendanceQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.staffAttendance.getSheet(query, user);
  }

  @Post()
  @RequirePermissions('attendance.staff.mark')
  @ApiOperation({ summary: 'Mark employee attendance for a date (upsert)' })
  async mark(
    @Body() dto: MarkStaffAttendanceDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.staffAttendance.mark(dto, user);
  }
}
