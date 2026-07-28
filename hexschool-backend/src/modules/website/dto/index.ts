import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  CareerApplicationStatus,
  CmsPageTemplate,
  ContactMessageStatus,
  GalleryItemType,
  NewsCategory,
  WebContentStatus,
} from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** YYYY-MM-DD, parsed through `parseDate` (M05 convention). */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** BD mobile (PROJECT_CONTEXT §12). */
const BD_PHONE_RE = /^01[3-9]\d{8}$/;

// ── CMS pages ─────────────────────────────────────────────────────────

export class CreateCmsPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  titleBn?: string;

  @IsString()
  @MaxLength(200_000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  contentBn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  metaTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  metaDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  ogImageUrl?: string;

  @IsOptional()
  @IsEnum(CmsPageTemplate)
  template?: CmsPageTemplate;

  @IsOptional()
  @IsBoolean()
  showInMenu?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @IsOptional()
  @IsEnum(WebContentStatus)
  status?: WebContentStatus;
}

export class UpdateCmsPageDto extends PartialType(CreateCmsPageDto) {}

// ── news ──────────────────────────────────────────────────────────────

export class CreateNewsPostDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  titleBn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string;

  @IsString()
  @MaxLength(200_000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  contentBn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverUrl?: string;

  @IsOptional()
  @IsEnum(NewsCategory)
  category?: NewsCategory;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  metaTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  metaDescription?: string;

  @IsOptional()
  @IsEnum(WebContentStatus)
  status?: WebContentStatus;
}

export class UpdateNewsPostDto extends PartialType(CreateNewsPostDto) {}

// ── galleries ─────────────────────────────────────────────────────────

export class GalleryItemInputDto {
  @IsOptional()
  @IsEnum(GalleryItemType)
  type?: GalleryItemType;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  caption?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class CreateGalleryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  titleBn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @Matches(DATE_RE, { message: 'eventDate must be YYYY-MM-DD' })
  eventDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverUrl?: string;

  @IsOptional()
  @IsEnum(WebContentStatus)
  status?: WebContentStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  /** Full item set — replaces the album's items when present. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GalleryItemInputDto)
  items?: GalleryItemInputDto[];
}

export class UpdateGalleryDto extends PartialType(CreateGalleryDto) {}

// ── downloads ─────────────────────────────────────────────────────────

export class CreateDownloadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  titleBn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  fileUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  fileKey?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;

  @IsOptional()
  @IsEnum(WebContentStatus)
  status?: WebContentStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class UpdateDownloadDto extends PartialType(CreateDownloadDto) {}

// ── careers ───────────────────────────────────────────────────────────

export class CreateCareerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(200_000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  vacancies?: number;

  @IsOptional()
  @Matches(DATE_RE, { message: 'deadline must be YYYY-MM-DD' })
  deadline?: string;

  @IsOptional()
  @IsEnum(WebContentStatus)
  status?: WebContentStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class UpdateCareerDto extends PartialType(CreateCareerDto) {}

export class UpdateCareerApplicationDto {
  @IsEnum(CareerApplicationStatus)
  status!: CareerApplicationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

// ── FAQs ──────────────────────────────────────────────────────────────

export class CreateFaqDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  question!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  questionBn?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  answer!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  answerBn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsEnum(WebContentStatus)
  status?: WebContentStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class UpdateFaqDto extends PartialType(CreateFaqDto) {}

// ── committee ─────────────────────────────────────────────────────────

export class CreateCommitteeMemberDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameBn?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(150)
  designation!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  message?: string;

  @IsOptional()
  @IsEnum(WebContentStatus)
  status?: WebContentStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class UpdateCommitteeMemberDto extends PartialType(
  CreateCommitteeMemberDto,
) {}

// ── contact inbox ─────────────────────────────────────────────────────

export class UpdateContactMessageStatusDto {
  @IsEnum(ContactMessageStatus)
  status!: ContactMessageStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  replyNote?: string;
}

export class ContactMessageQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ContactMessageStatus)
  status?: ContactMessageStatus;
}

// ── publish / preview ─────────────────────────────────────────────────

export class PublishDto {
  @IsBoolean()
  publish!: boolean;
}

export class PreviewTokenDto {
  @IsIn(['page', 'news'])
  type!: 'page' | 'news';

  @IsUUID()
  id!: string;
}

// ── public write endpoints ────────────────────────────────────────────

export class PublicContactDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @Matches(BD_PHONE_RE, { message: 'phone must be a valid BD mobile number' })
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  recaptchaToken?: string;
}

export class PublicCareerApplyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @Matches(BD_PHONE_RE, { message: 'phone must be a valid BD mobile number' })
  phone!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  recaptchaToken?: string;
}

export class PublicVerifyStudentDto {
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  identifier!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  recaptchaToken?: string;
}

// ── public read queries ───────────────────────────────────────────────

export class PublicFeedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(NewsCategory)
  category?: NewsCategory;
}

export class PreviewQueryDto {
  /** Signed preview token — reveals a DRAFT to whoever holds it. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  preview?: string;
}
