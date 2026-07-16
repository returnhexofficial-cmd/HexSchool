import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CreateGradingSystemDto, UpdateGradingSystemDto } from '../dto';
import { GradingSystemsService } from '../services/grading-systems.service';

@ApiTags('grading-systems')
@ApiBearerAuth()
@Controller('grading-systems')
export class GradingSystemsController {
  constructor(private readonly grading: GradingSystemsService) {}

  @Get()
  @RequirePermissions('grading.view')
  @ApiOperation({ summary: 'All grading systems with their grade bands' })
  async list(@CurrentUser() user: AccessTokenPayload) {
    return this.grading.list(user.schoolId);
  }

  @Post()
  @RequirePermissions('grading.create')
  @ApiOperation({
    summary:
      'Create a grading system (bands must not overlap; default needs 0–100 coverage)',
  })
  async create(
    @Body() dto: CreateGradingSystemDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.grading.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('grading.update')
  @ApiOperation({
    summary: 'Edit a grading system / replace bands / set default',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGradingSystemDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.grading.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('grading.delete')
  @ApiOperation({ summary: 'Soft-delete a grading system (default: 409)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.grading.remove(id, user);
    return { message: 'Grading system deleted' };
  }
}
