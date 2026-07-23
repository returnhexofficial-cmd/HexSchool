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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { NOTIFICATION_CODES } from '../communication.constants';
import {
  CreateTemplateDto,
  PreviewTemplateDto,
  UpdateTemplateDto,
} from '../dto';
import { TemplateService } from '../services/template.service';

@ApiTags('communication')
@ApiBearerAuth()
@Controller('notification-templates')
export class NotificationTemplatesController {
  constructor(private readonly templates: TemplateService) {}

  @Get('codes')
  @RequirePermissions('notification.view')
  @ApiOperation({
    summary: 'The notification-code catalog + allowed variables',
  })
  codes() {
    return NOTIFICATION_CODES;
  }

  @Get()
  @RequirePermissions('notification.view')
  list(@CurrentUser() user: AccessTokenPayload) {
    return this.templates.list(user.schoolId);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('notification.view')
  @ApiOperation({ summary: 'Render a body with sample vars + SMS part count' })
  preview(@Body() dto: PreviewTemplateDto) {
    return this.templates.preview(dto);
  }

  @Get(':id')
  @RequirePermissions('notification.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.templates.get(id, user.schoolId);
  }

  @Post()
  @RequirePermissions('notification.template.manage')
  create(
    @Body() dto: CreateTemplateDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.templates.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('notification.template.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.templates.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('notification.template.manage')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.templates.remove(id, user);
  }
}
