import Link from "next/link";
import { publicSite } from "@/lib/api/public-site";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, Nothing, Section } from "./_components/ui";

/**
 * The school home page (roadmap M19 §5): hero, notice ticker, stats,
 * news, events, gallery strip and the principal's message teaser. One
 * server round trip (`GET /public/home`), regenerated every 60 s.
 *
 * Every section is conditional — a school that has published nothing yet
 * gets a tasteful page, not a grid of empty boxes (roadmap §8).
 */
// Literal, not the imported constant: Next requires this value to be
// statically analyzable (it matches `SITE_REVALIDATE` in lib/api).
export const revalidate = 60;

export default async function HomePage() {
  const [home, config] = await Promise.all([
    publicSite.home(),
    publicSite.config(),
  ]);

  if (!home) {
    return (
      <Section>
        <Nothing>
          The website is being set up. Please check back shortly.
          <div className="mt-4">
            <Button asChild size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </Nothing>
      </Section>
    );
  }

  const slide = home.hero.slides[0];
  const title = config?.site.title ?? "";

  return (
    <>
      {/* ── hero ───────────────────────────────────────────────────── */}
      <section className="relative border-b bg-linear-to-br from-primary/10 via-background to-background">
        {slide?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={slide.imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-20"
          />
        ) : null}
        <div className="relative mx-auto w-full max-w-6xl px-4 py-16 sm:py-24">
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            {slide?.title || title || "Welcome"}
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            {slide?.subtitle ||
              config?.site.tagline ||
              config?.site.metaDescription ||
              "Notices, results, admission and everything else, in one place."}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href={slide?.ctaHref || "/admission"}>
                {slide?.ctaLabel || "Apply for admission"}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/results">Check results</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── notice ticker ──────────────────────────────────────────── */}
      {home.notices.length > 0 ? (
        <div className="border-b bg-primary/5">
          <div className="mx-auto flex w-full max-w-6xl items-center gap-3 overflow-hidden px-4 py-2.5">
            <Badge className="shrink-0">Notice</Badge>
            <div className="flex min-w-0 flex-1 gap-6 overflow-x-auto text-sm scrollbar-none">
              {home.notices.slice(0, 5).map((notice) => (
                <Link
                  key={notice.id}
                  href={`/notices#${notice.id}`}
                  className="shrink-0 whitespace-nowrap hover:underline"
                >
                  {notice.title}
                </Link>
              ))}
            </div>
            <Link
              href="/notices"
              className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
            >
              All
            </Link>
          </div>
        </div>
      ) : null}

      {/* ── stats ──────────────────────────────────────────────────── */}
      <Section className="py-10">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Students" value={home.stats.students} />
          <Stat label="Teachers" value={home.stats.teachers} />
          <Stat label="Staff" value={home.stats.staff} />
          <Stat label="Classes" value={home.stats.classes} />
        </dl>
      </Section>

      {/* ── principal's message ────────────────────────────────────── */}
      {home.principalMessage ? (
        <Section className="py-6">
          <Card>
            <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-start">
              {home.principalMessage.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={home.principalMessage.photoUrl}
                  alt=""
                  className="h-28 w-28 shrink-0 rounded-lg object-cover"
                />
              ) : null}
              <div className="min-w-0">
                <h2 className="text-xl font-semibold">
                  {home.principalMessage.designation}&rsquo;s message
                </h2>
                <p className="mt-2 text-muted-foreground">
                  {home.principalMessage.teaser}
                </p>
                <p className="mt-3 text-sm font-medium">
                  — {home.principalMessage.name}
                </p>
                <Button asChild variant="link" className="mt-1 h-auto p-0">
                  <Link href="/committee">Read more</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </Section>
      ) : null}

      {/* ── news ───────────────────────────────────────────────────── */}
      {home.news.length > 0 ? (
        <Section
          title="Latest news"
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/news">All news</Link>
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {home.news.map((post) => (
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
                    <h3 className="mt-1 font-medium">{post.title}</h3>
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
        </Section>
      ) : null}

      {/* ── events ─────────────────────────────────────────────────── */}
      {home.events.length > 0 ? (
        <Section
          title="Upcoming events"
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/events">Calendar</Link>
            </Button>
          }
        >
          <ul className="divide-y rounded-lg border">
            {home.events.map((event) => (
              <li key={event.id} className="flex gap-4 p-4">
                <div className="w-24 shrink-0 text-sm text-muted-foreground">
                  {formatDate(event.startDate)}
                </div>
                <div className="min-w-0">
                  <p className="font-medium">{event.title}</p>
                  {event.description ? (
                    <p className="text-sm text-muted-foreground">
                      {event.description}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* ── achievements ───────────────────────────────────────────── */}
      {home.achievements.length > 0 ? (
        <Section
          title="Achievements"
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/achievements">All achievements</Link>
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {home.achievements.map((post) => (
              <Link key={post.slug} href={`/news/${post.slug}`}>
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardContent className="p-5">
                    <Badge variant="outline">Achievement</Badge>
                    <h3 className="mt-2 font-medium">{post.title}</h3>
                    {post.excerpt ? (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {post.excerpt}
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </Section>
      ) : null}

      {/* ── gallery strip ──────────────────────────────────────────── */}
      {home.galleries.length > 0 ? (
        <Section
          title="From the gallery"
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/gallery">All albums</Link>
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {home.galleries.map((gallery) => (
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
                    className="h-36 w-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="h-36 w-full bg-muted" />
                )}
                <div className="p-3">
                  <p className="truncate text-sm font-medium">
                    {gallery.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(gallery.eventDate)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </Section>
      ) : null}

      {/* ── quick links ────────────────────────────────────────────── */}
      {(config?.site.quickLinks?.length ?? 0) > 0 ? (
        <Section title="Quick links">
          <div className="flex flex-wrap gap-2">
            {config?.site.quickLinks.map((link) =>
              link.href && link.label ? (
                <Button key={link.href} asChild variant="outline" size="sm">
                  <Link href={link.href}>{link.label}</Link>
                </Button>
              ) : null,
            )}
          </div>
        </Section>
      ) : null}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-5 text-center">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-3xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
