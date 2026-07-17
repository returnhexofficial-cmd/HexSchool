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
  CreateGuardianDto,
  CreatePortalAccountDto,
  GuardianQueryDto,
  UpdateGuardianDto,
} from '../dto';
import { GuardiansService } from '../services/guardians.service';
import { StudentAccountsService } from '../services/student-accounts.service';

@ApiTags('guardians')
@ApiBearerAuth()
@Controller('guardians')
export class GuardiansController {
  constructor(
    private readonly guardians: GuardiansService,
    private readonly accounts: StudentAccountsService,
  ) {}

  @Get()
  @RequirePermissions('guardian.view')
  @ApiOperation({
    summary: 'Guardian list (?phone= is the exact-match dedup probe)',
  })
  async list(
    @Query() query: GuardianQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.guardians.list(query, user.schoolId);
  }

  @Get(':id')
  @RequirePermissions('guardian.view')
  @ApiOperation({ summary: 'Guardian detail (children listed)' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.guardians.getDetail(id, user.schoolId);
  }

  @Post()
  @RequirePermissions('guardian.manage')
  @ApiOperation({ summary: 'Create guardian (phone is the dedup key)' })
  async create(
    @Body() dto: CreateGuardianDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.guardians.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('guardian.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGuardianDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.guardians.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('guardian.manage')
  @ApiOperation({ summary: 'Soft-delete (blocked while children are linked)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.guardians.remove(id, user);
    return { message: 'Guardian deleted' };
  }

  @Post(':id/create-account')
  @RequirePermissions('student.account.create')
  @ApiOperation({
    summary:
      'Provision the parent portal account (defaults to the stored phone)',
  })
  async createAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePortalAccountDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.accounts.createGuardianAccount(id, dto, user);
  }
}
