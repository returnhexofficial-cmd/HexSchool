import {
  Body,
  Controller,
  Delete,
  Get,
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
  CreatePromotionBatchDto,
  ExecutePromotionDto,
  PromotionQueryDto,
  UpdatePromotionItemsDto,
} from '../dto';
import { PromotionService } from '../services/promotion.service';

@ApiTags('promotions')
@ApiBearerAuth()
@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotions: PromotionService) {}

  @Get()
  @RequirePermissions('promotion.view')
  async list(
    @Query() query: PromotionQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.promotions.list(query, user.schoolId);
  }

  @Post()
  @RequirePermissions('promotion.manage')
  @ApiOperation({
    summary: 'Build a DRAFT promotion batch (candidates + auto decisions)',
  })
  async create(
    @Body() dto: CreatePromotionBatchDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.promotions.create(dto, user);
  }

  @Get(':id')
  @RequirePermissions('promotion.view')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.promotions.getDetail(id, user.schoolId);
  }

  @Get(':id/preview')
  @RequirePermissions('promotion.view')
  @ApiOperation({
    summary: 'Decision counts + target-section distribution + warnings',
  })
  async preview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.promotions.preview(id, user.schoolId);
  }

  @Put(':id/items')
  @RequirePermissions('promotion.manage')
  @ApiOperation({ summary: 'Edit per-student decisions (DRAFT only)' })
  async updateItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromotionItemsDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.promotions.updateItems(id, dto, user);
  }

  @Post(':id/execute')
  @RequirePermissions('promotion.execute')
  @ApiOperation({
    summary: 'Execute the batch (close old + create new enrollments)',
  })
  async execute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExecutePromotionDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.promotions.execute(id, dto, user);
  }

  @Post(':id/rollback')
  @RequirePermissions('promotion.execute')
  @ApiOperation({
    summary:
      'Roll back an executed batch (blocked once new-session data exists)',
  })
  async rollback(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.promotions.rollback(id, user);
    return { message: 'Promotion batch rolled back' };
  }

  @Delete(':id')
  @RequirePermissions('promotion.manage')
  @ApiOperation({ summary: 'Delete a DRAFT batch' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.promotions.remove(id, user);
    return { message: 'Promotion batch deleted' };
  }
}
