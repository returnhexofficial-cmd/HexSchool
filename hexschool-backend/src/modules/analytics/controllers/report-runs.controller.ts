import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { ReportRunQueryDto } from '../dto';
import { ReportRunsService } from '../services/report-runs.service';

/**
 * Roadmap §4's export centre: `GET /report-runs (+/:id)`.
 *
 * No permission code on these routes, for the same reason M18's portal
 * routes carry none: **ownership is the authorization**. A run belongs to
 * whoever asked for it, `ReportRunsService` enforces that and re-checks
 * the report's own permission on read, and a code here could only be a
 * coarser second answer to a question the service already answers exactly.
 */
@ApiTags('report-runs')
@ApiBearerAuth()
@Controller('report-runs')
export class ReportRunsController {
  constructor(private readonly runs: ReportRunsService) {}

  @Get()
  @ApiOperation({ summary: 'My exports — status, size and download state' })
  list(
    @Query() query: ReportRunQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.runs.list(user.schoolId, query, query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One run' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.runs.findOne(id, user.schoolId, user);
  }

  /**
   * A freshly signed URL rather than the file itself.
   *
   * Streaming it through the API would put every export's bytes through
   * the Node process a second time — the file is already in S3, and a
   * signed redirect is what object storage is for.
   */
  @Get(':id/download')
  @ApiOperation({ summary: 'A short-lived signed URL for the file' })
  download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.runs.download(id, user.schoolId, user);
  }

  @Post(':id/rerun')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Run the same report again with the same params' })
  rerun(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.runs.rerun(id, user.schoolId, user);
  }
}
