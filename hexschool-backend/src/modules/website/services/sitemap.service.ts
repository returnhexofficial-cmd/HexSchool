import { Injectable } from '@nestjs/common';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import {
  absoluteUrl,
  buildRobots,
  buildRss,
  buildSitemap,
  SitemapEntry,
} from '../calc/feed.util';
import { htmlToText } from '../calc/html-sanitize.util';
import {
  CmsPagesRepository,
  GalleriesRepository,
  NewsPostsRepository,
} from '../repositories/cms-content.repository';
import { WebsiteSettingsService } from './website-settings.service';

/** Static routes the frontend always serves, in crawl-priority order. */
const STATIC_ROUTES: ReadonlyArray<[path: string, priority: number]> = [
  ['/', 1],
  ['/notices', 0.8],
  ['/news', 0.8],
  ['/events', 0.6],
  ['/gallery', 0.6],
  ['/teachers', 0.7],
  ['/committee', 0.5],
  ['/achievements', 0.5],
  ['/downloads', 0.5],
  ['/faq', 0.4],
  ['/career', 0.4],
  ['/contact', 0.6],
  ['/admission', 0.9],
  ['/results', 0.7],
];

/**
 * sitemap.xml, robots.txt and the news RSS feed (roadmap M19 §4).
 *
 * These render against `website.site_url`, because the API does not know
 * the public host it is fronted by — a sitemap full of `localhost` URLs is
 * worse than no sitemap, so an unconfigured site URL yields an empty
 * sitemap and a `Disallow: /` robots file rather than a wrong one.
 */
@Injectable()
export class SitemapService {
  constructor(
    private readonly pages: CmsPagesRepository,
    private readonly news: NewsPostsRepository,
    private readonly galleries: GalleriesRepository,
    private readonly schools: SchoolsRepository,
    private readonly config: WebsiteSettingsService,
  ) {}

  async sitemap(schoolId: string): Promise<string> {
    const cfg = await this.config.load(schoolId);
    if (!cfg.enabled || !cfg.indexable || !cfg.siteUrl) {
      return buildSitemap([]);
    }

    const [pages, news, galleries] = await Promise.all([
      this.pages.publishedPages(schoolId),
      this.news.publishedFeed(schoolId, { take: 500 }),
      this.galleries.publishedList(schoolId),
    ]);

    const entries: SitemapEntry[] = [
      ...STATIC_ROUTES.map(([path, priority]) => ({
        loc: absoluteUrl(cfg.siteUrl, path),
        changefreq: 'weekly' as const,
        priority,
      })),
      ...pages.map((page) => ({
        loc: absoluteUrl(cfg.siteUrl, `/${page.slug}`),
        lastmod: page.updatedAt,
        changefreq: 'monthly' as const,
        priority: 0.7,
      })),
      ...news.items.map((post) => ({
        loc: absoluteUrl(cfg.siteUrl, `/news/${post.slug}`),
        lastmod: post.updatedAt,
        changefreq: 'monthly' as const,
        priority: 0.6,
      })),
      ...galleries.map((gallery) => ({
        loc: absoluteUrl(cfg.siteUrl, `/gallery/${gallery.id}`),
        lastmod: gallery.updatedAt,
        changefreq: 'monthly' as const,
        priority: 0.4,
      })),
    ];
    return buildSitemap(entries);
  }

  async robots(schoolId: string): Promise<string> {
    const cfg = await this.config.load(schoolId);
    const allow = cfg.enabled && cfg.indexable && Boolean(cfg.siteUrl);
    return buildRobots({
      allow,
      sitemapUrl: cfg.siteUrl ? absoluteUrl(cfg.siteUrl, '/sitemap.xml') : null,
      // Signed-in surfaces are never useful to a crawler and are a
      // needless invitation to probe.
      disallow: ['/admin', '/portal', '/account', '/login'],
    });
  }

  async rss(schoolId: string): Promise<string> {
    const cfg = await this.config.load(schoolId);
    const school = await this.schools.findById(schoolId);
    const base = cfg.siteUrl;
    const title = cfg.siteTitle || school?.name || 'School news';

    if (!cfg.enabled || !base) {
      return buildRss({
        title,
        link: base || '',
        description: cfg.metaDescription || title,
        language: cfg.defaultLanguage,
        items: [],
      });
    }

    const { items } = await this.news.publishedFeed(schoolId, { take: 30 });
    return buildRss({
      title: `${title} — News`,
      link: absoluteUrl(base, '/news'),
      description: cfg.metaDescription || `Latest news from ${title}`,
      language: cfg.defaultLanguage,
      items: items.map((post) => ({
        title: post.title,
        link: absoluteUrl(base, `/news/${post.slug}`),
        description: post.excerpt ?? htmlToText(post.content).slice(0, 300),
        pubDate: post.publishedAt,
        guid: post.id,
      })),
    });
  }

  /**
   * The URL list the frontend's `app/sitemap.ts` renders. The Next app
   * knows its own public origin (it is being served from it), so it maps
   * these paths onto that origin — which is why the frontend, not this
   * service, owns the canonical `/sitemap.xml` the crawler fetches.
   */
  async sitemapUrls(
    schoolId: string,
  ): Promise<
    Array<{ path: string; lastModified: string | null; priority: number }>
  > {
    const cfg = await this.config.load(schoolId);
    if (!cfg.enabled || !cfg.indexable) return [];

    const [pages, news, galleries] = await Promise.all([
      this.pages.publishedPages(schoolId),
      this.news.publishedFeed(schoolId, { take: 500 }),
      this.galleries.publishedList(schoolId),
    ]);

    return [
      ...STATIC_ROUTES.map(([path, priority]) => ({
        path,
        lastModified: null,
        priority,
      })),
      ...pages.map((page) => ({
        path: `/${page.slug}`,
        lastModified: page.updatedAt.toISOString(),
        priority: 0.7,
      })),
      ...news.items.map((post) => ({
        path: `/news/${post.slug}`,
        lastModified: post.updatedAt.toISOString(),
        priority: 0.6,
      })),
      ...galleries.map((gallery) => ({
        path: `/gallery/${gallery.id}`,
        lastModified: gallery.updatedAt.toISOString(),
        priority: 0.4,
      })),
    ];
  }
}
