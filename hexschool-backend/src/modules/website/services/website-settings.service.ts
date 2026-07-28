import { Injectable } from '@nestjs/common';
import { SettingsService } from '../../school/services/settings.service';

export interface HeroSlide {
  imageUrl?: string;
  title?: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export interface QuickLink {
  label?: string;
  href?: string;
}

export interface WebsiteConfig {
  enabled: boolean;
  siteUrl: string;
  siteTitle: string;
  siteTitleBn: string;
  tagline: string;
  metaDescription: string;
  ogImageUrl: string;
  indexable: boolean;
  analyticsId: string;
  heroSlides: HeroSlide[];
  quickLinks: QuickLink[];
  footerText: string;
  social: {
    facebook: string;
    youtube: string;
    linkedin: string;
    x: string;
  };
  mapEmbedUrl: string;
  contactEmail: string;
  defaultLanguage: string;
  languageToggle: boolean;
  cacheTtlSeconds: number;
  newsPageSize: number;
  teacherDirectoryEnabled: boolean;
  studentVerificationEnabled: boolean;
  studentVerificationFields: string[];
  careerCvMaxMb: number;
}

/**
 * One typed read of the whole `website.*` settings group — the
 * `AttendanceSettingsService` (M12) / `TimetableSettingsService` (M13)
 * precedent. Malformed JSON knobs (hero slides, quick links, the
 * verification field list) fall back to a sane default rather than
 * 500-ing the home page, because these are hand-edited by an admin and
 * the public site must degrade, not break.
 */
@Injectable()
export class WebsiteSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async load(schoolId: string): Promise<WebsiteConfig> {
    const read = <T>(key: string, fallback: T): Promise<T> =>
      this.settings.getValue<T>(schoolId, key).then(
        (value) => (value === undefined || value === null ? fallback : value),
        () => fallback,
      );

    const [
      enabled,
      siteUrl,
      siteTitle,
      siteTitleBn,
      tagline,
      metaDescription,
      ogImageUrl,
      indexable,
      analyticsId,
      heroSlides,
      quickLinks,
      footerText,
      facebook,
      youtube,
      linkedin,
      x,
      mapEmbedUrl,
      contactEmail,
      defaultLanguage,
      languageToggle,
      cacheTtlSeconds,
      newsPageSize,
      teacherDirectoryEnabled,
      studentVerificationEnabled,
      studentVerificationFields,
      careerCvMaxMb,
    ] = await Promise.all([
      read('website.enabled', true),
      read('website.site_url', ''),
      read('website.site_title', ''),
      read('website.site_title_bn', ''),
      read('website.tagline', ''),
      read('website.meta_description', ''),
      read('website.og_image_url', ''),
      read('website.indexable', true),
      read('website.analytics_id', ''),
      read<unknown>('website.hero_slides', []),
      read<unknown>('website.quick_links', []),
      read('website.footer_text', ''),
      read('website.social_facebook', ''),
      read('website.social_youtube', ''),
      read('website.social_linkedin', ''),
      read('website.social_x', ''),
      read('website.map_embed_url', ''),
      read('website.contact_email', ''),
      read('website.default_language', 'en'),
      read('website.language_toggle', true),
      read('website.cache_ttl_seconds', 60),
      read('website.news_page_size', 9),
      read('website.teacher_directory_enabled', true),
      read('website.student_verification_enabled', true),
      read<unknown>('website.student_verification_fields', [
        'name',
        'class',
        'status',
        'photo',
      ]),
      read('website.career_cv_max_mb', 5),
    ]);

    return {
      enabled: Boolean(enabled),
      siteUrl: String(siteUrl ?? '').trim(),
      siteTitle: String(siteTitle ?? '').trim(),
      siteTitleBn: String(siteTitleBn ?? '').trim(),
      tagline: String(tagline ?? ''),
      metaDescription: String(metaDescription ?? ''),
      ogImageUrl: String(ogImageUrl ?? ''),
      indexable: Boolean(indexable),
      analyticsId: String(analyticsId ?? ''),
      heroSlides: asObjectArray<HeroSlide>(heroSlides),
      quickLinks: asObjectArray<QuickLink>(quickLinks),
      footerText: String(footerText ?? ''),
      social: {
        facebook: String(facebook ?? ''),
        youtube: String(youtube ?? ''),
        linkedin: String(linkedin ?? ''),
        x: String(x ?? ''),
      },
      mapEmbedUrl: String(mapEmbedUrl ?? ''),
      contactEmail: String(contactEmail ?? '').trim(),
      defaultLanguage: defaultLanguage === 'bn' ? 'bn' : 'en',
      languageToggle: Boolean(languageToggle),
      cacheTtlSeconds: positiveInt(cacheTtlSeconds, 60),
      newsPageSize: Math.min(positiveInt(newsPageSize, 9), 50),
      teacherDirectoryEnabled: Boolean(teacherDirectoryEnabled),
      studentVerificationEnabled: Boolean(studentVerificationEnabled),
      studentVerificationFields: asStringArray(studentVerificationFields, [
        'name',
        'class',
        'status',
        'photo',
      ]),
      careerCvMaxMb: Math.min(positiveInt(careerCvMaxMb, 5), 20),
    };
  }
}

function asObjectArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is T =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry),
  );
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const list = value.filter((v): v is string => typeof v === 'string');
  return list.length > 0 ? list : fallback;
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
