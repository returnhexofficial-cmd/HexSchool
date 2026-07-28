import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicSite } from "@/lib/api/public-site";
import { Badge } from "@/components/ui/badge";
import { formatDate, PageBanner, RichText, Section } from "../_components/ui";

/**
 * A CMS page at the site root (`/about`, `/history`, `/mission-vision`).
 * Static segments win over this dynamic one in Next's route matching, so
 * `/news`, `/contact` and friends keep their own pages — which is exactly
 * why the backend refuses those words as slugs (`calc/slug.util.ts`).
 *
 * `?preview=<token>` renders a DRAFT for whoever holds a signed token;
 * that request is fetched uncached, since it is one editor's view.
 */
// Literal, not the imported constant: Next requires this value to be
// statically analyzable (it matches `SITE_REVALIDATE` in lib/api).
export const revalidate = 60;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string }>;
};

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const [{ slug }, { preview }] = await Promise.all([params, searchParams]);
  const page = await publicSite.page(slug, preview);
  if (!page) return { title: "Not found" };

  return {
    title: page.metaTitle || page.title,
    description: page.metaDescription ?? undefined,
    alternates: { canonical: `/${page.slug}` },
    // A draft must never be indexed, even if the preview link leaks.
    ...(page.isDraft ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      type: "article",
      title: page.metaTitle || page.title,
      description: page.metaDescription ?? undefined,
      ...(page.ogImageUrl ? { images: [{ url: page.ogImageUrl }] } : {}),
    },
  };
}

export default async function CmsPage({ params, searchParams }: Props) {
  const [{ slug }, { preview }] = await Promise.all([params, searchParams]);
  const page = await publicSite.page(slug, preview);
  if (!page) notFound();

  return (
    <>
      <PageBanner
        title={page.title}
        subtitle={page.excerpt}
        breadcrumb={page.title}
      />
      <Section className="max-w-3xl">
        {page.isDraft ? (
          <Badge variant="outline" className="mb-4">
            Draft preview — not visible to the public
          </Badge>
        ) : null}
        <RichText html={page.content} />
        {page.publishedAt ? (
          <p className="mt-10 text-xs text-muted-foreground">
            Last updated {formatDate(page.updatedAt)}
          </p>
        ) : null}
      </Section>
    </>
  );
}
