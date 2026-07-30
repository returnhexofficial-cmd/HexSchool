import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AttendancePersonType } from '../../../common/constants';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  AdjustBalanceDto,
  AllocateBalancesDto,
  CreateLeaveDto,
  CreateLeaveTypeDto,
  LeaveBalanceQueryDto,
  LeaveDecisionDto,
  LeaveQueryDto,
  UpdateLeaveDto,
  UpdateLeaveTypeDto,
} from '../dto';
import { LeaveBalancesService } from '../services/leave-balances.service';
import { LeaveTypesService } from '../services/leave-types.service';
import { LeaveService } from '../services/leave.service';

@ApiTags('hr-leave')
@ApiBearerAuth()
@Controller('leave-types')
export class LeaveTypesController {
  constructor(private readonly types: LeaveTypesService) {}

  @Get()
  @RequirePermissions('hr.view')
  @ApiOperation({ summary: 'List leave types' })
  async list(@CurrentUser() user: AccessTokenPayload) {
    return this.types.list(user.schoolId);
  }

  @Post()
  @RequirePermissions('leave.type.manage')
  async create(
    @Body() dto: CreateLeaveTypeDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.types.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('leave.type.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeaveTypeDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.types.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('leave.type.manage')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a leave type (refused once applications reference it)',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.types.remove(id, user);
  }
}

@ApiTags('hr-leave')
@ApiBearerAuth()
@Controller('leave-applications')
export class LeaveApplicationsController {
  constructor(private readonly leaves: LeaveService) {}

  @Get()
  @RequirePermissions('hr.view')
  @ApiOperation({ summary: 'The leave inbox — teachers and staff together' })
  async list(
    @Query() query: LeaveQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const { rows, total, page, limit } = await this.leaves.list(
      query,
      user.schoolId,
    );
    return {
      data: rows,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  @Get(':id')
  @RequirePermissions('hr.view')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.leaves.getDetail(id, user.schoolId);
  }

  @Post()
  @RequirePermissions('leave.apply')
  async create(
    @Body() dto: CreateLeaveDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.leaves.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('leave.apply')
  @ApiOperation({ summary: 'Edit a PENDING application' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeaveDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.leaves.update(id, dto, user);
  }

  @Post(':id/approve')
  @RequirePermissions('leave.approve')
  @ApiOperation({
    summary:
      'Approve — consumes the balance and marks the days LEAVE in attendance',
  })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LeaveDecisionDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.leaves.approve(id, dto, user);
  }

  @Post(':id/reject')
  @RequirePermissions('leave.approve')
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LeaveDecisionDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.leaves.reject(id, dto, user);
  }

  @Post(':id/cancel')
  @RequirePermissions('leave.approve')
  @ApiOperation({
    summary: 'Withdraw an application — an approved one gives its days back',
  })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LeaveDecisionDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.leaves.cancel(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('leave.apply')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.leaves.remove(id, user);
  }
}

@ApiTags('hr-leave')
@ApiBearerAuth()
@Controller('leave-balances')
export class LeaveBalancesController {
  constructor(
    private readonly leaves: LeaveService,
    private readonly balances: LeaveBalancesService,
  ) {}

  @Get(':personType/:personId')
  @RequirePermissions('hr.view')
  @ApiOperation({ summary: "One employee's balances for a session" })
  async forPerson(
    @Param('personType') personType: AttendancePersonType,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Query() query: LeaveBalanceQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.leaves.balancesFor(
      user.schoolId,
      personType,
      personId,
      query.sessionId,
    );
  }

  @Post('allocate')
  @RequirePermissions('leave.balance.manage')
  @ApiOperation({
    summary:
      'Allocate the session’s quotas to every employee (idempotent; carries forward)',
  })
  async allocate(
    @Body() dto: AllocateBalancesDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.balances.allocate(dto, user);
  }

  @Post('adjust')
  @RequirePermissions('leave.balance.manage')
  @ApiOperation({ summary: "Hand-adjust one employee's entitlement" })
  async adjust(
    @Body() dto: AdjustBalanceDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.balances.adjust(dto, user);
  }
}
