import type { MetadataRoute } from "next";
import { publicSite } from "@/lib/api/public-site";

/**
 * `/robots.txt`. Signed-in surfaces are never useful to a crawler, and a
 * school that has switched its site off (`website.enabled`) or asked not
 * to be indexed (`website.indexable`) gets a full disallow — the same
 * rule the API's own `robots.txt` renderer applies.
 */
export const revalidate = 3600;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const config = await publicSite.config();
  const base = (
    config?.site.siteUrl ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    ""
  ).replace(/\/+$/, "");

  // No config at all means the API is unreachable or the site is
  // disabled: fail closed rather than inviting a crawl of a broken site.
  if (!config) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/portal", "/account", "/login"],
    },
    ...(base ? { sitemap: `${base}/sitemap.xml` } : {}),
  };
}
