import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AttendancePersonType, StaffStatus } from '../../../common/constants';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { AssignSalaryDto, EmployeeQueryDto } from '../dto';
import {
  EmployeesRepository,
  PAYABLE_STATUSES,
} from '../repositories/employees.repository';
import { PayrollService } from '../services/payroll.service';
import { SalaryService } from '../services/salary.service';

/**
 * The unified employee surface (roadmap M21 §1) — one list over teachers
 * AND staff, and everything that hangs off a person rather than off a
 * month: their salary history, their payslips.
 *
 * `personType` is part of the path rather than a query parameter because
 * it is half of the identity: `teachers.id` and `staff_profiles.id` are
 * two different id spaces, and a route that took only an id would have
 * to guess which table to look in.
 */
@ApiTags('hr-employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesRepository,
    private readonly salary: SalaryService,
    private readonly payroll: PayrollService,
  ) {}

  @Get()
  @RequirePermissions('hr.view')
  @ApiOperation({ summary: 'The workforce: teachers and staff in one list' })
  async list(
    @Query() query: EmployeeQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.employees.findMany(user.schoolId, {
      personType: query.personType,
      departmentId: query.departmentId,
      search: query.search,
      statuses: query.includeInactive
        ? [
            StaffStatus.ACTIVE,
            StaffStatus.ON_LEAVE,
            StaffStatus.RESIGNED,
            StaffStatus.TERMINATED,
            StaffStatus.RETIRED,
          ]
        : PAYABLE_STATUSES,
    });
  }

  @Get(':personType/:personId/salary')
  @RequirePermissions('salary.view')
  @ApiOperation({
    summary: 'Salary history — every assignment, newest first',
  })
  async salaryHistory(
    @Param('personType') personType: AttendancePersonType,
    @Param('personId', ParseUUIDPipe) personId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.salary.history(user.schoolId, personType, personId);
  }

  @Put(':personId/salary')
  @RequirePermissions('salary.assign')
  @ApiOperation({
    summary:
      'Assign a salary structure — writes a NEW history row, never an edit',
  })
  async assignSalary(
    @Param('personId', ParseUUIDPipe) personId: string,
    @Body() dto: AssignSalaryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.salary.assign(personId, dto, user);
  }

  @Delete('salary/:id')
  @RequirePermissions('salary.assign')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a mis-dated salary history row' })
  async removeAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.salary.removeAssignment(id, user);
  }

  @Get(':personType/:personId/payslips')
  @RequirePermissions('payroll.view')
  async payslips(
    @Param('personType') personType: AttendancePersonType,
    @Param('personId', ParseUUIDPipe) personId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.payroll.payslipsForPerson(user.schoolId, personType, personId);
  }
}
