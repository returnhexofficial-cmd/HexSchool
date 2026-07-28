import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NewsCategory } from '../../../common/constants';
import { RecaptchaService } from '../../admission/services/recaptcha.service';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { excerptFrom } from '../calc/html-sanitize.util';
import { PreviewQueryDto, PublicFeedQueryDto } from '../dto';
import {
  CareersRepository,
  CmsPagesRepository,
  CommitteeMembersRepository,
  DownloadsRepository,
  FaqsRepository,
  GalleriesRepository,
  GalleryItemsRepository,
  NewsPostsRepository,
} from '../repositories/cms-content.repository';
import { PublicSiteRepository } from '../repositories/public-site.repository';
import { PreviewTokenService } from './preview-token.service';
import { WebsiteCacheService } from './website-cache.service';
import { WebsiteSettingsService } from './website-settings.service';

/**
 * Everything the anonymous public site reads (roadmap M19 §4). Three
 * rules hold across every method here and are what the e2e privacy suite
 * asserts:
 *
 *  1. **Published only.** Reads go through the repositories' `published*`
 *     helpers, which pin the status filter, so no endpoint can forget it.
 *     The one exception is an explicit, signed, row-specific preview token.
 *  2. **Never confirm what is hidden.** A draft, a disabled feature and a
 *     row that does not exist all answer 404 — the M15 public-result-search
 *     rule ("a miss and a withheld result return the same 404").
 *  3. **Cached, best-effort.** Composite payloads are cached for
 *     `website.cache_ttl_seconds`; Redis being down means a slower page,
 *     never an error.
 */
@Injectable()
export class PublicSiteService {
  constructor(
    private readonly pages: CmsPagesRepository,
    private readonly news: NewsPostsRepository,
    private readonly galleries: GalleriesRepository,
    private readonly galleryItems: GalleryItemsRepository,
    private readonly downloads: DownloadsRepository,
    private readonly careers: CareersRepository,
    private readonly faqs: FaqsRepository,
    private readonly committee: CommitteeMembersRepository,
    private readonly site: PublicSiteRepository,
    private readonly schools: SchoolsRepository,
    private readonly config: WebsiteSettingsService,
    private readonly preview: PreviewTokenService,
    private readonly cache: WebsiteCacheService,
    private readonly recaptcha: RecaptchaService,
  ) {}

  /**
   * Site chrome: identity, navigation, socials, footer. Every public page
   * needs it, so it is the most cached payload in the module.
   */
  async siteConfig(schoolId: string) {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);

