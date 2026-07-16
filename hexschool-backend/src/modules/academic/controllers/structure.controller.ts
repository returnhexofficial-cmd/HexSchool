import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CloneStructureDto } from '../dto';
import { StructureCloneService } from '../services/structure-clone.service';

@ApiTags('academic-structure')
@ApiBearerAuth()
@Controller('academic-structure')
export class StructureController {
  constructor(private readonly cloner: StructureCloneService) {}

  @Post('clone')
  @RequirePermissions('structure.clone')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Clone sections + class-subject maps to another session (preview: true = dry run)',
  })
  async clone(
    @Body() dto: CloneStructureDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.cloner.clone(dto, user);
  }
}
