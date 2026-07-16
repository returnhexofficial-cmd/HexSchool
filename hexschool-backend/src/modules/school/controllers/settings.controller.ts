import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { SettingsGroup } from '../../../common/constants';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { Audit } from '../../audit/decorators/audit.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { TestEmailDto, TestSmsDto } from '../dto';
import { SettingsService } from '../services/settings.service';
import { SettingsTestService } from '../services/settings-test.service';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly tester: SettingsTestService,
  ) {}

  // Static routes are declared BEFORE the :group param routes so the
  // router never swallows "test-email" as a group name.

  @Post('test-email')
  @RequirePermissions('settings.test')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'UPDATE', entityType: 'SchoolSettings' })
  @ApiOperation({ summary: 'Send a test email using the SAVED email settings' })
  async testEmail(
    @Body() dto: TestEmailDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.tester.testEmail(user, dto.to);
  }

  @Post('test-sms')
  @RequirePermissions('settings.test')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'UPDATE', entityType: 'SchoolSettings' })
  @ApiOperation({ summary: 'Send a test SMS (log-only until Module 17)' })
  async testSms(
    @Body() dto: TestSmsDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.tester.testSms(user, dto.to);
  }

  @Get(':group')
  @RequirePermissions('settings.view')
  @ApiParam({ name: 'group', enum: SettingsGroup })
  @ApiOperation({
    summary: 'Settings of one group (defaults merged, secrets masked)',
  })
  async getGroup(
    @Param('group', new ParseEnumPipe(SettingsGroup)) group: SettingsGroup,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.settings.getGroup(user.schoolId, group);
  }

  @Put(':group')
  @RequirePermissions('settings.update')
  @ApiParam({ name: 'group', enum: SettingsGroup })
  @ApiOperation({
    summary:
      'Update settings of one group (registry-validated; SECRET_MASK keeps a stored secret)',
  })
  async updateGroup(
    @Param('group', new ParseEnumPipe(SettingsGroup)) group: SettingsGroup,
    // Free-form map — validated key-by-key against the settings registry
    // in the service (per-group "Zod-like" validation, roadmap M04 §7).
    @Body() payload: Record<string, unknown>,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.settings.updateGroup(user.schoolId, group, payload, user);
  }
}
