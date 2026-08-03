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
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  AllocationQueryDto,
  BulkAllocateDto,
  CreateAllocationDto,
  GenerateBedsDto,
  HostelQueryDto,
  RefundDepositDto,
  ResumeAllocationDto,
  RoomQueryDto,
  SuspendAllocationDto,
  TransferAllocationDto,
  UpdateAllocationDto,
  UpsertBedDto,
  UpsertHostelDto,
  UpsertRoomDto,
  VacateAllocationDto,
} from '../dto';
import { HostelAllocationsService } from '../services/hostel-allocations.service';
import { HostelsService } from '../services/hostels.service';

/**
 * Roadmap §4's `CRUD /api/v1/hostels (+rooms +beds nested)`. Rooms and
 * beds are nested because neither means anything outside its parent: a
 * room belongs to a building and a bed belongs to a room, and a top-level
 * `/beds` would invite exactly the cross-hostel confusion the composite
 * foreign keys exist to prevent.
 */
@ApiTags('hostel')
@ApiBearerAuth()
@Controller('hostels')
export class HostelController {
  constructor(private readonly hostels: HostelsService) {}

  @Get()
  @RequirePermissions('hostel.view')
  @ApiOperation({ summary: 'Every hostel, with live occupancy beside it' })
  list(
    @Query() query: HostelQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.hostels.list(query, user);
  }

  @Get(':id')
  @RequirePermissions('hostel.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.hostels.get(id, user);
  }

  @Post()
  @RequirePermissions('hostel.manage')
  create(
    @Body() dto: UpsertHostelDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.hostels.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('hostel.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertHostelDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.hostels.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('hostel.manage')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.hostels.remove(id, user);
  }

  // ── rooms ───────────────────────────────────────────────────────────

  @Get(':id/rooms')
  @RequirePermissions('hostel.view')
  @ApiOperation({ summary: 'Rooms with their beds — the occupancy grid' })
  listRooms(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: RoomQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.hostels.listRooms(id, query, user);
  }

  @Post(':id/rooms')
  @RequirePermissions('hostel.manage')
  @ApiOperation({ summary: 'Create a room and generate its beds' })
  createRoom(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertRoomDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.hostels.createRoom(id, dto, user);
  }

  @Get('rooms/:roomId')
  @RequirePermissions('hostel.view')
  getRoom(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.hostels.getRoom(roomId, user);
  }

  @Patch('rooms/:roomId')
  @RequirePermissions('hostel.manage')
  updateRoom(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: UpsertRoomDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.hostels.updateRoom(roomId, dto, user);
  }

  @Delete('rooms/:roomId')
  @RequirePermissions('hostel.manage')
  @HttpCode(204)
  async removeRoom(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.hostels.removeRoom(roomId, user);
  }

  // ── beds ────────────────────────────────────────────────────────────

  @Post('rooms/:roomId/beds')
  @RequirePermissions('hostel.manage')
  @ApiOperation({ summary: 'Bulk-generate beds for an existing room' })
  generateBeds(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: GenerateBedsDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.hostels.generateBeds(roomId, dto, user);
  }

  @Patch('beds/:bedId')
  @RequirePermissions('hostel.manage')
  updateBed(
    @Param('bedId', ParseUUIDPipe) bedId: string,
    @Body() dto: UpsertBedDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.hostels.updateBed(bedId, dto, user);
  }

  @Delete('beds/:bedId')
  @RequirePermissions('hostel.manage')
  @HttpCode(204)
  async removeBed(
    @Param('bedId', ParseUUIDPipe) bedId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.hostels.removeBed(bedId, user);
  }
}

/**
 * Roadmap §4's
 * `POST /api/v1/hostel-allocations (+ /:id/vacate|transfer|suspend)`.
 *
 * The lifecycle verbs are separate endpoints rather than a status field
 * on a PATCH, because each of them means something different, each writes
 * a different date, and two of them need a different permission. A single
 * "set status" route would put vacating a boarder and moving them one
 * room over behind the same check.
 */
@ApiTags('hostel')
@ApiBearerAuth()
@Controller('hostel-allocations')
export class HostelAllocationsController {
  constructor(private readonly allocations: HostelAllocationsService) {}

  @Get()
  @RequirePermissions('hostel.view')
  list(
    @Query() query: AllocationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.allocations.list(query, user);
  }

  @Get(':id')
  @RequirePermissions('hostel.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.allocations.get(id, user);
  }

  @Post()
  @RequirePermissions('hostel.allocate')
  @ApiOperation({ summary: 'Give a student a bed' })
  create(
    @Body() dto: CreateAllocationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.allocations.create(dto, user);
  }

  @Post('bulk')
  @RequirePermissions('hostel.allocate')
  @ApiOperation({ summary: 'Fill a hostel from a list of students' })
  bulk(@Body() dto: BulkAllocateDto, @CurrentUser() user: AccessTokenPayload) {
    return this.allocations.bulkAllocate(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('hostel.allocate')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAllocationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.allocations.update(id, dto, user);
  }

  @Post(':id/transfer')
  @RequirePermissions('hostel.allocate')
  @ApiOperation({ summary: 'Move a boarder to another bed, dates unchanged' })
  transfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferAllocationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.allocations.transfer(id, dto, user);
  }

  @Post(':id/suspend')
  @RequirePermissions('hostel.allocate')
  @ApiOperation({ summary: 'Pause billing; the bed is still theirs' })
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendAllocationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.allocations.suspend(id, dto, user);
  }

  @Post(':id/resume')
  @RequirePermissions('hostel.allocate')
  resume(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResumeAllocationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.allocations.resume(id, dto, user);
  }

  @Post(':id/vacate')
  @RequirePermissions('hostel.vacate')
  @ApiOperation({ summary: 'Release the bed, with the dues clearance check' })
  vacate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VacateAllocationDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.allocations.vacate(id, dto, user);
  }

  @Post(':id/refund-deposit')
  @RequirePermissions('hostel.deposit.refund')
  @ApiOperation({
    summary: 'Record the deposit going back — the accountant’s half',
  })
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundDepositDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.allocations.refundDeposit(id, dto, user);
  }
}
