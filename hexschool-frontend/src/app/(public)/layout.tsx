import type { Metadata } from "next";
import { publicSite } from "@/lib/api/public-site";
import { PageViewBeacon } from "./_components/page-view-beacon";
import { SiteFooter, SiteHeader } from "./_components/site-chrome";

/**
 * The public website shell (Module 19). ISR at 60 s (roadmap §5), so the
 * chrome and its CMS-driven navigation are regenerated on a schedule
 * rather than fetched per request.
 */
// Literal, not the imported constant: Next requires this value to be
// statically analyzable (it matches `SITE_REVALIDATE` in lib/api).
export const revalidate = 60;

/**
 * The absolute origin every relative metadata URL is resolved against.
 *
 * `metadataBase` is not optional in practice: without it Next emits the
 * canonical exactly as written (`/`), and a relative canonical is one a
 * crawler rejects — which is how Lighthouse caught this. So the chain
 * always ends somewhere absolute: the school's configured domain first,
 * then the deploy-time env var, then localhost for a dev build.
 */
function resolveSiteOrigin(configured: string | null | undefined): URL {
  for (const candidate of [configured, process.env.NEXT_PUBLIC_SITE_URL]) {
    if (!candidate) continue;
    try {
      return new URL(candidate);
    } catch {
      // An admin can type anything into the settings field; a bad value
      // must not take the whole site's metadata down with it.
    }
  }
  return new URL("http://localhost:3000");
}

/**
 * Site-wide SEO defaults. Per-page `generateMetadata` overrides the title
 * and description; `metadataBase` makes every relative canonical and
 * OpenGraph image absolute, which is what a crawler needs.
 */
export async function generateMetadata(): Promise<Metadata> {
  const config = await publicSite.config();
  const title = config?.site.title || "School";
  const description =
    config?.site.metaDescription ||
    config?.site.tagline ||
    `${title} — notices, results, admission and news.`;

  return {
    metadataBase: resolveSiteOrigin(config?.site.siteUrl),
    title: { default: title, template: `%s · ${title}` },
    description,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      siteName: title,
      title,
      description,
      ...(config?.site.ogImageUrl
        ? { images: [{ url: config.site.ogImageUrl }] }
        : {}),
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const config = await publicSite.config();

  // JSON-LD (roadmap §5): describes the institution to search engines.
  // `<` is escaped per Next's own guidance, since the values are
  // admin-authored strings.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "School",
    name: config?.site.title || config?.school?.name || "",
    url: config?.site.siteUrl || undefined,
    logo: config?.school?.logoUrl || undefined,
    description: config?.site.metaDescription || undefined,
    email: config?.school?.email || undefined,
    telephone: config?.school?.phone || undefined,
    foundingDate: config?.school?.establishedYear
      ? String(config.school.establishedYear)
      : undefined,
    address: config?.school?.address
      ? { "@type": "PostalAddress", streetAddress: config.school.address }
      : undefined,
  };

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <PageViewBeacon />
      <SiteHeader config={config} />
      <div className="flex-1">{children}</div>
      <SiteFooter config={config} />
    </div>
  );
}
