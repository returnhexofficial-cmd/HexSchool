import type { Metadata } from "next";
import Link from "next/link";
import { publicSite } from "@/lib/api/public-site";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, Nothing, PageBanner, Section } from "../_components/ui";

// Literal, not the imported constant: Next requires this value to be
// statically analyzable (it matches `SITE_REVALIDATE` in lib/api).
export const revalidate = 60;

export const metadata: Metadata = {
  title: "News & blog",
  description: "Latest news, blog posts and announcements from the school.",
  alternates: { canonical: "/news" },
};

export default async function NewsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string }>;
}) {
  const { page, search } = await searchParams;
  const current = Number(page ?? 1) || 1;
  const feed = await publicSite.news({ page: current, search });

  return (
    <>
      <PageBanner
        title="News & blog"
        subtitle="What is happening at the school."
        breadcrumb="News"
      />
      <Section>
        {!feed || feed.items.length === 0 ? (
          <Nothing>
            {search
              ? `Nothing matched “${search}”.`
              : "No posts have been published yet."}
          </Nothing>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {feed.items.map((post) => (
                <Link key={post.slug} href={`/news/${post.slug}`}>
                  <Card className="h-full transition-shadow hover:shadow-md">
                    {post.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={post.coverUrl}
                        alt=""
                        className="h-44 w-full rounded-t-xl object-cover"
                      />
                    ) : null}
                    <CardContent className="p-5">
                      <p className="text-xs text-muted-foreground">
                        {formatDate(post.publishedAt)}
                      </p>
                      <h2 className="mt-1 font-medium">{post.title}</h2>
                      {post.excerpt ? (
                        <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                          {post.excerpt}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>

            {feed.meta.totalPages > 1 ? (
              <nav className="mt-8 flex items-center justify-center gap-3">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  disabled={current <= 1}
                >
                  <Link href={`/news?page=${Math.max(1, current - 1)}`}>
                    Previous
                  </Link>
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {feed.meta.page} of {feed.meta.totalPages}
                </span>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  disabled={current >= feed.meta.totalPages}
                >
                  <Link
                    href={`/news?page=${Math.min(feed.meta.totalPages, current + 1)}`}
                  >
                    Next
                  </Link>
                </Button>
              </nav>
            ) : null}
          </>
        )}
      </Section>
    </>
  );
}
