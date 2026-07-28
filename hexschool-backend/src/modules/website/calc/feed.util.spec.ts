import {
  absoluteUrl,
  buildRobots,
  buildRss,
  buildSitemap,
  escapeXml,
  toRfc822,
} from './feed.util';

describe('feed.util', () => {
  describe('escapeXml', () => {
    it('escapes all five predefined entities', () => {
      expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe(
        '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;',
      );
    });
  });

  describe('absoluteUrl', () => {
    it.each([
      ['https://school.edu.bd', '/news', 'https://school.edu.bd/news'],
      ['https://school.edu.bd/', '/news', 'https://school.edu.bd/news'],
      ['https://school.edu.bd/', 'news', 'https://school.edu.bd/news'],
      ['https://school.edu.bd', '/', 'https://school.edu.bd'],
    ])('%s + %s → %s', (base, path, expected) => {
      expect(absoluteUrl(base, path)).toBe(expected);
    });
  });

  describe('buildSitemap', () => {
    it('renders loc/lastmod/changefreq/priority', () => {
      const xml = buildSitemap([
        {
          loc: 'https://school.edu.bd/',
          lastmod: new Date('2026-07-24T10:00:00.000Z'),
          changefreq: 'daily',
          priority: 1,
        },
      ]);
      expect(xml).toContain('<loc>https://school.edu.bd/</loc>');
      expect(xml).toContain('<lastmod>2026-07-24T10:00:00.000Z</lastmod>');
      expect(xml).toContain('<changefreq>daily</changefreq>');
      expect(xml).toContain('<priority>1.0</priority>');
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(
        true,
      );
    });

    it('omits lastmod when the date is missing or unparseable', () => {
      const xml = buildSitemap([
        { loc: 'https://x/a', lastmod: null },
        { loc: 'https://x/b', lastmod: 'not-a-date' },
      ]);
      expect(xml).not.toContain('<lastmod>');
    });

    it('escapes a query string in a URL', () => {
      expect(buildSitemap([{ loc: 'https://x/a?b=1&c=2' }])).toContain(
        '<loc>https://x/a?b=1&amp;c=2</loc>',
      );
    });

    it('produces a valid empty urlset for a school with no content', () => {
      // Roadmap §8: a school with nothing published still needs a sitemap
      // a crawler will accept.
      const xml = buildSitemap([]);
      expect(xml).toContain('<urlset');
      expect(xml).toContain('</urlset>');
      expect(xml).not.toContain('<url>');
    });
  });

  describe('buildRobots', () => {
    it('allows crawling and points at the sitemap', () => {
      const txt = buildRobots({
        allow: true,
        sitemapUrl: 'https://school.edu.bd/sitemap.xml',
        disallow: ['/admin', '/portal'],
      });
      expect(txt).toContain('User-agent: *');
      expect(txt).toContain('Allow: /');
      expect(txt).toContain('Disallow: /admin');
      expect(txt).toContain('Sitemap: https://school.edu.bd/sitemap.xml');
    });

    it('disallows everything when the site is not indexable', () => {
      const txt = buildRobots({ allow: false });
      expect(txt).toContain('Disallow: /');
      expect(txt).not.toContain('Allow: /');
    });
  });

  describe('buildRss', () => {
    it('renders an RFC 822 pubDate', () => {
      expect(toRfc822(new Date('2026-07-24T10:00:00.000Z'))).toBe(
        'Fri, 24 Jul 2026 10:00:00 GMT',
      );
    });

    it('renders channel head and items', () => {
      const xml = buildRss({
        title: 'Demo School — News',
        link: 'https://school.edu.bd',
        description: 'Latest news',
        language: 'en',
        items: [
          {
            title: 'Annual sports & prize day',
            link: 'https://school.edu.bd/news/sports-day',
            description: 'Held on the school ground',
            pubDate: new Date('2026-07-20T04:00:00.000Z'),
            guid: 'news-1',
          },
        ],
      });
      expect(xml).toContain('<rss version="2.0">');
      expect(xml).toContain('<title>Demo School — News</title>');
      expect(xml).toContain('<title>Annual sports &amp; prize day</title>');
      expect(xml).toContain('<pubDate>Mon, 20 Jul 2026 04:00:00 GMT</pubDate>');
      expect(xml).toContain('<guid isPermaLink="false">news-1</guid>');
    });

    it('falls back to the link as guid and omits an absent pubDate', () => {
      const xml = buildRss({
        title: 'T',
        link: 'https://x',
        description: 'D',
        items: [{ title: 'A', link: 'https://x/a' }],
      });
      expect(xml).toContain('<guid isPermaLink="false">https://x/a</guid>');
      expect(xml).not.toContain('<pubDate>');
    });

    it('produces a valid empty channel', () => {
      const xml = buildRss({
        title: 'T',
        link: 'https://x',
        description: 'D',
        items: [],
      });
      expect(xml).toContain('</channel>');
      expect(xml).not.toContain('<item>');
    });
  });
});
