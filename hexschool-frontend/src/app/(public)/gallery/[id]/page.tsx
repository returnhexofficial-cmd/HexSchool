import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { publicSite } from "@/lib/api/public-site";
import { Button } from "@/components/ui/button";
import { formatDate, Nothing, PageBanner, Section } from "../../_components/ui";
import { Lightbox } from "./lightbox";

/**
 * One album. Items are paginated server-side (roadmap §8 — a very large
 * gallery must not load 400 images at once); the lightbox is the only
 * client component on the page.
 */
// Literal, not the imported constant: Next requires this value to be
// statically analyzable (it matches `SITE_REVALIDATE` in lib/api).
export const revalidate = 60;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const gallery = await publicSite.gallery(id);
  if (!gallery) return { title: "Not found" };
  return {
    title: gallery.title,
    description: gallery.description ?? undefined,
    alternates: { canonical: `/gallery/${id}` },
    ...(gallery.coverUrl
      ? { openGraph: { images: [{ url: gallery.coverUrl }] } }
      : {}),
  };
}

export default async function GalleryDetailPage({
  params,
  searchParams,
}: Props) {
  const [{ id }, { page }] = await Promise.all([params, searchParams]);
  const current = Number(page ?? 1) || 1;
  const gallery = await publicSite.gallery(id, current);
  if (!gallery) notFound();

  return (
    <>
      <PageBanner
        title={gallery.title}
        subtitle={
          gallery.description ??
          (gallery.eventDate ? formatDate(gallery.eventDate) : undefined)
        }
        breadcrumb="Gallery"
      />
      <Section>
        {gallery.items.length === 0 ? (
          <Nothing>This album is empty.</Nothing>
        ) : (
          <Lightbox items={gallery.items} />
        )}

        {gallery.meta.totalPages > 1 ? (
          <nav className="mt-8 flex items-center justify-center gap-3">
            <Button asChild variant="outline" size="sm">
              <Link href={`/gallery/${id}?page=${Math.max(1, current - 1)}`}>
                Previous
              </Link>
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {gallery.meta.page} of {gallery.meta.totalPages}
            </span>
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/gallery/${id}?page=${Math.min(gallery.meta.totalPages, current + 1)}`}
              >
                Next
              </Link>
            </Button>
          </nav>
        ) : null}

        <div className="mt-8">
          <Button asChild variant="outline" size="sm">
            <Link href="/gallery">← All albums</Link>
          </Button>
        </div>
      </Section>
    </>
  );
}
