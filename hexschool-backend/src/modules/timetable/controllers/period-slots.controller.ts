import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  CreatePeriodSlotDto,
  PeriodSlotQueryDto,
  UpdatePeriodSlotDto,
} from '../dto';
import { PeriodSlotsService } from '../services/period-slots.service';

@ApiTags('period-slots')
@ApiBearerAuth()
@Controller('period-slots')
export class PeriodSlotsController {
  constructor(private readonly slots: PeriodSlotsService) {}

  @Get()
  @RequirePermissions('timetable.view')
  @ApiOperation({
    summary: 'Bell schedule of a shift (omit shiftId for every shift)',
  })
  async list(
    @Query() query: PeriodSlotQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.slots.list(query.shiftId, user.schoolId);
  }

  @Get(':id')
  @RequirePermissions('timetable.view')
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.slots.getById(id, user.schoolId);
  }

  @Post()
  @RequirePermissions('period.slot.manage')
  @ApiOperation({
    summary: 'Add a period (validated against the shift window and siblings)',
  })
  async create(
    @Body() dto: CreatePeriodSlotDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.slots.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('period.slot.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePeriodSlotDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.slots.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('period.slot.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Retire a period — refused while routine cells or marks use it',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.slots.remove(id, user);
  }
}
