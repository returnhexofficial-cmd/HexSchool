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
import { BadRequestException } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  ClosePeriodDto,
  CreateBudgetDto,
  CreateFiscalPeriodDto,
  ReopenPeriodDto,
  UpdateBudgetDto,
  UpdateFiscalPeriodDto,
} from '../dto';
import { BudgetService } from '../services/budget.service';
import { FiscalPeriodService } from '../services/fiscal-period.service';

@ApiTags('accounting')
@ApiBearerAuth()
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetService) {}

  @Get()
  @RequirePermissions('accounting.view')
  @ApiOperation({ summary: 'Budget lines for one academic session' })
  async list(
    @Query('sessionId') sessionId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    if (!sessionId) {
      throw new BadRequestException(
        'sessionId is required — a budget is set per academic session',
      );
    }
    return this.budgets.list(sessionId, user.schoolId);
  }

  @Post()
  @RequirePermissions('budget.manage')
  async create(
    @Body() dto: CreateBudgetDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.budgets.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('budget.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBudgetDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.budgets.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('budget.manage')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.budgets.remove(id, user);
  }
}

@ApiTags('accounting')
@ApiBearerAuth()
@Controller('fiscal-periods')
export class FiscalPeriodsController {
  constructor(private readonly periods: FiscalPeriodService) {}

  @Get()
  @RequirePermissions('accounting.view')
  async list(@CurrentUser() user: AccessTokenPayload) {
    return this.periods.list(user.schoolId);
  }

  @Post()
  @RequirePermissions('accounting.period.manage')
  async create(
    @Body() dto: CreateFiscalPeriodDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.periods.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('accounting.period.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFiscalPeriodDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.periods.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('accounting.period.manage')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.periods.remove(id, user);
  }

  @Post(':id/close')
  @RequirePermissions('accounting.period.manage')
  @ApiOperation({
    summary: 'Close a period — locks every voucher dated inside it',
  })
  async close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClosePeriodDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.periods.close(id, dto, user);
  }

  @Post(':id/reopen')
  @RequirePermissions('accounting.period.reopen')
  @ApiOperation({ summary: 'Reopen a closed period (reason mandatory)' })
  async reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReopenPeriodDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.periods.reopen(id, dto, user);
  }
}
