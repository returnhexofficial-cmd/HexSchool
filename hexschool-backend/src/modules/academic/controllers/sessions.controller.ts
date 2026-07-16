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
import { CreateSessionDto, UpdateSessionDto } from '../dto';
import { SessionsService } from '../services/sessions.service';

@ApiTags('academic-sessions')
@ApiBearerAuth()
@Controller('academic-sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  @RequirePermissions('session.view')
  @ApiOperation({ summary: 'List academic sessions' })
  async list(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.sessions.list(query, user.schoolId);
  }

  /** The current session — consumed by the frontend session switcher. */
  @Get('current')
  @RequirePermissions('session.view')
  @ApiOperation({ summary: 'The current academic session (null if unset)' })
  async current(@CurrentUser() user: AccessTokenPayload) {
    return this.sessions.getCurrent(user.schoolId);
  }

  @Get(':id')
  @RequirePermissions('session.view')
  @ApiOperation({ summary: 'One academic session' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.sessions.getById(id, user.schoolId);
  }

  @Post()
  @RequirePermissions('session.create')
  @ApiOperation({ summary: 'Create an academic session (no date overlap)' })
  async create(
    @Body() dto: CreateSessionDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.sessions.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('session.update')
  @ApiOperation({
    summary:
      'Edit a session (date corrections blocked while rows fall outside)',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSessionDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.sessions.update(id, dto, user);
  }

  @Post(':id/activate')
  @RequirePermissions('session.activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Make this the current session (transactional demote/promote)',
  })
  async activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.sessions.activate(id, user);
  }

  @Delete(':id')
  @RequirePermissions('session.delete')
  @ApiOperation({
    summary: 'Soft-delete a session (blocked when current or referenced)',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.sessions.remove(id, user);
    return { message: 'Session deleted' };
  }
}
