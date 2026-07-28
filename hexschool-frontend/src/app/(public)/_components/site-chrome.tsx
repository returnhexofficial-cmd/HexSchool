import Link from "next/link";
import type { SiteConfig } from "@/lib/api/public-site";
import { MobileNav } from "./mobile-nav";

/**
 * Header and footer for the public website (Module 19). Server
 * components: the navigation comes from the CMS (`showInMenu` pages) plus
 * the fixed feature routes, so it is part of the ISR-cached HTML and
 * needs no client JavaScript — only the mobile drawer is interactive.
 */

const FIXED_LINKS = [
  { href: "/notices", label: "Notices" },
  { href: "/news", label: "News" },
  { href: "/teachers", label: "Teachers" },
  { href: "/gallery", label: "Gallery" },
  { href: "/admission", label: "Admission" },
  { href: "/results", label: "Results" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader({ config }: { config: SiteConfig | null }) {
  const title = config?.site.title || "HexSchool";
  const cmsLinks = (config?.menu ?? []).map((page) => ({
    href: `/${page.slug}`,
    label: page.title,
  }));
  const links = [...cmsLinks, ...FIXED_LINKS];

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          {config?.school?.logoUrl ? (
            // Signed S3 URLs rotate hourly, so next/image's optimizer would
            // cache a URL that outlives its signature — a plain <img> is
            // the honest choice here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={config.school.logoUrl}
              alt=""
              className="h-10 w-10 shrink-0 rounded object-contain"
            />
          ) : null}
          <span className="min-w-0">
            <span className="block truncate text-base font-semibold leading-tight">
              {title}
            </span>
            {config?.site.tagline ? (
              <span className="block truncate text-xs text-muted-foreground">
                {config.site.tagline}
              </span>
            ) : null}
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 lg:flex">
          {links.slice(0, 8).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/login"
            className="ml-2 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            Sign in
          </Link>
        </nav>

        <div className="ml-auto lg:hidden">
          <MobileNav links={links} />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ config }: { config: SiteConfig | null }) {
  const school = config?.school;
  const site = config?.site;
  const socials = [
    ["Facebook", site?.social.facebook],
    ["YouTube", site?.social.youtube],
    ["LinkedIn", site?.social.linkedin],
    ["X", site?.social.x],
  ].filter(([, url]) => Boolean(url)) as Array<[string, string]>;

  return (
    <footer className="mt-16 border-t bg-muted/30">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">
            {site?.title || school?.name || "Our school"}
          </h2>
          {school?.address ? (
            <p className="text-sm text-muted-foreground">{school.address}</p>
          ) : null}
          {school?.phone ? (
            <p className="text-sm text-muted-foreground">{school.phone}</p>
          ) : null}
          {school?.email ? (
            <p className="text-sm text-muted-foreground">{school.email}</p>
          ) : null}
          {school?.eiin ? (
            <p className="text-sm text-muted-foreground">EIIN {school.eiin}</p>
          ) : null}
        </div>

        <FooterColumn
          title="Explore"
          links={[
            { href: "/notices", label: "Notice board" },
            { href: "/news", label: "News & blog" },
            { href: "/events", label: "Events" },
            { href: "/achievements", label: "Achievements" },
            { href: "/gallery", label: "Gallery" },
          ]}
        />
        <FooterColumn
          title="Services"
          links={[
            { href: "/admission", label: "Online admission" },
            { href: "/results", label: "Result search" },
            { href: "/verify/student", label: "Student verification" },
            { href: "/verify/certificate", label: "Certificate check" },
            { href: "/downloads", label: "Downloads" },
          ]}
        />
        <FooterColumn
          title="School"
          links={[
            { href: "/committee", label: "Managing committee" },
            { href: "/teachers", label: "Teachers & staff" },
            { href: "/career", label: "Career" },
            { href: "/faq", label: "FAQ" },
            { href: "/contact", label: "Contact" },
          ]}
        />
      </div>

      <div className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            {site?.footerText ||
              `© ${new Date().getFullYear()} ${school?.name ?? ""}`.trim()}
          </p>
          {socials.length > 0 ? (
            <p className="flex gap-3">
              {socials.map(([label, url]) => (
                <a
                  key={label}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground"
                >
                  {label}
                </a>
              ))}
            </p>
          ) : null}
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: Array<{ href: string; label: string }>;
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <ul className="space-y-1.5">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
