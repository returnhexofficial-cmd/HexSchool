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
  AccountQueryDto,
  CreateAccountDto,
  SuggestCodeQueryDto,
  UpdateAccountDto,
} from '../dto';
import { AccountsService } from '../services/accounts.service';

@ApiTags('accounting')
@ApiBearerAuth()
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequirePermissions('accounting.view')
  @ApiOperation({ summary: 'List accounts (flat, filterable)' })
  async list(
    @Query() query: AccountQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.accounts.list(query, user.schoolId);
  }

  @Get('tree')
  @RequirePermissions('accounting.view')
  @ApiOperation({ summary: 'The chart of accounts as a nested tree' })
  async tree(@CurrentUser() user: AccessTokenPayload) {
    return this.accounts.tree(user.schoolId);
  }

  @Get('suggest-code')
  @RequirePermissions('account.manage')
  @ApiOperation({ summary: 'Next free code for a group or under a parent' })
  async suggestCode(
    @Query() query: SuggestCodeQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.accounts.suggestCode(query, user.schoolId);
  }

  @Get(':id')
  @RequirePermissions('accounting.view')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.accounts.getById(id, user.schoolId);
  }

  @Post()
  @RequirePermissions('account.manage')
  @ApiOperation({ summary: 'Create an account or a heading' })
  async create(
    @Body() dto: CreateAccountDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.accounts.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('account.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.accounts.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('account.manage')
  @ApiOperation({
    summary: 'Delete an account (refused once anything is posted to it)',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.accounts.remove(id, user);
  }
}
