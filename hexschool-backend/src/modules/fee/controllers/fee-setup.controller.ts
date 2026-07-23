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
  CloneFeeStructuresDto,
  CreateFeeHeadDto,
  CreateFeeOverrideDto,
  FeeStructureQueryDto,
  SaveFeeStructuresDto,
  UpdateFeeHeadDto,
  UpdateFeeOverrideDto,
} from '../dto';
import { FeeSetupService } from '../services/fee-setup.service';

@ApiTags('fees')
@ApiBearerAuth()
@Controller('fee-heads')
export class FeeHeadsController {
  constructor(private readonly setup: FeeSetupService) {}

  @Get()
  @RequirePermissions('fee.view')
  @ApiOperation({ summary: 'Fee heads in display order' })
  async list(@CurrentUser() user: AccessTokenPayload) {
    return this.setup.listHeads(user.schoolId);
  }

  @Post()
  @RequirePermissions('fee.setup')
  async create(
    @Body() dto: CreateFeeHeadDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.setup.createHead(dto, user);
  }

  @Put(':id')
  @RequirePermissions('fee.setup')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFeeHeadDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.setup.updateHead(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('fee.setup')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a head that has never been billed' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.setup.removeHead(id, user);
  }
}

@ApiTags('fees')
@ApiBearerAuth()
@Controller('fee-structures')
export class FeeStructuresController {
  constructor(private readonly setup: FeeSetupService) {}

  @Get()
  @RequirePermissions('fee.view')
  @ApiOperation({ summary: 'The class × head amount matrix for a session' })
  async list(
    @Query() query: FeeStructureQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.setup.listStructures(query, user.schoolId);
  }

  @Put()
  @RequirePermissions('fee.setup')
  @ApiOperation({
    summary: 'Bulk-save matrix cells (rows absent from the payload are kept)',
  })
  async save(
    @Body() dto: SaveFeeStructuresDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.setup.saveStructures(dto, user);
  }

  @Post('clone')
  @RequirePermissions('fee.setup')
  @ApiOperation({
    summary: 'Copy a session’s structures into another, optionally raising them',
  })
  async clone(
    @Body() dto: CloneFeeStructuresDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.setup.cloneStructures(dto, user);
  }

  @Delete(':id')
  @RequirePermissions('fee.setup')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.setup.removeStructure(id, user);
  }
}

@ApiTags('fees')
@ApiBearerAuth()
@Controller('fee-overrides')
export class FeeOverridesController {
  constructor(private readonly setup: FeeSetupService) {}

  @Get()
  @RequirePermissions('fee.view')
  @ApiOperation({ summary: 'Concessions held by one candidate' })
  async list(@Query('enrollmentId', ParseUUIDPipe) enrollmentId: string) {
    return this.setup.listOverrides(enrollmentId);
  }

  @Post()
  @RequirePermissions('fee.override.manage')
  @ApiOperation({
    summary: 'Record a discount, scholarship or waiver (reason required)',
  })
  async create(
    @Body() dto: CreateFeeOverrideDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.setup.createOverride(dto, user);
  }

  @Put(':id')
  @RequirePermissions('fee.override.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFeeOverrideDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.setup.updateOverride(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('fee.override.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.setup.removeOverride(id, user);
  }
}
