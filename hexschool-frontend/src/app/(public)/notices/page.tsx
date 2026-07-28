import type { Metadata } from "next";
import Link from "next/link";
import { publicSite } from "@/lib/api/public-site";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, Nothing, PageBanner, Section } from "../_components/ui";

/**
 * The public notice board. Notices are Module 17 rows; only those marked
 * both PUBLISHED and website-visible reach this page — the API applies
 * that filter, not this component.
 */
// Literal, not the imported constant: Next requires this value to be
// statically analyzable (it matches `SITE_REVALIDATE` in lib/api).
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Notice board",
  description: "Circulars, notices and announcements from the school office.",
  alternates: { canonical: "/notices" },
};

export default async function NoticesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string }>;
}) {
  const { page, search } = await searchParams;
  const current = Number(page ?? 1) || 1;
  const feed = await publicSite.notices({ page: current, search });

  return (
    <>
      <PageBanner
        title="Notice board"
        subtitle="Circulars and announcements, newest first."
        breadcrumb="Notices"
      />
      <Section>
        <form className="mb-6 flex gap-2" action="/notices">
          <input
            type="search"
            name="search"
            defaultValue={search ?? ""}
            placeholder="Search notices"
            aria-label="Search notices"
            className="h-9 w-full max-w-sm rounded-md border bg-background px-3 text-sm"
          />
          <Button type="submit" size="sm" variant="outline">
            Search
          </Button>
        </form>

        {!feed || feed.items.length === 0 ? (
          <Nothing>No notices have been published yet.</Nothing>
        ) : (
          <ul className="divide-y rounded-lg border">
            {feed.items.map((notice) => (
              <li key={notice.id} id={notice.id} className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  {notice.pinned ? <Badge>Pinned</Badge> : null}
                  <span className="text-xs text-muted-foreground">
                    {formatDate(notice.publishedAt)}
                  </span>
                </div>
                <h2 className="mt-1 font-medium">{notice.title}</h2>
                <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                  {notice.body}
                </p>
                {notice.attachmentUrls.length > 0 ? (
                  <p className="mt-3 flex flex-wrap gap-3">
                    {notice.attachmentUrls.map((url, index) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary underline"
                      >
                        Attachment {index + 1}
                      </a>
                    ))}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {feed && feed.meta.totalPages > 1 ? (
          <nav className="mt-8 flex items-center justify-center gap-3">
            <Button asChild variant="outline" size="sm">
              <Link href={`/notices?page=${Math.max(1, current - 1)}`}>
                Previous
              </Link>
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {feed.meta.page} of {feed.meta.totalPages}
            </span>
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/notices?page=${Math.min(feed.meta.totalPages, current + 1)}`}
              >
                Next
              </Link>
            </Button>
          </nav>
        ) : null}
      </Section>
    </>
  );
}