    return this.cache.wrap(
      schoolId,
      'config',
      cfg.cacheTtlSeconds,
      async () => {
        const [school, menu] = await Promise.all([
          this.schools.findById(schoolId),
          this.pages.publishedPages(schoolId, { menuOnly: true }),
        ]);
        return {
          school: school
            ? {
                name: school.name,
                nameBn: school.nameBn,
                logoUrl: school.logoUrl,
                address: school.address,
                phone: school.phone,
                email: school.email,
                eiin: school.eiinNumber,
                establishedYear: school.establishedYear,
              }
            : null,
          site: {
            title: cfg.siteTitle || school?.name || '',
            titleBn: cfg.siteTitleBn || school?.nameBn || '',
            tagline: cfg.tagline,
            metaDescription: cfg.metaDescription,
            ogImageUrl: cfg.ogImageUrl,
            footerText: cfg.footerText,
            social: cfg.social,
            mapEmbedUrl: cfg.mapEmbedUrl,
            quickLinks: cfg.quickLinks,
            analyticsId: cfg.analyticsId,
            defaultLanguage: cfg.defaultLanguage,
            languageToggle: cfg.languageToggle,
            siteUrl: cfg.siteUrl,
          },
          features: {
            teacherDirectory: cfg.teacherDirectoryEnabled,
            studentVerification: cfg.studentVerificationEnabled,
            // Certificate verification is a Module 27 capability; the page
            // exists now and says so (see `verifyCertificate`).
            certificateVerification: false,
          },
          menu: menu.map((page) => ({
            slug: page.slug,
            title: page.title,
            titleBn: page.titleBn,
          })),
        };
      },
    );
  }

  /** The home page in one round trip (roadmap §4 `GET /public/home`). */
  async home(schoolId: string) {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);

    return this.cache.wrap(schoolId, 'home', cfg.cacheTtlSeconds, async () => {
      const sessionRow = await this.site.currentSessionId(schoolId);
      const [
        notices,
        news,
        events,
        stats,
        galleries,
        committee,
        latestAchievements,
      ] = await Promise.all([
        this.site.websiteNotices(schoolId, { take: 6 }),
        this.news.publishedFeed(schoolId, {
          category: NewsCategory.NEWS,
          take: 3,
        }),
        this.site.publicEvents(schoolId, startOfToday(), 5),
        this.site.headlineStats(schoolId, sessionRow?.id ?? null),
        this.galleries.publishedList(schoolId, 4),
        this.committee.publishedList(schoolId),
        this.news.publishedFeed(schoolId, {
          category: NewsCategory.ACHIEVEMENT,
          take: 3,
        }),
      ]);

      const { covers } = await this.galleryCovers(galleries.map((g) => g.id));

      // The principal's message teaser (roadmap §5) — whichever committee
      // member has a message and sorts first; a school that has not
      // written one gets `null` and the section is hidden, not empty
      // (roadmap §8 "hide empty sections").
      const principal = committee.find((m) => m.message);

      return {
        hero: { slides: cfg.heroSlides },
        stats,
        notices: notices.items.map(noticeCard),
        news: news.items.map(newsCard),
        achievements: latestAchievements.items.map(newsCard),
        events: events.map((event) => ({
          id: event.id,
          title: event.title,
          type: event.type,
          startDate: event.startDate,
          endDate: event.endDate,
        })),
        galleries: galleries.map((gallery) => ({
          id: gallery.id,
          title: gallery.title,
          eventDate: gallery.eventDate,
          coverUrl: gallery.coverUrl ?? covers.get(gallery.id) ?? null,
        })),
        principalMessage: principal
          ? {
              name: principal.name,
              designation: principal.designation,
              photoUrl: principal.photoUrl,
              teaser: excerptFrom(principal.message, 260),
            }
          : null,
      };
    });
  }

  // ── pages ───────────────────────────────────────────────────────────

  async page(schoolId: string, slug: string, query: PreviewQueryDto) {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);

    // Resolve without the status filter so a preview token can be checked
    // against the exact row it names; an unauthorised draft then 404s the
    // same way a missing page does.
    const page = await this.pages.findBySlug(schoolId, slug);
    if (!page) throw new NotFoundException('Page not found');
    if (
      page.status !== 'PUBLISHED' &&
      !this.preview.authorises(query.preview, 'page', page.id)
    ) {
      throw new NotFoundException('Page not found');
    }
    return {
      slug: page.slug,
      title: page.title,
      titleBn: page.titleBn,
      content: page.content,
      contentBn: page.contentBn,
      excerpt: page.excerpt,
      metaTitle: page.metaTitle,
      metaDescription: page.metaDescription,
      ogImageUrl: page.ogImageUrl,
      template: page.template,
      publishedAt: page.publishedAt,
      updatedAt: page.updatedAt,
      isDraft: page.status !== 'PUBLISHED',
    };
  }

  // ── news ────────────────────────────────────────────────────────────

  async newsFeed(schoolId: string, query: PublicFeedQueryDto) {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);

    const page = query.page ?? 1;
    const limit = query.limit ?? cfg.newsPageSize;
    const { items, total } = await this.news.publishedFeed(schoolId, {
      category: query.category,
      search: query.search,
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      items: items.map(newsCard),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async newsPost(schoolId: string, slug: string, query: PreviewQueryDto) {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);

    const post = await this.news.findBySlug(schoolId, slug);
    if (!post) throw new NotFoundException('Post not found');
    if (
      post.status !== 'PUBLISHED' &&
      !this.preview.authorises(query.preview, 'news', post.id)
    ) {
      throw new NotFoundException('Post not found');
    }
    return {
      slug: post.slug,
      title: post.title,
      titleBn: post.titleBn,
      excerpt: post.excerpt,
      content: post.content,
      contentBn: post.contentBn,
      coverUrl: post.coverUrl,
      category: post.category,
      metaTitle: post.metaTitle,
      metaDescription: post.metaDescription,
      publishedAt: post.publishedAt,
      isDraft: post.status !== 'PUBLISHED',
    };
  }

  // ── notices & events ────────────────────────────────────────────────

  async notices(schoolId: string, query: PublicFeedQueryDto) {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await this.site.websiteNotices(schoolId, {
      skip: (page - 1) * limit,
      take: limit,
      search: query.search,
    });
    return {
      items: items.map(noticeCard),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async notice(schoolId: string, id: string) {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);
    const notice = await this.site.websiteNotice(schoolId, id);
    if (!notice) throw new NotFoundException('Notice not found');
    return noticeCard(notice);
  }

  async events(schoolId: string) {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);
    return this.cache.wrap(schoolId, 'events', cfg.cacheTtlSeconds, () =>
      this.site.publicEvents(schoolId, startOfToday(), 50),
    );
  }

  // ── galleries ───────────────────────────────────────────────────────

  async galleryList(schoolId: string) {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);

    return this.cache.wrap(
      schoolId,
      'galleries',
      cfg.cacheTtlSeconds,
      async () => {
        const galleries = await this.galleries.publishedList(schoolId);
        const { covers, counts } = await this.galleryCovers(
          galleries.map((g) => g.id),
        );
        return galleries.map((gallery) => ({
          id: gallery.id,
          title: gallery.title,
          titleBn: gallery.titleBn,
          description: gallery.description,
          eventDate: gallery.eventDate,
          coverUrl: gallery.coverUrl ?? covers.get(gallery.id) ?? null,
          itemCount: counts.get(gallery.id) ?? 0,
        }));
      },
    );
  }

  /** One album, items paginated (roadmap §8 — very large galleries). */
  async gallery(schoolId: string, id: string, query: PublicFeedQueryDto) {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);

    const gallery = await this.galleries.publishedById(schoolId, id);
    if (!gallery) throw new NotFoundException('Gallery not found');

    const page = query.page ?? 1;
    const limit = query.limit ?? 24;
    const { items, total } = await this.galleryItems.listForGallery(id, {
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      id: gallery.id,
      title: gallery.title,
      titleBn: gallery.titleBn,
      description: gallery.description,
      eventDate: gallery.eventDate,
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        url: item.url,
        caption: item.caption,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  // ── flat lists ──────────────────────────────────────────────────────

  async downloadList(schoolId: string) {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);
    return this.cache.wrap(
      schoolId,
      'downloads',
      cfg.cacheTtlSeconds,
      async () => {
        const rows = await this.downloads.publishedList(schoolId);
        return rows.map((row) => ({
          id: row.id,
          title: row.title,
          titleBn: row.titleBn,
          category: row.category,
          fileUrl: row.fileUrl,
          sizeBytes: row.sizeBytes,
          downloadCount: row.downloadCount,
        }));
      },
    );
  }

  /**
   * Counts a download and hands back the file URL. The counter moves in
   * the database (`incrementCounter`), so two simultaneous clicks count
   * twice, and a hit against an unpublished row counts nothing and 404s.
   */
  async registerDownloadHit(schoolId: string, id: string) {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);

    const row = await this.downloads.publishedById(schoolId, id);
    if (!row) throw new NotFoundException('File not found');
    const downloadCount = await this.downloads.incrementCounter(schoolId, id);
    return { fileUrl: row.fileUrl, downloadCount };
  }

  async faqList(schoolId: string) {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);
    return this.cache.wrap(schoolId, 'faqs', cfg.cacheTtlSeconds, async () => {
      const rows = await this.faqs.publishedList(schoolId);
      return rows.map((row) => ({
        id: row.id,
        question: row.question,
        questionBn: row.questionBn,
        answer: row.answer,
        answerBn: row.answerBn,
        category: row.category,
      }));
    });
  }

  async committeeList(schoolId: string) {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);
    return this.cache.wrap(
      schoolId,
      'committee',
      cfg.cacheTtlSeconds,
      async () => {
        const rows = await this.committee.publishedList(schoolId);
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          nameBn: row.nameBn,
          designation: row.designation,
          photoUrl: row.photoUrl,
          message: row.message,
        }));
      },
    );
  }

  async careerList(schoolId: string) {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);
    const rows = await this.careers.publishedOpenings(schoolId, startOfToday());
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      location: row.location,
      vacancies: row.vacancies,
      deadline: row.deadline,
    }));
  }

  /**
   * The teacher & staff directory. The repository's SELECT list is the
   * privacy contract; this maps it to the public shape and nothing more —
   * no phone, no email, no NID (roadmap §6).
   */
  async teacherDirectory(schoolId: string) {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);
    if (!cfg.teacherDirectoryEnabled) {
      // A school that turned the directory off should not be told the
      // teachers exist — an empty list, not a 403.
      return [];
    }
    return this.cache.wrap(
      schoolId,
      'teachers',
      cfg.cacheTtlSeconds,
      async () => {
        const teachers = await this.site.teacherDirectory(schoolId);
        return teachers.map((teacher) => ({
          id: teacher.id,
          name: `${teacher.firstName} ${teacher.lastName}`.trim(),
          designation: teacher.designation,
          specialization: teacher.specialization,
          photoUrl: teacher.photoUrl,
          since: teacher.joiningDate,
          qualifications: teacher.qualifications
            .map((q) => `${q.degree}, ${q.institution} (${q.passingYear})`)
            .slice(0, 3),
          subjects: teacher.subjects.map((s) => s.subject.name),
        }));
      },
    );
  }

  // ── verification ────────────────────────────────────────────────────

  /**
   * Public student verification (roadmap §4). Answers only what
   * `website.student_verification_fields` allows, and a miss, a
   * soft-deleted student and a disabled feature all return the same 404 —
   * a public endpoint must never confirm that a person exists.
   */
  async verifyStudent(
    schoolId: string,
    identifier: string,
    recaptchaToken: string | undefined,
    ip?: string,
  ) {
    const cfg = await this.config.load(schoolId);
    this.assertEnabled(cfg.enabled);
    await this.recaptcha.assertValid(recaptchaToken, ip);

    const notFound = new NotFoundException(
      'No matching student record was found',
    );
    if (!cfg.studentVerificationEnabled) throw notFound;

    const found = await this.site.verifyStudent(schoolId, identifier.trim());
    if (!found) throw notFound;

    const allow = new Set(cfg.studentVerificationFields);
    const { student, enrollment } = found;
    return {
      verified: true,
      studentUid: student.studentUid,
      ...(allow.has('name')
        ? { name: `${student.firstName} ${student.lastName}`.trim() }
        : {}),
      ...(allow.has('status') ? { status: student.status } : {}),
      ...(allow.has('photo') ? { photoUrl: student.photoUrl } : {}),
      ...(allow.has('class') && enrollment
        ? {
            class: enrollment.class.name,
            section: enrollment.section.name,
            roll: enrollment.rollNo,
            session: enrollment.session.name,
          }
        : {}),
    };
  }

  /**
   * Certificate verification is Module 27's (`docs/modules` roadmap M27
   * §10 "Public verification live — Module 19 stub replaced"). Until then
   * the endpoint exists and describes itself, rather than 404-ing and
   * leaving the page to guess — the M09 `attendance-history` precedent.
   */
  verifyCertificate(code: string) {
    return {
      available: false,
      code,
      reason:
        'Certificate verification arrives with the Documents & Certificates module (27).',
    };
  }

  // ── helpers ─────────────────────────────────────────────────────────

  /**
   * First image (cover fallback) and item count per gallery, from one
   * ordered query — an editor who did not set a cover still gets one.
   */
  private async galleryCovers(
    ids: string[],
  ): Promise<{ covers: Map<string, string>; counts: Map<string, number> }> {
    const items = await this.galleryItems.coverCandidates(ids);
    const covers = new Map<string, string>();
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.galleryId, (counts.get(item.galleryId) ?? 0) + 1);
      if (item.type === 'IMAGE' && !covers.has(item.galleryId)) {
        covers.set(item.galleryId, item.url);
      }
    }
    return { covers, counts };
  }

  /**
   * `website.enabled = false` takes the whole public site down (a school
   * mid-build, or one that keeps its old site). 403 rather than 404: this
   * is a deliberate administrative state, not a missing resource, and the
   * frontend renders its maintenance page from it.
   */
  private assertEnabled(enabled: boolean): void {
    if (!enabled) {
      throw new ForbiddenException('The public website is currently disabled');
    }
  }
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function newsCard(post: {
  slug: string;
  title: string;
  titleBn: string | null;
  excerpt: string | null;
  coverUrl: string | null;
  category: string;
  publishedAt: Date | null;
}) {
  return {
    slug: post.slug,
    title: post.title,
    titleBn: post.titleBn,
    excerpt: post.excerpt,
    coverUrl: post.coverUrl,
    category: post.category,
    publishedAt: post.publishedAt,
  };
}

function noticeCard(notice: {
  id: string;
  title: string;
  body: string;
  attachmentUrls: unknown;
  pinned: boolean;
  publishAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: notice.id,
    title: notice.title,
    body: notice.body,
    attachmentUrls: Array.isArray(notice.attachmentUrls)
      ? (notice.attachmentUrls as string[])
      : [],
    pinned: notice.pinned,
    publishedAt: notice.publishAt ?? notice.createdAt,
  };
}
