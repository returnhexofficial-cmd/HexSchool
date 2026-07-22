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
import { CreateExamTypeDto, UpdateExamTypeDto } from '../dto';
import { ExamTypesService } from '../services/exam-types.service';

@ApiTags('exam-types')
@ApiBearerAuth()
@Controller('exam-types')
export class ExamTypesController {
  constructor(private readonly examTypes: ExamTypesService) {}

  @Get()
  @RequirePermissions('exam.view')
  @ApiOperation({ summary: 'Exam types of the school' })
  async list(@CurrentUser() user: AccessTokenPayload) {
    return this.examTypes.list(user.schoolId);
  }

  @Get(':id')
  @RequirePermissions('exam.view')
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.examTypes.getById(id, user.schoolId);
  }

  @Post()
  @RequirePermissions('exam.type.manage')
  @ApiOperation({
    summary: 'Create an exam type ("Half Yearly", "Class Test")',
  })
  async create(
    @Body() dto: CreateExamTypeDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.examTypes.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('exam.type.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExamTypeDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.examTypes.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('exam.type.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an unused exam type' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.examTypes.remove(id, user);
  }
}
