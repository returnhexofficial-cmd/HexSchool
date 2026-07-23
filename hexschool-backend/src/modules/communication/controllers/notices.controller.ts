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
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CreateNoticeDto, PublishNoticeDto, UpdateNoticeDto } from '../dto';
import { NoticeService } from '../services/notice.service';

@ApiTags('communication')
@ApiBearerAuth()
@Controller('notices')
export class NoticesController {
  constructor(private readonly notices: NoticeService) {}

  @Get()
  @RequirePermissions('notice.view')
  list(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.notices.list(user.schoolId, query);
  }

  @Get('feed')
  @RequirePermissions('notice.view')
  @ApiOperation({ summary: 'Published notice feed (portal board)' })
  feed(@CurrentUser() user: AccessTokenPayload) {
    return this.notices.feed(user.schoolId);
  }

  @Get(':id')
  @RequirePermissions('notice.view')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.notices.get(id, user.schoolId);
  }

  @Post()
  @RequirePermissions('notice.manage')
  create(
    @Body() dto: CreateNoticeDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.notices.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('notice.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoticeDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.notices.update(id, dto, user);
  }

  @Put(':id/publish')
  @RequirePermissions('notice.publish')
  @ApiOperation({ summary: 'Publish or unpublish a notice' })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishNoticeDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.notices.setPublished(id, dto.publish, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('notice.manage')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.notices.remove(id, user);
  }
}
