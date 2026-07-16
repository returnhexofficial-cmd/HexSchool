import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  CreateHolidayDto,
  SessionScopedListQueryDto,
  UpdateHolidayDto,
} from '../dto';
import { HolidaysService } from '../services/holidays.service';

class ImportHolidaysDto {
  @IsUUID()
  sessionId!: string;
}

const CSV_MAX_BYTES = 256 * 1024;

@ApiTags('holidays')
@ApiBearerAuth()
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  @Get()
  @RequirePermissions('calendar.view')
  @ApiOperation({ summary: 'List holidays (filter by session)' })
  async list(
    @Query() query: SessionScopedListQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.holidays.list(query, user.schoolId);
  }

  @Post()
  @RequirePermissions('holiday.create')
  @ApiOperation({ summary: 'Add a holiday (must fall within its session)' })
  async create(
    @Body() dto: CreateHolidayDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.holidays.create(dto, user);
  }

  @Post('import')
  @RequirePermissions('holiday.import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        sessionId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiOperation({
    summary:
      'Bulk-import holidays from CSV (title,start_date,end_date,type,applies_to) — row-level error report',
  })
  async importCsv(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: ImportHolidaysDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    if (!file) throw new BadRequestException('CSV file is required');
    if (file.size > CSV_MAX_BYTES) {
      throw new BadRequestException('CSV must be 256 KB or smaller');
    }
    return this.holidays.importCsv(
      dto.sessionId,
      file.buffer.toString('utf8'),
      user,
    );
  }

  @Put(':id')
  @RequirePermissions('holiday.update')
  @ApiOperation({ summary: 'Edit a holiday' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHolidayDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.holidays.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('holiday.delete')
  @ApiOperation({ summary: 'Remove a holiday (hard delete; audited)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.holidays.remove(id, user);
    return { message: 'Holiday removed' };
  }
}
