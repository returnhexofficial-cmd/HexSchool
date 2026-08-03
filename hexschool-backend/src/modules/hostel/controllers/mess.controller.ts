import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  CreateMealOffDto,
  CreateMessEnrollmentDto,
  DecideMealOffDto,
  EndMessEnrollmentDto,
  MealOffQueryDto,
  MessEnrollmentQueryDto,
  MessPlanQueryDto,
  UpdateMealOffDto,
  UpsertMessPlanDto,
} from '../dto';
import { MessService } from '../services/mess.service';

/** Roadmap §4's `CRUD /api/v1/mess-plans`. */
@ApiTags('hostel')
@ApiBearerAuth()
@Controller('mess-plans')
export class MessPlansController {
  constructor(private readonly mess: MessService) {}

  @Get()
  @RequirePermissions('hostel.view')
  list(
    @Query() query: MessPlanQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.mess.listPlans(query, user);
  }

  @Post()
  @RequirePermissions('hostel.mess.manage')
  create(
    @Body() dto: UpsertMessPlanDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.mess.createPlan(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('hostel.mess.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertMessPlanDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.mess.updatePlan(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('hostel.mess.manage')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.mess.removePlan(id, user);
  }
}

/** Roadmap §4's `CRUD /api/v1/mess-enrollments`. */
@ApiTags('hostel')
@ApiBearerAuth()
@Controller('mess-enrollments')
export class MessEnrollmentsController {
  constructor(private readonly mess: MessService) {}

  @Get()
  @RequirePermissions('hostel.view')
  list(
    @Query() query: MessEnrollmentQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.mess.listEnrollments(query, user);
  }

  @Post()
  @RequirePermissions('hostel.mess.manage')
  @ApiOperation({
    summary: 'Put a boarder on a plan; changing plan closes the old window',
  })
  create(
    @Body() dto: CreateMessEnrollmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.mess.enroll(dto, user);
  }

  @Post(':id/end')
  @RequirePermissions('hostel.mess.manage')
  end(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndMessEnrollmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.mess.endEnrollment(id, dto, user);
  }
}

/** Roadmap §4's `CRUD /api/v1/meal-offs (+approve)`. */
@ApiTags('hostel')
@ApiBearerAuth()
@Controller('meal-offs')
export class MealOffsController {
  constructor(private readonly mess: MessService) {}

  @Get()
  @RequirePermissions('hostel.view')
  @ApiOperation({ summary: 'The approval inbox' })
  list(
    @Query() query: MealOffQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.mess.listMealOffs(query, user);
  }

  @Post()
  @RequirePermissions('hostel.mess.manage')
  create(
    @Body() dto: CreateMealOffDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.mess.requestMealOff(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('hostel.mess.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMealOffDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.mess.updateMealOff(id, dto, user);
  }

  @Post(':id/approve')
  @RequirePermissions('hostel.mealoff.approve')
  @ApiOperation({
    summary: 'Approve or refuse — approval fixes the credit month',
  })
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideMealOffDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.mess.decideMealOff(id, dto, user);
  }

  @Post(':id/cancel')
  @RequirePermissions('hostel.mess.manage')
  @ApiOperation({ summary: 'Withdraw a request — not the same as refusing it' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.mess.cancelMealOff(id, user);
  }
}
