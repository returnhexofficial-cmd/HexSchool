/**
 * Sitemap / robots / RSS writers (roadmap M19 §4). Dependency-free and
 * golden-tested, in the spirit of `academic/calendar/ics.util.ts` (M05):
 * these are strict text formats a crawler parses, so getting the escaping
 * and the date shapes right matters more than the plumbing around them.
 */

export interface SitemapEntry {
  /** Absolute URL. */
  loc: string;
  lastmod?: Date | string | null;
  changefreq?:
    'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  /** 0.0–1.0. */
  priority?: number;
}

export interface RssItem {
  title: string;
  link: string;
  description?: string | null;
  pubDate?: Date | string | null;
  guid?: string | null;
}

export interface RssChannel {
  title: string;
  link: string;
  description: string;
  language?: string;
  items: RssItem[];
}

/** XML text escaping — the five predefined entities, nothing else. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Joins a base URL and a path without doubling or dropping the slash. */
export function absoluteUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const rest = path.startsWith('/') ? path : `/${path}`;
  return `${base}${rest === '/' ? '' : rest}`;
}

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** RFC 822 date, which is what RSS 2.0 `<pubDate>` requires. */
export function toRfc822(
  value: Date | string | null | undefined,
): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toUTCString();
}

export function buildSitemap(entries: ReadonlyArray<SitemapEntry>): string {
  const urls = entries
    .map((entry) => {
      const lastmod = toIsoDate(entry.lastmod);
      const lines = [`    <loc>${escapeXml(entry.loc)}</loc>`];
      if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
      if (entry.changefreq) {
        lines.push(`    <changefreq>${entry.changefreq}</changefreq>`);
      }
      if (entry.priority !== undefined) {
        lines.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
      }
      return `  <url>\n${lines.join('\n')}\n  </url>`;
    })
    .join('\n');

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  if (urls) lines.push(urls);
  lines.push('</urlset>');
  return `${lines.join('\n')}\n`;
}

/**
 * robots.txt. `allow` false produces a full disallow — a school that has
 * not launched its site yet should not be indexed half-built, which is
 * what the `website.indexable` setting is for.
 */
export function buildRobots(options: {
  allow: boolean;
  sitemapUrl?: string | null;
  disallow?: ReadonlyArray<string>;
}): string {
  const lines = ['User-agent: *'];
  if (!options.allow) {
    lines.push('Disallow: /');
  } else {
    lines.push('Allow: /');
    for (const path of options.disallow ?? []) lines.push(`Disallow: ${path}`);
  }
  if (options.sitemapUrl) {
    lines.push('', `Sitemap: ${options.sitemapUrl}`);
  }
  return `${lines.join('\n')}\n`;
}

export function buildRss(channel: RssChannel): string {
  const items = channel.items
    .map((item) => {
      const lines = [
        `      <title>${escapeXml(item.title)}</title>`,
        `      <link>${escapeXml(item.link)}</link>`,
        `      <guid isPermaLink="false">${escapeXml(item.guid ?? item.link)}</guid>`,
      ];
      if (item.description) {
        lines.push(
          `      <description>${escapeXml(item.description)}</description>`,
        );
      }
      const pubDate = toRfc822(item.pubDate);
      if (pubDate) lines.push(`      <pubDate>${pubDate}</pubDate>`);
      return `    <item>\n${lines.join('\n')}\n    </item>`;
    })
    .join('\n');

  const head = [
    `    <title>${escapeXml(channel.title)}</title>`,
    `    <link>${escapeXml(channel.link)}</link>`,
    `    <description>${escapeXml(channel.description)}</description>`,
    `    <language>${escapeXml(channel.language ?? 'en')}</language>`,
  ].join('\n');

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    head,
  ];
  if (items) lines.push(items);
  lines.push('  </channel>', '</rss>');
  return `${lines.join('\n')}\n`;
}
