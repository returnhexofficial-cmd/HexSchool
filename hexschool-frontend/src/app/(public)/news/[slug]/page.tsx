import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { publicSite } from "@/lib/api/public-site";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatDate,
  PageBanner,
  RichText,
  Section,
} from "../../_components/ui";

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
  const post = await publicSite.newsPost(slug, preview);
  if (!post) return { title: "Not found" };

  return {
    title: post.metaTitle || post.title,
    description: post.metaDescription ?? post.excerpt ?? undefined,
    alternates: { canonical: `/news/${post.slug}` },
    ...(post.isDraft ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      type: "article",
      title: post.metaTitle || post.title,
      description: post.metaDescription ?? post.excerpt ?? undefined,
      publishedTime: post.publishedAt ?? undefined,
      ...(post.coverUrl ? { images: [{ url: post.coverUrl }] } : {}),
    },
  };
}

export default async function NewsPostPage({ params, searchParams }: Props) {
  const [{ slug }, { preview }] = await Promise.all([params, searchParams]);
  const post = await publicSite.newsPost(slug, preview);
  if (!post) notFound();

  // JSON-LD for the article itself, on top of the site-wide School node.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: post.title,
    datePublished: post.publishedAt ?? undefined,
    image: post.coverUrl ?? undefined,
    description: post.excerpt ?? undefined,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <PageBanner
        title={post.title}
        subtitle={post.excerpt}
        breadcrumb="News"
      />
      <Section className="max-w-3xl">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Badge variant="outline">{post.category}</Badge>
          <span className="text-sm text-muted-foreground">
            {formatDate(post.publishedAt)}
          </span>
          {post.isDraft ? <Badge variant="outline">Draft preview</Badge> : null}
        </div>
        {post.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.coverUrl}
            alt=""
            className="mb-8 w-full rounded-lg object-cover"
          />
        ) : null}
        <RichText html={post.content} />
        <div className="mt-10">
          <Button asChild variant="outline" size="sm">
            <Link href="/news">← Back to news</Link>
          </Button>
        </div>
      </Section>
    </>
  );
}
