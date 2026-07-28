# Module 19 — Website CMS (Public Site) · Completion Document

| | |
|---|---|
| **Module** | 19 — Website CMS (Public Site) — *Phase 2 begins* |
| **Completion date** | 2026-07-28 |
| **Actual effort** | 1 dev-day (est. was 7) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 19 |

## Summary of Implemented Features

The school's public face, and the first module whose primary audience is
**strangers**. Everything else in this system answers an authenticated
user; this one answers the internet, so its governing concern is not
arithmetic but **disclosure**.

- **Nine content types** behind one admin API (`/api/v1/cms/*`): CMS
  pages, news/blog/achievement posts, photo & video galleries,
  downloads, job openings + their applications, FAQs, committee members
  and the contact inbox.
- **One publication rule, no exceptions.** Every content table carries the
  same `web_content_status_enum` (`DRAFT | PUBLISHED`), and every public
  read goes through a repository `published*` helper that pins
  `status = PUBLISHED AND deleted_at IS NULL`. A public endpoint cannot
  forget the filter because it never writes one.
- **Markup is sanitized on WRITE**, not on render (`calc/html-sanitize.util.ts`):
  an allow-list of tags, attributes and URL schemes; `<script>`/`<style>`/
  `<iframe>`/`<form>` dropped with their contents; unknown tags unwrapped;
  `javascript:`/`data:` URLs stripped; `target="_blank"` given
  `rel="noopener"`; unbalanced markup closed, with HTML's optional end
  tags honoured (`<p>a<p>b` is two paragraphs, not a nest). The stored row
  is already safe, so every reader — the site, a future mobile client, an
  RSS consumer — benefits without repeating the check.
- **Slugs are URL policy** (`calc/slug.util.ts`): kebab-case, unique per
  school among live rows (partial unique index), and refused when they
  would shadow an application route (`admin`, `api`, `portal`, `news`,
  `contact`, …). The frontend mirrors the same list so the editor objects
  before the request is sent.
- **Draft preview by signed token.** An editor mints a 30-minute token
  naming *one row*; the public endpoint serves that draft and nothing
  else. An expired, forged or wrong-row token produces the same 404 an
  anonymous visitor gets — never a hint that a draft exists.
