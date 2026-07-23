import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  NoticeAudience,
  NotificationChannel,
  NotificationLanguage,
  NotificationRecipientType,
  NotificationStatus,
} from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

// ── templates ─────────────────────────────────────────────────────────

export class CreateTemplateDto {
  @IsString()
  @MaxLength(40)
  code!: string;

  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @IsOptional()
  @IsEnum(NotificationLanguage)
  language?: NotificationLanguage;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PreviewTemplateDto {
  @IsString()
  @MaxLength(40)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsString()
  @MaxLength(2000)
  body!: string;

  @IsOptional()
  @IsObject()
  sampleVars?: Record<string, unknown>;
}

// ── direct send ───────────────────────────────────────────────────────

export class SendDirectDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @IsEnum(NotificationRecipientType)
  recipientType!: NotificationRecipientType;

  @IsOptional()
  @IsUUID()
  recipientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  destination?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsObject()
  vars?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  emergency?: boolean;
}

// ── bulk composer ─────────────────────────────────────────────────────

export class BulkSendDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  /** A notice audience, plus RAW for a custom-numbers CSV blast. */
  @IsIn([...Object.values(NoticeAudience), 'RAW'])
  audience!: NoticeAudience | 'RAW';

  /** Session the roster audience is resolved in (required unless RAW). */
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  classIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  sectionIds?: string[];

  /** Custom numbers for a RAW audience (CSV upload → array). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10000)
  @IsString({ each: true })
  customNumbers?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsBoolean()
  emergency?: boolean;

  /** Idempotency key of this composer session (double-click guard). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  batchKey?: string;
}

// ── notices ───────────────────────────────────────────────────────────

export class CreateNoticeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(1)
  body!: string;

  @IsEnum(NoticeAudience)
  audience!: NoticeAudience;

  @IsOptional()
  @IsObject()
  audienceRef?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachmentUrls?: string[];

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsString()
  publishAt?: string;

  @IsOptional()
  @IsBoolean()
  isWebsiteVisible?: boolean;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

export class UpdateNoticeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  body?: string;

  @IsOptional()
  @IsEnum(NoticeAudience)
  audience?: NoticeAudience;

  @IsOptional()
  @IsObject()
  audienceRef?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachmentUrls?: string[];

  @IsOptional()
  @IsString()
  publishAt?: string | null;

  @IsOptional()
  @IsBoolean()
  isWebsiteVisible?: boolean;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

export class PublishNoticeDto {
  @IsBoolean()
  publish!: boolean;
}

// ── credits ───────────────────────────────────────────────────────────

export class AdjustCreditDto {
  /** Positive to add, negative to correct down (ADJUST); PURCHASE is +. */
  @Type(() => Number)
  @IsInt()
  qty!: number;

  @IsOptional()
  @IsBoolean()
  purchase?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  ref?: string;
}

// ── inbox / retry ─────────────────────────────────────────────────────

export class MarkReadDto {
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  ids?: string[];
}

export class RetryDto {
  @IsArray()
  @IsUUID('4', { each: true })
  ids!: string[];
}

// ── log filters ───────────────────────────────────────────────────────

export class NotificationLogQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;
}
