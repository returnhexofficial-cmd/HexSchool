/**
 * Slug rules for public URLs (roadmap M19 §7 — "slug kebab-case unique;
 * reserved slugs blocked"). Dependency-free and golden-tested: a slug is
 * part of the site's URL space, so it must never collide with a route the
 * app already owns, and it must round-trip through a URL untouched.
 */

/** Segments the application itself owns — a CMS page may not shadow one. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'portal',
  'login',
  'logout',
  'register',
  'account',
  'auth',
  'forgot-password',
  'reset-password',
  'verify',
  'admission',
  'admissions',
  'news',
  'notices',
  'events',
  'gallery',
  'downloads',
  'career',
  'careers',
  'faq',
  'contact',
  'committee',
  'teachers',
  'results',
  'achievements',
  'sitemap',
  'sitemap.xml',
  'robots.txt',
  'rss',
  'rss.xml',
  'static',
  '_next',
  'public',
  'maintenance',
]);

/** kebab-case: lowercase alphanumerics separated by single hyphens. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Combining marks left behind by an NFKD decomposition. */
const COMBINING_MARKS = /[̀-ͯ]/g;

export const MAX_SLUG_LENGTH = 120;

export function isKebabCase(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

/**
 * Why a slug is unacceptable, or `null` when it is fine. Returning the
 * reason (rather than a boolean) lets the service raise a message the
 * author can act on.
 */
export function slugError(slug: string): string | null {
  if (!slug) return 'Slug is required';
  if (slug.length > MAX_SLUG_LENGTH) {
    return `Slug must be at most ${MAX_SLUG_LENGTH} characters`;
  }
  if (!isKebabCase(slug)) {
    return 'Slug must be kebab-case: lowercase letters, digits and single hyphens (e.g. "principal-message")';
  }
  if (isReservedSlug(slug)) {
    return `"${slug}" is reserved by the application and cannot be used as a page slug`;
  }
  return null;
}

/**
 * Derives a kebab-case slug from a title. Bangla (and any other
 * non-ASCII) text has no ASCII transliteration here, so a title that
 * slugifies to nothing returns '' and the caller asks for an explicit
 * slug rather than inventing one.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
}

/**
 * `slugify` plus a uniqueness pass against slugs already taken: `about`,
 * `about-2`, `about-3`… The caller supplies the taken set (one indexed
 * query), so this stays pure.
 */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const root = slugify(base) || 'page';
  if (!taken.has(root)) return root;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${root.slice(0, MAX_SLUG_LENGTH - 5)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root.slice(0, MAX_SLUG_LENGTH - 14)}-${Date.now()}`;
}
