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
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CreateClassDto, UpdateClassDto, UpdateClassSubjectsDto } from '../dto';
import { ClassSubjectsService } from '../services/class-subjects.service';
import { MastersService } from '../services/masters.service';

@ApiTags('classes')
@ApiBearerAuth()
@Controller('classes')
export class ClassesController {
  constructor(
    private readonly masters: MastersService,
    private readonly classSubjects: ClassSubjectsService,
  ) {}

  @Get()
  @RequirePermissions('structure.view')
  async list(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.masters.listClasses(query, user.schoolId);
  }

  @Get(':id')
  @RequirePermissions('structure.view')
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.masters.getClass(id, user.schoolId);
  }

  @Post()
  @RequirePermissions('class.manage')
  async create(
    @Body() dto: CreateClassDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.masters.createClass(dto, user);
  }

  @Put(':id')
  @RequirePermissions('class.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.masters.updateClass(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('class.manage')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.masters.removeClass(id, user);
    return { message: 'Class deleted' };
  }

  // ── Curriculum mapping (roadmap M06 §APIs) ─────────────────────────

  @Get(':id/subjects')
  @RequirePermissions('structure.view')
  @ApiOperation({ summary: "A class's subject mapping for one session" })
  async getSubjects(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.classSubjects.getForClass(id, sessionId, user.schoolId);
  }

  @Put(':id/subjects')
  @RequirePermissions('class.subject.assign')
  @ApiOperation({
    summary: 'Replace the subject mapping (bulk assign; order = display order)',
  })
  async setSubjects(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassSubjectsDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.classSubjects.replaceForClass(id, dto, user);
  }
}
