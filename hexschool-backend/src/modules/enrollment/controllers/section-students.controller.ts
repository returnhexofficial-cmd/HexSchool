import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SkipEnvelope } from '../../../common/decorators/skip-envelope.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { IdCardService } from '../../student/services/id-card.service';
import { EnrollmentsService } from '../services/enrollments.service';

/**
 * Section-scoped roster endpoints (roadmap M11 §4): the canonical
 * "current students of section X" query, and the M09 debt closed here —
 * section-scoped batch ID cards now that rosters exist.
 */
@ApiTags('sections')
@ApiBearerAuth()
@Controller('sections')
export class SectionStudentsController {
  constructor(
    private readonly enrollments: EnrollmentsService,
    private readonly idCards: IdCardService,
  ) {}

  @Get(':id/students')
  @RequirePermissions('enrollment.view')
  @ApiOperation({ summary: 'Active roster of a section (roll order)' })
  async students(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.enrollments.getSectionStudents(id, user.schoolId);
  }

  @Post(':id/id-cards')
  @RequirePermissions('student.idcard.generate')
  @SkipEnvelope()
  @ApiOperation({ summary: 'Batch ID cards for a section roster (PDF)' })
  async idCardsForSection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const roster = await this.enrollments.getSectionStudents(id, user.schoolId);
    const studentIds = roster.map((e) => e.student.id);
    const { pdf, incomplete } = await this.idCards.generateBatch(
      studentIds,
      user,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="hexschool-section-id-cards.pdf"',
    );
    res.setHeader('X-Cards-Incomplete', String(incomplete.length));
    return new StreamableFile(pdf);
  }
}
