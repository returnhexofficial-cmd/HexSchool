import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { DEFAULT_SCHOOL_ID } from '../../../common/constants';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SkipAudit } from '../../audit/decorators/audit.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  CollectPageViewDto,
  ExecutiveQueryDto,
  RefreshViewsDto,
  SiteAnalyticsQueryDto,
} from '../dto';
import { ExecutiveAnalyticsService } from '../services/executive-analytics.service';
import { MaterializedViewService } from '../services/materialized-view.service';
import { SiteAnalyticsService } from '../services/site-analytics.service';

/** Roadmap §4's analytics endpoints. */
@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly executive: ExecutiveAnalyticsService,
    private readonly site: SiteAnalyticsService,
    private readonly views: MaterializedViewService,
  ) {}

  @Get('executive')
  @RequirePermissions('analytics.view')
  @ApiOperation({ summary: 'The whole executive dashboard in one call' })
  executiveDashboard(
    @Query() query: ExecutiveQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.executive.executive(
      user.schoolId,
      query.sessionId,
      query.refresh === true,
    );
  }

  @Get('enrollment')
  @RequirePermissions('analytics.view')
  @ApiOperation({ summary: 'Enrollment trend, year on year' })
  enrollment(
    @Query() query: ExecutiveQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.executive.enrollment(user.schoolId, query.refresh === true);
  }

  @Get('attendance-heatmap')
  @RequirePermissions('analytics.view')
  @ApiOperation({ summary: 'Attendance percentage per section per month' })
  attendance(
    @Query() query: ExecutiveQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.executive.attendanceHeatmap(
      user.schoolId,
      query.sessionId,
      query.refresh === true,
    );
  }

  @Get('finance')
  @RequirePermissions('analytics.finance')
  @ApiOperation({ summary: 'Fee realization, dues aging and collection trend' })
  finance(
    @Query() query: ExecutiveQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.executive.finance(user.schoolId, query.refresh === true);
  }

  @Get('results')
  @RequirePermissions('analytics.view')
  @ApiOperation({ summary: 'Pass rate and average GPA per published exam' })
  results(
    @Query() query: ExecutiveQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.executive.results(
      user.schoolId,
      query.sessionId,
      query.refresh === true,
    );
  }

  @Get('operations')
  @RequirePermissions('analytics.view')
  @ApiOperation({
    summary:
      'Library, transport, hostel, stores, complaints and messaging KPIs',
  })
  operations(
    @Query() query: ExecutiveQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.executive.operations(user.schoolId, query.refresh === true);
  }

  @Get('website')
  @RequirePermissions('analytics.website')
  @ApiOperation({ summary: 'Public-site page views and unique visitors' })
  website(
    @Query() query: SiteAnalyticsQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.site.report(user.schoolId, query);
  }

  /**
   * Roadmap §4's manual refresh. Separate from `analytics.view` because it
   * is a **write to the database's workload**, not a read: three full
   * scans, and on a small server an impatient administrator pressing it
   * repeatedly is a self-inflicted outage.
   */
  @Post('refresh-views')
  @RequirePermissions('analytics.refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rebuild the materialized views now' })
  async refresh(@Body() dto: RefreshViewsDto) {
    return { views: await this.views.refreshAll(this.views.parse(dto.views)) };
  }
}

/**
 * The page-view beacon (roadmap §3's website analytics ingestion).
 *
 * Mounted under `/public` with the rest of the unauthenticated surface,
 * and like every public route in this project it resolves
 * `DEFAULT_SCHOOL_ID` — multi-tenant public routing is an M31 concern (the
 * M10/M15/M16/M19/M28 precedent).
 *
 * `@SkipAudit()` because an audit row per page view would grow the audit
 * log faster than every other write in the system combined, and would say
 * nothing: the analytics row IS the record.
 */
@ApiTags('analytics-public')
@Controller('public/analytics')
export class PublicAnalyticsController {
  constructor(private readonly site: SiteAnalyticsService) {}

  @Post('collect')
  @Public()
  @SkipAudit()
  @HttpCode(HttpStatus.NO_CONTENT)
  // Generous, because it is one call per page view and a reader clicking
  // through a photo gallery is not abuse — but bounded, because the
  // endpoint increments a counter and an unbounded one is a free way to
  // make the school's traffic figures say anything.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Record one public-site page view' })
  async collect(
    @Body() dto: CollectPageViewDto,
    @Req() request: Request,
  ): Promise<void> {
    await this.site.collect(DEFAULT_SCHOOL_ID, dto, {
      // Both are used only to derive a salted hash that goes into a
      // HyperLogLog. Neither is stored — see `SiteAnalyticsCounterService`.
      ip: request.ip ?? 'unknown',
      userAgent: request.get('user-agent') ?? 'unknown',
    });
  }
}
