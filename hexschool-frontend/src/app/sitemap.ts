import type { MetadataRoute } from "next";
import { publicSite } from "@/lib/api/public-site";

/**
 * `/sitemap.xml` for the public website (roadmap M19 §4).
 *
 * The API supplies the *paths* (which CMS pages, news posts and galleries
 * are published) and this file maps them onto the site's own origin —
 * because only the Next app is actually served from that origin. The API
 * also renders a complete `sitemap.xml` of its own from the
 * `website.site_url` setting, for anyone fetching it from the API host.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [urls, config] = await Promise.all([
    publicSite.sitemapUrls(),
    publicSite.config(),
  ]);

  const base = (
    config?.site.siteUrl ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    ""
  ).replace(/\/+$/, "");
  if (!base || !urls || urls.length === 0) return [];

  return urls.map((entry) => ({
    url: `${base}${entry.path === "/" ? "" : entry.path}`,
    ...(entry.lastModified
      ? { lastModified: new Date(entry.lastModified) }
      : {}),
    priority: entry.priority,
  }));
}
