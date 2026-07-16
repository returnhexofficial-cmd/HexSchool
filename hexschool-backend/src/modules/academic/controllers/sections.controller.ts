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
  CreateSectionDto,
  SectionListQueryDto,
  UpdateSectionDto,
} from '../dto';
import { SectionsService } from '../services/sections.service';

@ApiTags('sections')
@ApiBearerAuth()
@Controller('sections')
export class SectionsController {
  constructor(private readonly sections: SectionsService) {}

  @Get()
  @RequirePermissions('structure.view')
  @ApiOperation({ summary: 'List sections (filter by session/class)' })
  async list(
    @Query() query: SectionListQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.sections.list(query, user.schoolId);
  }

  @Post()
  @RequirePermissions('section.manage')
  @ApiOperation({
    summary: 'Create a section (identity unique; group level rule applies)',
  })
  async create(
    @Body() dto: CreateSectionDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.sections.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('section.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSectionDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.sections.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('section.manage')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.sections.remove(id, user);
    return { message: 'Section deleted' };
  }
}
