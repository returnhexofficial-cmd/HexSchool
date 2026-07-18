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
  AdmissionCycleQueryDto,
  CreateAdmissionCycleDto,
  EnterTestMarksDto,
  GenerateMeritListDto,
  MeritListQueryDto,
  PromoteWaitlistDto,
  ScheduleTestsDto,
  UpdateAdmissionCycleDto,
} from '../dto';
import { AdmissionCyclesService } from '../services/admission-cycles.service';
import { AdmissionTestsService } from '../services/admission-tests.service';
import { MeritListService } from '../services/merit-list.service';

@ApiTags('admission')
@ApiBearerAuth()
@Controller('admission-cycles')
export class AdmissionCyclesController {
  constructor(
    private readonly cycles: AdmissionCyclesService,
    private readonly tests: AdmissionTestsService,
    private readonly merit: MeritListService,
  ) {}

  @Get()
  @RequirePermissions('admission.view')
  async list(
    @Query() query: AdmissionCycleQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.cycles.list(query, user.schoolId);
  }

  @Post()
  @RequirePermissions('admission.cycle.manage')
  @ApiOperation({ summary: 'Create a cycle with per-class seats and fees' })
  async create(
    @Body() dto: CreateAdmissionCycleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.cycles.create(dto, user);
  }

  @Get(':id')
  @RequirePermissions('admission.view')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.cycles.getDetail(id, user.schoolId);
  }

  @Put(':id')
  @RequirePermissions('admission.cycle.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdmissionCycleDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.cycles.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('admission.cycle.manage')
  @ApiOperation({ summary: 'Soft-delete (blocked once applications exist)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.cycles.remove(id, user);
    return { message: 'Admission cycle deleted' };
  }

  // ── lifecycle ─────────────────────────────────────────────────────

  @Post(':id/open')
  @RequirePermissions('admission.cycle.manage')
  async open(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.cycles.open(id, user);
  }

  @Post(':id/close')
  @RequirePermissions('admission.cycle.manage')
  @ApiOperation({
    summary: 'Close applications (unpaid PAYMENT_PENDING auto-cancelled)',
  })
  async close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.cycles.close(id, user);
  }

  @Post(':id/complete')
  @RequirePermissions('admission.cycle.manage')
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.cycles.complete(id, user);
  }

  // ── tests & marks ─────────────────────────────────────────────────

  @Put(':id/tests')
  @RequirePermissions('admission.test.manage')
  @ApiOperation({
    summary:
      'Schedule per-class test slots (paid applications move to TEST_SCHEDULED)',
  })
  async scheduleTests(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScheduleTestsDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.tests.schedule(id, dto, user);
  }

  @Post(':id/test-marks')
  @RequirePermissions('admission.test.manage')
  @ApiOperation({ summary: 'Bulk test-mark entry (grades PASSED/FAILED)' })
  async enterMarks(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnterTestMarksDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.tests.enterMarks(id, dto, user);
  }

  // ── merit & waiting lists ─────────────────────────────────────────

  @Post(':id/generate-merit-list')
  @RequirePermissions('admission.merit.generate')
  @ApiOperation({
    summary:
      'Rank a class (marks desc → GPA desc → dob asc); SELECTED up to seats, rest WAITLISTED. Regeneration voids the previous list.',
  })
  async generateMeritList(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateMeritListDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.merit.generate(id, dto.classId, user);
  }

  @Get(':id/merit-list')
  @RequirePermissions('admission.view')
  async meritList(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MeritListQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.merit.meritList(id, query.classId, user.schoolId);
  }

  @Get(':id/waiting-list')
  @RequirePermissions('admission.view')
  async waitingList(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MeritListQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.merit.waitingList(id, query.classId, user.schoolId);
  }

  @Post(':id/promote-waitlist')
  @RequirePermissions('admission.merit.generate')
  @ApiOperation({ summary: 'Promote the next N waitlisted candidates' })
  async promoteWaitlist(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PromoteWaitlistDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.merit.promoteNext(id, dto.classId, dto.count ?? 1, user);
  }
}
