import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ReportFormat, ReportScheduleStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = { message: 'must be YYYY-MM-DD' };

export class RunReportDto {
  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;

  /**
   * The parameter bag, validated against the report's own `params_schema`
   * by `param.engine` rather than by class-validator — the schema is data,
   * and a decorator cannot read it.
   */
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}

/**
 * The export centre's list query.
 *
 * It **extends** `PaginationQueryDto` rather than sitting beside it as a
 * second `@Query()` parameter, because `forbidNonWhitelisted` validates
 * each bound DTO against the whole query string: two DTOs on one handler
 * means each rejects the other's keys and every paginated request 400s.
 * The base DTO says "extend per module" for exactly this reason.
 */
export class ReportRunQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reportCode?: string;

  @IsOptional()
  @IsEnum(['QUEUED', 'RUNNING', 'DONE', 'FAILED'])
  status?: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';

  /** `mine=true` narrows the export centre to the caller's own runs. */
  @IsOptional()
  @IsString()
  mine?: string;
}

export class RecipientsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  emails?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  userIds?: string[];
}

export class CreateScheduleDto {
  @IsString()
  @MaxLength(100)
  reportCode!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  /**
   * Five fields. The **whitelist lives in `cron.engine`**, not in a
   * decorator: §7's rule is "no sub-hourly", which is a parse rather than
   * a pattern, and a regex that tried to express it would either accept a
   * step it should not or reject an expression it should not. This shape
   * check only keeps obviously malformed input out of the parser.
   */
  @IsString()
  @Matches(/^[\d*,\-/ ]{5,60}$/, {
    message: 'cron must be five space-separated fields',
  })
  cron!: string;

  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsOptional()
  @Type(() => RecipientsDto)
  recipients?: RecipientsDto;
}

export class UpdateScheduleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[\d*,\-/ ]{5,60}$/, {
    message: 'cron must be five space-separated fields',
  })
  cron?: string;

  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsOptional()
  @Type(() => RecipientsDto)
  recipients?: RecipientsDto;

  /**
   * ACTIVE and PAUSED only. **DISABLED is the system's word**, not the
   * owner's — it means the schedule was stopped by the deleted-owner rule
   * or by exhausted retries, and it carries a reason the API must not let
   * a human forge (roadmap §6/§8).
   */
  @IsOptional()
  @IsEnum([ReportScheduleStatus.ACTIVE, ReportScheduleStatus.PAUSED])
  status?: 'ACTIVE' | 'PAUSED';
}

export class ScheduleQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reportCode?: string;

  @IsOptional()
  @IsEnum(ReportScheduleStatus)
  status?: ReportScheduleStatus;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class AnalyticsWindowDto {
  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, DATE_MESSAGE)
  to?: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;
}

export class RefreshViewsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  views?: string[];
}

/**
 * The page-view beacon. Deliberately tiny and deliberately anonymous:
 * a path, a referrer, and nothing that identifies a person. The visitor
 * fingerprint is derived server-side from the request and never stored —
 * see `SiteAnalyticsCounterService`.
 */
export class CollectPageViewDto {
  @IsString()
  @MaxLength(300)
  path!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  referrer?: string;
}

export class SiteAnalyticsQueryDto extends AnalyticsWindowDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

export class ExecutiveQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  refresh?: boolean;
}
