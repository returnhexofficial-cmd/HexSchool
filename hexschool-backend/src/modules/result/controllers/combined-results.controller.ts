import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CombinedResultQueryDto, GenerateCombinedResultDto } from '../dto';
import { CombinedResultsService } from '../services/combined-results.service';

@ApiTags('results')
@ApiBearerAuth()
@Controller('combined-results')
export class CombinedResultsController {
  constructor(private readonly combined: CombinedResultsService) {}

  @Get('batches')
  @RequirePermissions('result.view')
  @ApiOperation({ summary: 'Named merges of a session, newest first' })
  async batches(
    @Query('sessionId') sessionId: string | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.combined.listBatches(sessionId, user.schoolId);
  }

  @Get()
  @RequirePermissions('result.view')
  @ApiOperation({ summary: 'Rows of one combined-result batch' })
  async list(
    @Query() query: CombinedResultQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.combined.getBatch(query, user.schoolId);
  }

  @Post('generate')
  @RequirePermissions('result.combine')
  @ApiOperation({
    summary: 'Weighted merge of several exams (weights must sum to 100)',
  })
  async generate(
    @Body() dto: GenerateCombinedResultDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.combined.generate(dto, user);
  }

  @Delete()
  @RequirePermissions('result.combine')
  @ApiOperation({ summary: 'Discard a combined-result batch' })
  async remove(
    @Query() query: CombinedResultQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.combined.removeBatch(query, user);
  }
}
