import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  AttendanceSheetQueryDto,
  ConvertToHolidayDto,
  MarkStudentAttendanceDto,
  QrCheckinDto,
} from '../dto';
import { QrCheckinService } from '../services/qr-checkin.service';
import { StudentAttendanceService } from '../services/student-attendance.service';

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance')
export class StudentAttendanceController {
  constructor(
    private readonly attendance: StudentAttendanceService,
    private readonly qr: QrCheckinService,
  ) {}

  @Get('students')
  @RequirePermissions('attendance.view')
  @ApiOperation({
    summary:
      'Marking sheet: section roster for a date with any existing marks, holiday and lock state',
  })
  async sheet(
    @Query() query: AttendanceSheetQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.attendance.getSheet(query, user);
  }

  @Post('students')
  @RequirePermissions('attendance.mark')
  @ApiOperation({
    summary:
      'Mark/re-mark a section for a date (upsert; re-marking needs attendance.edit)',
  })
  async mark(
    @Body() dto: MarkStudentAttendanceDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.attendance.mark(dto, user);
  }

  @Post('qr-checkin')
  @RequirePermissions('attendance.qr.checkin')
  @ApiOperation({
    summary:
      'QR check-in: resolves the card token, marks PRESENT/LATE/HALF_DAY by arrival time',
  })
  async qrCheckin(
    @Body() dto: QrCheckinDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.qr.checkin(dto, user);
  }

  @Post('convert-holiday')
  @RequirePermissions('attendance.holiday.override')
  @ApiOperation({
    summary:
      'Convert an already-marked date to HOLIDAY (late government holiday)',
  })
  async convertHoliday(
    @Body() dto: ConvertToHolidayDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.attendance.convertToHoliday(dto, user);
  }
}