- **Composite public API** (`/api/v1/public/*`): `home` (hero, notice
  ticker, stats, news, events, gallery strip, principal's message),
  `config` (identity, navigation, socials, feature flags), plus feeds for
  notices, news, events, galleries, downloads, careers, FAQs, committee
  and the teacher directory. Cached in Redis for
  `website.cache_ttl_seconds` (60 s), busted on every admin write,
  degrading to a live query when Redis is down.
- **The teacher directory's SELECT list *is* its privacy policy.** Contact
  details live on the `users` row (M08 — a teacher shares the user), and
  the directory query never joins `users`, so a phone number is not
  filtered out — it is never fetched.
- **Student verification** (`POST /public/verify/student`) by permanent
  UID or rotatable QR token, revealing only the fields
  `website.student_verification_fields` allows, rate-limited 10/min/IP,
  reCAPTCHA-verified. A miss, a soft-deleted student and a disabled
  feature all answer the **same** 404.
- **Certificate verification** answers `{ available: false, reason }` — the
  M09 self-describing-stub pattern. The page exists now so printed
  certificates can already carry the URL; Module 27 fills in the lookup.
- **Contact form** with three independent defences (reCAPTCHA, the route
  throttle, and a per-IP hourly cap), storing the body as **plain text**
  so nothing that arrives can ever be rendered as markup. Notifies every
  admin in-app and optionally emails `website.contact_email` — through
  `NotificationService.send()`, never a direct mailer (the M17 rule).
- **Career applications**: CV must be a PDF within
  `website.career_cv_max_mb`, the opening is re-resolved through the
  published-and-open query (an id scraped from a closed posting cannot be
  applied against), and the office is alerted in-app.
- **Download counter** incremented in the database (`UPDATE … increment`),
  so two simultaneous clicks count twice and a hit against an unpublished
  file counts nothing and 404s. It is the one column an anonymous visitor
  may move, and only upward (CHECK).
- **Crawler artifacts**: `sitemap.xml`, `robots.txt` and a news `rss.xml`
  from a dependency-free writer (`calc/feed.util.ts`, the M05
  `ics.util.ts` precedent), plus a `sitemap-urls` JSON the Next app
  renders onto its own origin.
- **The public site itself** — 18 routes under `(public)`, ISR at 60 s,
  per-page `generateMetadata`, OpenGraph, canonical URLs, JSON-LD
  (`School` site-wide, `NewsArticle` per post, `FAQPage` on the FAQ),
  branded 404/500, and a mobile drawer as the only client component in
  the site chrome.
- **The result search page** the roadmap has been waiting for since M15
  ("the API is live; this item is the page"). M15 shipped the search but
  not the picker it needs, so this module added
  `GET /public/results/exams` — the exams with a live website-channel
  publication and the classes that sat them.

## Database Changes

Migration `20260724120000_website_cms` — **9 tables, 6 enums, 2 partial
unique indexes, 11 CHECK constraints**, plus the `website` value on
`settings_group_enum`.

| Table | Notes |
|---|---|
| `cms_pages` | slug, dual-language title/content, SEO fields, `template`, `show_in_menu`, `display_order`, `published_at` |
| `news_posts` | slug, `category` (NEWS/BLOG/ACHIEVEMENT), cover, excerpt, SEO, `published_at` |
| `galleries` → `gallery_items` | album + media; **items are HARD-deleted** (see below) |
| `downloads` | file URL/key, size, `download_count` |
| `careers` → `career_applications` | opening + public applications with CV |
| `faqs` | question/answer, dual-language, category, order |
| `committee_members` | name, designation, photo, optional `message` |
| `contact_messages` | the public inbox, with `read_at` / `replied_at` |

Enums: `web_content_status_enum`, `cms_page_template_enum`,
`news_category_enum`, `gallery_item_type_enum`,
`contact_message_status_enum`, `career_application_status_enum`.

Hand-written constraints Prisma cannot express:

- `uq_cms_pages_slug` / `uq_news_posts_slug` — partial unique
  `WHERE deleted_at IS NULL`, so deleting `/about` frees the slug for a
  rewrite (the M06/M16/M17 tombstone-excluding pattern).
- `chk_cms_pages_published_evidence` / `chk_news_posts_published_evidence`
  — a PUBLISHED row must carry `published_at`. It is the feed sort key
  and the RSS `<pubDate>`; a published row without one would sort last
  and syndicate undated.
- `chk_contact_messages_status_evidence` — REPLIED requires `replied_at`,
  anything past NEW requires `read_at` (the M16/M17 "evidence, not a bare
  flag" rule).
- `chk_contact_messages_reachable` — a message with neither phone nor
  email is a dead letter.
- `chk_downloads_count` — the counter and the size are non-negative.
- Six `display_order >= 0` checks, and `vacancies > 0`.

**`gallery_items` is the one table here without `deleted_at`.** An album's
items are edited as a *set* — the incoming list replaces what is stored,
in one transaction — so a tombstone would only ever be dead weight. This
follows the M13 `timetable_entries` / M14 `seat_plan_entries` precedent for
wholesale-replaced child rows.

## API Endpoints Added

```
# Admin CMS (permission-guarded)
GET|POST            /api/v1/cms/pages            PUT|DELETE /api/v1/cms/pages/:id
PUT                 /api/v1/cms/pages/:id/publish
GET|POST            /api/v1/cms/news             PUT|DELETE /api/v1/cms/news/:id
PUT                 /api/v1/cms/news/:id/publish
GET|POST            /api/v1/cms/galleries        PUT|DELETE /api/v1/cms/galleries/:id
PUT                 /api/v1/cms/galleries/:id/publish
GET|POST            /api/v1/cms/downloads        PUT|DELETE /api/v1/cms/downloads/:id
POST                /api/v1/cms/downloads/upload
GET|POST            /api/v1/cms/careers          PUT|DELETE /api/v1/cms/careers/:id
GET                 /api/v1/cms/careers/:id/applications
PUT                 /api/v1/cms/career-applications/:id
GET|POST            /api/v1/cms/faqs             PUT|DELETE /api/v1/cms/faqs/:id
GET|POST            /api/v1/cms/committee        PUT|DELETE /api/v1/cms/committee/:id
GET                 /api/v1/cms/contact-messages (+ /:id)
PUT                 /api/v1/cms/contact-messages/:id/status
DELETE              /api/v1/cms/contact-messages/:id
POST                /api/v1/cms/preview-token

# Public (@Public, throttled, cached)
GET  /api/v1/public/config | home
GET  /api/v1/public/pages/:slug          (?preview=<token>)
GET  /api/v1/public/news                 GET /api/v1/public/news/:slug (?preview)
GET  /api/v1/public/notices              GET /api/v1/public/notices/:id
GET  /api/v1/public/events | galleries | galleries/:id
GET  /api/v1/public/downloads            POST /api/v1/public/downloads/:id/hit
GET  /api/v1/public/faqs | committee | teachers | careers
POST /api/v1/public/contact
POST /api/v1/public/careers/:id/apply    (multipart, CV PDF)
POST /api/v1/public/verify/student
GET  /api/v1/public/verify/certificate   (Module 27 stub)
GET  /api/v1/public/sitemap.xml | robots.txt | rss.xml | sitemap-urls

# Module 15's public search, completed with its picker
GET  /api/v1/public/results/exams
```

## Frontend Pages Created

The `(public)` route group — ISR 60 s unless noted:

`/` (home) · `/[slug]` (any CMS page) · `/news` · `/news/[slug]` ·
`/notices` · `/events` · `/gallery` · `/gallery/[id]` · `/achievements` ·
`/teachers` · `/committee` · `/downloads` · `/career` · `/faq` ·
`/contact` · `/results` (dynamic) · `/verify/student` (dynamic) ·
`/verify/certificate`, plus branded `not-found.tsx` / `error.tsx`, and
`app/sitemap.ts`, `app/robots.ts`, `app/rss.xml/route.ts`.

Admin: `/admin/website` with eight tabs (Pages, News, Gallery, Downloads,
Committee, Careers, FAQ, Messages) and a `Website` sidebar entry gated on
`website.view`.

## Components Created (new shared/reusable only)

- `CmsCrud` (`admin/website/cms-crud.tsx`) — a config-driven CRUD
  workspace (fields + columns + API calls) covering seven content types;
  the `MasterCrud` (M06) idea applied to content. Includes the
  gallery-items repeater.
- `(public)/_components/ui.tsx` — `PageBanner`, `Section`, `RichText`,
  `Nothing`, `formatDate`, `formatBytes`: website chrome, deliberately
  separate from the admin-panel widgets in `components/shared`.
- `SiteHeader` / `SiteFooter` (server) + `MobileNav` (the only
  interactive piece), `Lightbox`, `DownloadList`, `ContactFormCard`,
  `CareerOpenings`, `ResultSearch`, `StudentVerifyForm`.

## Business Rules Implemented

- Only `PUBLISHED` **and** (for notices) `is_website_visible` content is
  served publicly; drafts only via a signed, row-specific preview token.
- `published_at` is **derived, never assigned** (`publish.util.ts`):
  publishing for the first time stamps now; re-publishing keeps the
  original date; unpublishing keeps it too, so a re-publish does not jump
  an unchanged post back to the top of the feed.
- Slug kebab-case, unique per school among live rows, reserved segments
  refused. A title with no ASCII to transliterate (a Bangla-only title)
  makes the service **ask for an explicit slug** rather than invent
  `page-2`.
- Verification endpoints are rate-limited 10/min/IP and reCAPTCHA-gated;
  the teacher directory exposes no phone or email; the contact inbox
  requires a reachable sender.
- `website.enabled = false` takes the site down with a 403 (a deliberate
  administrative state, not a missing resource); `website.indexable =
  false` makes `robots.txt` disallow everything.
- A published career opening past its deadline stops accepting
  applications and disappears from the public list.

## Known Limitations

- **Content is authored as HTML in a textarea.** The sanitizer makes that
  safe, but there is no WYSIWYG editor; that is a UI upgrade, not a data
  one (the stored shape would not change).
- **No image upload for content.** Cover images, hero slides, gallery
  items and committee photos take URLs; only *downloads* upload through
  the API (S3). A media library is a natural follow-up.
- The public API resolves `DEFAULT_SCHOOL_ID`, like every other public
  surface in this project (M10/M15/M16) — multi-tenant public routing is
  an M31 concern.
- reCAPTCHA keys stay in **env** (`RECAPTCHA_SECRET_KEY`, the M10
  decision) rather than joining the `website.*` settings group as the
  roadmap §3 listed. One captcha configuration serves both the admission
  and website forms.
- The Bangla/English toggle is **data-ready, not wired**: every content
  table carries `*_bn` columns and the API returns them, but the site
  renders the English field. `website.language_toggle` exists for the
  switch that will read them.
- Lighthouse CI budgets and the k6 result-day load test were **run on
  2026-07-28** — see the addendum. A11y, SEO and best-practices all reach
  100; **Performance 79 against a ≥ 90 target is the one budget missed.**
- `PublicSiteRepository.adminUserIds` repeats a query
  `AudienceRepository` (M17) already has, because that repository is
  CommunicationModule-private.

## Future Improvements

- A media library + image upload with `next/image` optimization.
- WYSIWYG authoring over the same sanitized HTML.
- Wire the Bangla toggle to the `*_bn` fields already stored.
- On-demand ISR revalidation (`revalidateTag`) on publish, so a published
  page appears immediately rather than within 60 s.
- Per-entity cache invalidation if the blunt namespace bust ever costs
  measurably (it does not at one school).

## Breaking Changes

None. Every route is additive. Two notes for existing deployments:

- The **home page changed** — `(public)/page.tsx` replaced the "the public
  website arrives with the Website CMS module" placeholder. A school that
  has published nothing gets a tasteful zero-state, not an empty grid.
- `GET /api/v1/public/results/exams` is new; the existing
  `/public/results/search` contract is untouched.

## Migration Steps

1. `npx prisma migrate deploy` — applies `20260724120000_website_cms`.
2. `npx prisma generate` (new models/enums in the client).
3. Restart the API so the permission-registry seeder syncs the 10 new
   `website.*` codes and grants the Principal / Office Staff baselines.
4. Set `website.site_url` in **Settings → Website** — an unconfigured site
   URL yields an empty sitemap and a `Disallow: /` robots file rather
   than a wrong one, by design.
5. Optionally set the hero slides, socials, map embed and
   `website.contact_email`.

## Environment Variable Changes

| Variable | New/Changed | Purpose |
|---|---|---|
| — | — | None. `RECAPTCHA_SECRET_KEY` (M10) is reused; everything else is a `website.*` setting. |

*(Optional frontend fallback: `NEXT_PUBLIC_SITE_URL` is consulted by
`sitemap.ts`/`robots.ts` only when `website.site_url` is unset.)*

## Manual Testing Results

| Scenario | Result | Notes |
|---|---|---|
| Migration replays on an empty Postgres 16 | ✅ | All 17 migrations; `migrate diff` reports **No difference** |
| Migration applied to local dev DB | ✅ | |
| Migration applied to the **Neon** dev DB | ✅ | `migrate diff` reports **No difference** |
| Full e2e suite | ✅ | **406 tests / 19 suites** (+49); `npm run test:e2e` |
| Unit suite stability | ✅ | 5 consecutive full runs green after the M02 argon2-timeout fix |
| Backend unit suite | ✅ | **1030 tests / 85 suites** (+98) |
| Frontend unit suite | ✅ | **238 tests / 27 files** (+20) |
| e2e — `website.e2e-spec.ts` | ✅ | **49 cases**, the privacy suite |
| `npx tsc --noEmit`, both repos | ✅ | |
| `npx eslint <new paths>` | ✅ | one pre-existing M10 warning only |
| `npx next build` | ✅ | emits `/`, `/[slug]`, `/news/[slug]`, `/gallery/[id]`, `/sitemap.xml`, `/robots.txt`, `/rss.xml` |
| Draft leak attempts (missing / draft / forged token / wrong-row token) | ✅ | all four produce an identical 404 |
| Teacher directory contact leak | ✅ | phone, email and NID absent from the payload |

## Remaining TODOs

- [x] ~~Lighthouse CI budget check~~ — **run 2026-07-28**, see the
      addendum. A11y/SEO/best-practices 100; **Performance 79 vs ≥ 90 is
      still open** (carried in PROJECT_CONTEXT §18).
- [x] ~~k6 result-day load simulation~~ — **run 2026-07-28**, see the
      addendum. Holds 150 rps; saturates at the roadmap's 200.
- [ ] Raise public-site Performance to ≥ 90 by moving the app providers
      out of the root layout (the diagnosis is in the addendum).
- [ ] Re-run the k6 test on real infrastructure — the first run had the
      generator co-resident with every server on one laptop.
- [ ] In-browser click-throughs: the gallery lightbox on a phone, a real
      CV upload to MinIO, the contact form with live reCAPTCHA keys, and
      a draft preview link opened in a private window.
*(The Neon dev DB is done — migration 17 is applied there and
`migrate diff` reports no difference.)*

## Links to Related Modules

- **Depends on:** M04 (settings, school profile), M05 (public calendar
  events — the `is_public` flag added *for* this module), M08 (teacher
  directory), M09/M11 (student verification), M10 (public admission,
  `RecaptchaService`), M15 (result search), M17 (notices with
  `is_website_visible`, `NotificationService`).
- **Completed hooks:** M05's `calendar_events.is_public` and M17's
  `notices.is_website_visible` finally have public readers; M15's public
  result search finally has its page (and gained the `exams` picker it
  needed).
- **Left for Module 27:** `GET /public/verify/certificate` answers
  `{ available: false, reason }` and `/verify/certificate` says so on the
  page — M27 replaces the body with the real lookup.
- **Unlocks:** M27 (certificate verification), M28 (complaints/alumni,
  which the roadmap routes through the public site).
- `PROJECT_CONTEXT.md` sections updated: §5 (shared services), §8 (entity
  spine), §11 (global business rules), §16 (decisions), §18 (debt).

## Architectural Notes

Three decisions worth carrying forward:

**WebsiteModule is a near-leaf, and the privacy-shaped reads live in a
repository.** Like `PortalModule` (M18) it imports only `SchoolModule`,
`CommunicationModule` and `StorageModule`, and nothing imports it back.
What it deliberately does *not* do is import the five feature modules
whose data the site shows. Every one of those reads is privacy-shaped —
the SELECT list is the policy — so they live in a narrow
`PublicSiteRepository` (the `AudienceRepository` / `DashboardRepository`
precedent). Trimming a richer service's result after the fact would put
the privacy rule in the wrong place.

**Sanitize on write, not on render.** The alternative (store what the
author typed, sanitize in the renderer) means every current and future
reader must remember to. Sanitizing at the door makes the row itself the
guarantee — and makes the operation idempotent, which matters because an
edit round-trips through the editor.

**Two pre-existing flakes the larger suite exposed.** Neither is an M19
regression; both are the same shape — a resource budget that was generous
at 18 suites and tight at 19. `auth.service.spec.ts` (M02) timed out
hashing with argon2id against Jest's 5-second default, and the **e2e suite
needs `--max-old-space-size=6144`** now that 19 Nest applications compile
in one `maxWorkers: 1` process (without it a *different* suite times out
in `beforeAll` on each run, which reads like flaky tests and is not).
`npm run test:e2e` carries the flag, and the auth spec states its budget
with the reason.

**The cache-bust key list is a constant.** The first implementation
tracked live payload names in a Redis-side index and deleted whatever it
listed — which made invalidation depend on a *second* best-effort value.
If the index write were the one call a blip dropped, `bust` would find
nothing and the site would serve stale **published** content until the
TTL expired: a silent failure, and precisely the one this cache exists to
avoid. `SCAN` is not an option against a shared Redis. Naming the eight
keys in a constant removes the failure mode entirely, at the cost of one
line per new payload — which a unit test pins.

---

# Addendum — the two measurements, run 2026-07-28

Roadmap §9 asked for a Lighthouse budget check and a k6 result-day load
simulation. Both shipped as TODOs and were run in a later sweep. **Each
found a real defect**, which is the argument for running them rather than
reasoning about them.

## Lighthouse (mobile emulation, `next start`)

| Category | Before | After | Budget |
|---|---|---|---|
| Accessibility | 100 | **100** | ≥ 90 ✅ |
| SEO | 92 | **100** | ≥ 95 ✅ |
| Best practices | 96 | **100** | — ✅ |
| Performance | 78 | **79** | ≥ 90 ❌ |

### Defect 1 — every canonical was relative

The head carried `<link rel="canonical" href="/">`. Next resolves relative
metadata against `metadataBase`, and this layout set `metadataBase` **only
when a school had filled in the `website.site_url` setting** — so on any
site that had not, every canonical on every page was relative, which a
crawler rejects. The resolution chain now always terminates somewhere
absolute (configured domain → `NEXT_PUBLIC_SITE_URL` → localhost), and a
malformed admin-entered URL is caught rather than taking the whole site's
metadata down. This is the kind of bug **no unit or e2e test would have
caught**: the page renders, the API is correct, and the damage is entirely
in how a crawler reads the document.

### Defect 2 — the public site called `/auth/refresh` on every visit

`AuthProvider` sat in the **root** layout and bootstrapped a session on
every route. An anonymous visitor has no refresh cookie, so the call could
only ever 401 — a wasted round trip on the critical path of exactly the
pages that most need to be fast, plus a console error on every marketing
page. The bootstrap is now scoped to the authenticated route prefixes.

It is deliberately an allow-list of **authenticated** areas rather than of
public ones: the public site has a `[slug]` catch-all for CMS pages, so any
top-level path can be public and no public list could stay complete. The
failure mode is also the safer one — forget to add a new admin area and a
hard refresh simply does not restore the session, which shows up at once
and which the route guard still covers.

### The open item — Performance 79

The LCP element is a plain `<p>`, and its time is **89 % render delay**
(LCP 4.2 s, TBT 310 ms, FCP 0.9 s, CLS 0). Nothing is waiting on the
network; the main thread is busy. The cause is that `app/layout.tsx` wraps
every route in `StoreProvider` + `QueryProvider` + `AuthProvider`, so a
static marketing page downloads and hydrates the whole admin runtime.

The fix is to push those providers down into the `(admin)`/`(portal)`
layouts — but it is **not a pure move**: `result-search`, `contact-form`,
`download-list`, `career-openings`, the gallery lightbox and the admission
wizard are public client components that genuinely need the query client.
Budget a proper pass. Carried in PROJECT_CONTEXT §18.

## k6 — result-day load (`test/load/result-search.k6.js`)

The script models a result-day spike: the SSR search page, the exam picker
it populates from, and the search itself, in a realistic ratio.

| Target rate | Search p95 | Exams p95 | Page p95 | Achieved | Verdict |
|---|---|---|---|---|---|
| 50 rps | 9.9 ms | 14.7 ms | 34.7 ms | 50 rps | ✅ |
| 100 rps | 16.3 ms | 25.8 ms | 39.9 ms | 100 rps | ✅ |
| 150 rps | 21.6 ms | 33.3 ms | 129.9 ms | 150 rps | ✅ |
| **200 rps** | **7.8 s** | 16.8 s | — | 166 rps, 1 873 dropped | ❌ |

Zero 5xx throughout; a search miss is a 404 by design (a withheld result
and a non-existent one answer identically), so the script counts that as
well-formed rather than as a failure.

### The first run measured the throttler, not the server

It reported ~85 % failures and *flattering* latencies. Both were artefacts:
the public API allows **100 requests per minute per IP**, so after the
first second nearly everything was a fast 429. A load test sourced from one
address cannot say anything about a spike made of tens of thousands of
different households. The script now varies `X-Forwarded-For` — the API
runs `trust proxy` because it sits behind Nginx in production — which
reproduces the real shape.

**Caveat on every number above:** one developer laptop hosted Postgres,
Redis, the API, Next **and** the 800-VU generator. The generator competes
with the server for CPU, so 150 rps is a floor, not a production verdict.
Re-run on real infrastructure before sizing. The local dataset also had no
published results, so the search arm exercised the miss path — which is
most of result-day traffic anyway (parents mistype rolls), but not the
cached-payload path.
