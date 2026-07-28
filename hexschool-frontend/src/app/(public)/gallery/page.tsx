import type { Metadata } from "next";
import Link from "next/link";
import { publicSite } from "@/lib/api/public-site";
import { formatDate, Nothing, PageBanner, Section } from "../_components/ui";

// Literal, not the imported constant: Next requires this value to be
// statically analyzable (it matches `SITE_REVALIDATE` in lib/api).
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Gallery",
  description: "Photos and videos from school events.",
  alternates: { canonical: "/gallery" },
};

export default async function GalleryIndexPage() {
  const galleries = await publicSite.galleries();

  return (
    <>
      <PageBanner
        title="Gallery"
        subtitle="Moments from school life."
        breadcrumb="Gallery"
      />
      <Section>
        {!galleries || galleries.length === 0 ? (
          <Nothing>No albums have been published yet.</Nothing>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {galleries.map((gallery) => (
              <Link
                key={gallery.id}
                href={`/gallery/${gallery.id}`}
                className="group overflow-hidden rounded-lg border"
              >
                {gallery.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={gallery.coverUrl}
                    alt=""
                    className="h-48 w-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="h-48 w-full bg-muted" />
                )}
                <div className="p-4">
                  <h2 className="font-medium">{gallery.title}</h2>
                  <p className="text-sm text-muted-foreground">
                    {[
                      formatDate(gallery.eventDate),
                      gallery.itemCount
                        ? `${gallery.itemCount} item${gallery.itemCount === 1 ? "" : "s"}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
