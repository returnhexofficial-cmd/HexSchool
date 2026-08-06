import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ArchiveLinkType,
  CertificateStatus,
  CertificateType,
} from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

// ── templates ─────────────────────────────────────────────────────────

export class SignatoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  designation?: string;

  /** S3 key or URL of the signature image — size-checked at upload. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;
}

export class UpsertTemplateDto {
  @IsEnum(CertificateType)
  type!: CertificateType;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  /**
   * Handlebars-lite markup. Sanitized on WRITE through M19's allow-list
   * sanitizer before it is stored — this HTML renders into a PDF and into
   * the designer's own preview pane.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  bodyHtml!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  backgroundUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => SignatoryDto)
  signatories?: SignatoryDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class TemplateQueryDto {
  @IsOptional()
  @IsEnum(CertificateType)
  type?: CertificateType;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class PreviewTemplateDto {
  /**
   * Preview against a real student when one is given, and against sample
   * data otherwise — an editor designing a layout before term starts has
   * no student to point at, and a preview that needed one would be
   * unusable exactly when the template is being written.
   */
  @IsOptional()
  @IsUUID()
  studentId?: string;

  /** Unsaved editor content, so the preview follows the keystrokes. */
  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  bodyHtml?: string;
}

// ── issuance ──────────────────────────────────────────────────────────

export class CreateCertificateDto {
  @IsUUID()
  studentId!: string;

  @IsEnum(CertificateType)
  type!: CertificateType;

  @IsOptional()
  @IsUUID()
  templateId?: string;

  /** Defaults to the student's live enrollment. */
  @IsOptional()
  @IsUUID()
  enrollmentId?: string;

  /** Overrides `documents.conduct_default`. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  conduct?: string;

  /** The exam whose result the snapshot quotes; defaults to the latest
   *  published one. */
  @IsOptional()
  @IsUUID()
  examId?: string;

  /** Free-text variables a CUSTOM or PRIZE template references. */
  @IsOptional()
  @IsObject()
  extra?: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;

  /**
   * Issue immediately rather than leaving a draft. The wizard's confirm
   * step sends `true`; the "save and come back" path sends `false`.
   */
  @IsOptional()
  @IsBoolean()
  issue?: boolean;

  /**
   * Roadmap §6's mandatory reason. Present ⇒ the caller is asking to
   * issue past an unmet clearance, which needs
   * `certificate.clearance.override` — the M08/M12/M21 runtime-check
   * convention, where one route serves the normal and the elevated case.
   */
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  clearanceOverrideReason?: string;

  /** Roadmap §4's optional SMS; defaults to `documents.notify_on_issue`. */
  @IsOptional()
  @IsBoolean()
  notify?: boolean;

  /**
   * Roadmap §4's TC confirm step. Issuing a transfer certificate marks the
   * student TRANSFERRED, and that is a consequence the office has to say
   * out loud rather than discover afterwards.
   */
  @IsOptional()
  @IsBoolean()
  confirmTransfer?: boolean;
}

/** Roadmap §8's legacy backfill — a certificate issued before this system. */
export class LegacyCertificateDto {
  @IsUUID()
  studentId!: string;

  @IsEnum(CertificateType)
  type!: CertificateType;

  /** The number the school wrote by hand; never generated. */
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  certificateNo!: string;

  @IsISO8601()
  issueDate!: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;

  /** Anything the paper register recorded that is worth keeping. */
  @IsOptional()
  @IsObject()
  extra?: Record<string, string>;
}

export class ReissueCertificateDto {
  /**
   * DUPLICATE reprints a still-valid certificate (roadmap §8's lost
   * original, watermarked); CORRECTION replaces a revoked one.
   */
  @IsEnum({ DUPLICATE: 'DUPLICATE', CORRECTION: 'CORRECTION' })
  kind!: 'DUPLICATE' | 'CORRECTION';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;

  @IsOptional()
  @IsBoolean()
  notify?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  clearanceOverrideReason?: string;
}

export class RevokeCertificateDto {
  /** Mandatory, and long enough to be an explanation rather than a word:
   *  it is printed on the public verification page. */
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}

export class CertificateQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(CertificateType)
  type?: CertificateType;

  @IsOptional()
  @IsEnum(CertificateStatus)
  status?: CertificateStatus;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class ClearanceQueryDto {
  @IsUUID()
  studentId!: string;

  @IsOptional()
  @IsEnum(CertificateType)
  type?: CertificateType;
}

// ── bulk prize wizard ─────────────────────────────────────────────────

export class BulkPrizeDto {
  @IsUUID()
  examId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  topN!: number;

  @IsOptional()
  @IsUUID()
  templateId?: string;

  /** Restrict to these classes; empty means every class in the exam. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  classIds?: string[];

  /**
   * Preview only. The wizard's first step always previews, because a run
   * that raised two hundred certificates before showing anybody the list
   * would be corrected by revoking two hundred certificates.
   */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsBoolean()
  issue?: boolean;
}

// ── archive ───────────────────────────────────────────────────────────

export class UpsertFolderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpsertFileDto {
  @IsUUID()
  folderId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(250)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  fileUrl!: string;

  @IsString()
  @MaxLength(120)
  mimeType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsEnum(ArchiveLinkType)
  linkedType?: ArchiveLinkType;

  @IsOptional()
  @IsUUID()
  linkedId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateFileDto {
  @IsOptional()
  @IsUUID()
  folderId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(250)
  title?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsEnum(ArchiveLinkType)
  linkedType?: ArchiveLinkType;

  @IsOptional()
  @IsUUID()
  linkedId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ArchiveFileQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  folderId?: string;

  /**
   * A tag filter arrives from a URL, and a URL has no arrays.
   *
   * Found by the M27 e2e suite: `@IsArray()` alone 400s on `?tags=board`,
   * because a single query parameter is a **string** — and the bracket
   * form that would parse as an array depends on the Express query-parser
   * mode, which is not something a caller can see. So the transform
   * accepts all three shapes a client will plausibly send (one value, a
   * comma-separated list, a repeated parameter) and normalizes them here,
   * where the ambiguity actually is.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (Array.isArray(value)) return value.map((v) => String(v).trim());
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
    }
    return undefined;
  })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsEnum(ArchiveLinkType)
  linkedType?: ArchiveLinkType;

  @IsOptional()
  @IsUUID()
  linkedId?: string;
}

// ── report windows ────────────────────────────────────────────────────

export class RegisterReportQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsEnum(CertificateType)
  type?: CertificateType;
}
