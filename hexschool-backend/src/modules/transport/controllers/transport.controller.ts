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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  AssignmentQueryDto,
  BulkAssignDto,
  CreateAssignmentDto,
  DriverQueryDto,
  EndAssignmentDto,
  ExpenseQueryDto,
  ReassignRouteDto,
  ReorderStopsDto,
  ResumeAssignmentDto,
  RouteQueryDto,
  SuspendAssignmentDto,
  UpdateAssignmentDto,
  UpsertDriverDto,
  UpsertExpenseDto,
  UpsertRouteDto,
  UpsertStopDto,
  UpsertVehicleDto,
  VehicleQueryDto,
} from '../dto';
import { FleetService } from '../services/fleet.service';
import { RoutesService } from '../services/routes.service';
import { TransportAssignmentsService } from '../services/transport-assignments.service';
import { VehicleExpensesService } from '../services/vehicle-expenses.service';

@ApiTags('transport')
@ApiBearerAuth()
@Controller('transport')
export class TransportController {
  constructor(
    private readonly fleet: FleetService,
    private readonly routes: RoutesService,
    private readonly assignments: TransportAssignmentsService,
    private readonly expenses: VehicleExpensesService,
  ) {}

  // ── vehicles ────────────────────────────────────────────────────────

  @Get('vehicles')
  @RequirePermissions('transport.view')
  listVehicles(
    @Query() query: VehicleQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.fleet.listVehicles(query, user);
  }

  @Get('vehicles/:id')
  @RequirePermissions('transport.view')
  getVehicle(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.fleet.getVehicle(id, user);
  }

  @Post('vehicles')
  @RequirePermissions('transport.vehicle.manage')
  createVehicle(
    @Body() dto: UpsertVehicleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.fleet.createVehicle(dto, user);
  }

