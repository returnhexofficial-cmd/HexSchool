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
  BulkEnrollDto,
  CancelEnrollmentDto,
  CreateEnrollmentDto,
  EnrollableQueryDto,
  EnrollmentQueryDto,
  RollAssignDto,
  TransferSectionDto,
  UpdateEnrollmentDto,
} from '../dto';
import { EnrollmentsService } from '../services/enrollments.service';

@ApiTags('enrollments')
@ApiBearerAuth()
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get()
  @RequirePermissions('enrollment.view')
  @ApiOperation({
    summary:
      'List enrollments (filter by session/section/class/student/status)',
  })
  async list(
    @Query() query: EnrollmentQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.enrollments.list(query, user.schoolId);
  }

  @Get('enrollable')
  @RequirePermissions('enrollment.view')
  @ApiOperation({
    summary: 'Students with no live enrollment in the session (picker source)',
  })
  async enrollable(
    @Query() query: EnrollableQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.enrollments.listEnrollable(query, user.schoolId);
  }

  @Post()
  @RequirePermissions('enrollment.create')
  @ApiOperation({
    summary: 'Enroll one student into a section (auto/explicit roll)',
  })
  async enroll(
    @Body() dto: CreateEnrollmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.enrollments.enroll(dto, user);
  }

  @Post('bulk')
  @RequirePermissions('enrollment.create')
  @ApiOperation({
    summary: 'Enroll many students into one section (skips already-enrolled)',
  })
  async bulk(
    @Body() dto: BulkEnrollDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.enrollments.bulkEnroll(dto, user);
  }

  @Post('roll-assign')
  @RequirePermissions('enrollment.roll.assign')
  @ApiOperation({
    summary: 'Re-number a whole section (sequential/alphabetical)',
  })
  async rollAssign(
    @Body() dto: RollAssignDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.enrollments.rollAssign(dto, user);
  }

  @Get(':id')
  @RequirePermissions('enrollment.view')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.enrollments.getDetail(id, user.schoolId);
  }

  @Get(':id/transfers')
  @RequirePermissions('enrollment.view')
  @ApiOperation({ summary: 'Section-transfer history of an enrollment' })
  async transfers(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.enrollments.transferHistory(id, user.schoolId);
  }

  @Put(':id')
  @RequirePermissions('enrollment.update')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEnrollmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.enrollments.update(id, dto, user);
  }

  @Post(':id/transfer-section')
  @RequirePermissions('enrollment.transfer')
  @ApiOperation({
    summary: 'Transfer to another section of the same class/session',
  })
  async transferSection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferSectionDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.enrollments.transferSection(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('enrollment.delete')
  @ApiOperation({
    summary: 'Cancel an enrollment (frees the session slot + roll)',
  })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelEnrollmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.enrollments.cancel(id, dto, user);
    return { message: 'Enrollment cancelled' };
  }
}
