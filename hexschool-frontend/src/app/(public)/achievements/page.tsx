import type { Metadata } from "next";
import Link from "next/link";
import { publicSite } from "@/lib/api/public-site";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, Nothing, PageBanner, Section } from "../_components/ui";

/**
 * Achievements are news posts in the ACHIEVEMENT bucket — one table with
 * a category, not a second near-identical one.
 */
// Literal, not the imported constant: Next requires this value to be
// statically analyzable (it matches `SITE_REVALIDATE` in lib/api).
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Achievements",
  description: "Awards, results and recognitions earned by the school.",
  alternates: { canonical: "/achievements" },
};

export default async function AchievementsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  const feed = await publicSite.news({
    page: Number(page ?? 1) || 1,
    category: "ACHIEVEMENT",
  });

  return (
    <>
      <PageBanner
        title="Achievements"
        subtitle="What our students and teachers have won."
        breadcrumb="Achievements"
      />
      <Section>
        {!feed || feed.items.length === 0 ? (
          <Nothing>No achievements have been published yet.</Nothing>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {feed.items.map((post) => (
              <Link key={post.slug} href={`/news/${post.slug}`}>
                <Card className="h-full transition-shadow hover:shadow-md">
                  {post.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.coverUrl}
                      alt=""
                      className="h-40 w-full rounded-t-xl object-cover"
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
        )}
      </Section>
    </>
  );
}