  @Patch('vehicles/:id')
  @RequirePermissions('transport.vehicle.manage')
  updateVehicle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertVehicleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.fleet.updateVehicle(id, dto, user);
  }

  @Delete('vehicles/:id')
  @RequirePermissions('transport.vehicle.manage')
  @HttpCode(204)
  async removeVehicle(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.fleet.removeVehicle(id, user);
  }

  // ── drivers ─────────────────────────────────────────────────────────

  @Get('drivers')
  @RequirePermissions('transport.view')
  listDrivers(
    @Query() query: DriverQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.fleet.listDrivers(query, user);
  }

  @Get('drivers/:id')
  @RequirePermissions('transport.view')
  getDriver(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.fleet.getDriver(id, user);
  }

  @Post('drivers')
  @RequirePermissions('transport.driver.manage')
  createDriver(
    @Body() dto: UpsertDriverDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.fleet.createDriver(dto, user);
  }

  @Patch('drivers/:id')
  @RequirePermissions('transport.driver.manage')
  updateDriver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertDriverDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.fleet.updateDriver(id, dto, user);
  }

  @Delete('drivers/:id')
  @RequirePermissions('transport.driver.manage')
  @HttpCode(204)
  async removeDriver(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.fleet.removeDriver(id, user);
  }

  /** Roadmap §5's expiry-alerts widget — the same list the job sends. */
  @Get('alerts')
  @RequirePermissions('transport.view')
  @ApiOperation({ summary: 'Papers that are expired, expiring or missing' })
  alerts(@CurrentUser() user: AccessTokenPayload) {
    return this.fleet.alerts(user.schoolId);
  }

  // ── routes & stops ──────────────────────────────────────────────────

  @Get('routes')
  @RequirePermissions('transport.view')
  listRoutes(
    @Query() query: RouteQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.routes.list(query, user);
  }

  @Get('routes/:id')
  @RequirePermissions('transport.view')
  getRoute(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.routes.get(id, user);
  }

  @Post('routes')
  @RequirePermissions('transport.route.manage')
  createRoute(
    @Body() dto: UpsertRouteDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.routes.create(dto, user);
  }

  @Patch('routes/:id')
  @RequirePermissions('transport.route.manage')
  updateRoute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertRouteDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.routes.update(id, dto, user);
  }

  @Delete('routes/:id')
  @RequirePermissions('transport.route.manage')
  @HttpCode(204)
  async removeRoute(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.routes.remove(id, user);
  }

  @Post('routes/:id/stops')
  @RequirePermissions('transport.route.manage')
  addStop(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertStopDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.routes.addStop(id, dto, user);
  }

  @Patch('routes/:id/stops/:stopId')
  @RequirePermissions('transport.route.manage')
  updateStop(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stopId', ParseUUIDPipe) stopId: string,
    @Body() dto: UpsertStopDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.routes.updateStop(id, stopId, dto, user);
  }

  @Delete('routes/:id/stops/:stopId')
  @RequirePermissions('transport.route.manage')
  @HttpCode(204)
  async removeStop(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stopId', ParseUUIDPipe) stopId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.routes.removeStop(id, stopId, user);
  }

  @Put('routes/:id/stops/order')
  @RequirePermissions('transport.route.manage')
  @ApiOperation({ summary: 'Drag-to-reorder the stops on a route' })
  reorderStops(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderStopsDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.routes.reorderStops(id, dto, user);
  }

  // ── assignments ─────────────────────────────────────────────────────

  @Get('assignments')
  @RequirePermissions('transport.view')
  listAssignments(
    @Query() query: AssignmentQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.list(query, user);
  }

  @Get('assignments/:id')
  @RequirePermissions('transport.view')
  getAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.get(id, user);
  }

  @Post('assignments')
  @RequirePermissions('transport.assign')
  createAssignment(
    @Body() dto: CreateAssignmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.create(dto, user);
  }

  @Post('assignments/bulk')
  @RequirePermissions('transport.assign')
  @ApiOperation({ summary: 'Put a whole section on one route and stop' })
  bulkAssign(
    @Body() dto: BulkAssignDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.bulkAssign(dto, user);
  }

  @Post('assignments/reassign')
  @RequirePermissions('transport.assign')
  @ApiOperation({
    summary: 'Move riders between routes (route split/merge), fee-preserving',
  })
  reassign(
    @Body() dto: ReassignRouteDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.reassign(dto, user);
  }

  @Patch('assignments/:id')
  @RequirePermissions('transport.assign')
  updateAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssignmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.update(id, dto, user);
  }

  @Post('assignments/:id/suspend')
  @RequirePermissions('transport.assign')
  suspendAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendAssignmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.suspend(id, dto, user);
  }

  @Post('assignments/:id/resume')
  @RequirePermissions('transport.assign')
  resumeAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResumeAssignmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.resume(id, dto, user);
  }

  @Post('assignments/:id/end')
  @RequirePermissions('transport.assign')
  endAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndAssignmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.end(id, dto, user);
  }

  /** The student profile's Transport card (roadmap §5). */
  @Get('students/:studentId')
  @RequirePermissions('transport.view')
  @ApiOperation({ summary: "A student's live route and stop, or null" })
  forStudent(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query('sessionId') sessionId: string | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assignments.forStudent(studentId, user.schoolId, sessionId);
  }

  // ── expenses ────────────────────────────────────────────────────────

  @Get('expenses')
  @RequirePermissions('transport.view')
  listExpenses(
    @Query() query: ExpenseQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.expenses.list(query, user);
  }

  @Get('expenses/:id')
  @RequirePermissions('transport.view')
  getExpense(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.expenses.get(id, user);
  }

  @Post('expenses')
  @RequirePermissions('transport.expense.manage')
  createExpense(
    @Body() dto: UpsertExpenseDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.expenses.create(dto, user);
  }

  @Patch('expenses/:id')
  @RequirePermissions('transport.expense.manage')
  updateExpense(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertExpenseDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.expenses.update(id, dto, user);
  }

  @Delete('expenses/:id')
  @RequirePermissions('transport.expense.manage')
  removeExpense(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.expenses.remove(id, user);
  }
}
