# QA Findings Register

Every defect browser QA has surfaced, with its diagnosis and current state.
Per-module scenario results live in the `NN-*.md` files beside this one;
environment and gotchas live in [`QA_RUNBOOK.md`](../../QA_RUNBOOK.md).

**Findings keep their number forever.** A fixed finding is annotated, never
deleted — the diagnosis is usually worth more than the fix.

| ID | What | Status |
|---|---|---|
| **F1** | Every `[param]` route 404s | ✅ fixed — stale `.next`; guarded by a browser spec |
| **F2** | Grace re-issue leaves 2–3 live refresh tokens | 📋 **decision needed** — mechanism confirmed, needs a session-lineage column; not patched |
| **F3** | Interceptor retries business 401s | ✅ fixed — credential endpoints excluded; 6 Vitest cases |
| **F4** | Roles list counts orphaned codes | ✅ fixed — count filters `isOrphaned`; e2e regression |
| **F5** | Gated controls appear after `/auth/me` | ✅ fixed — provider holds until auth settles |
| **F6** | Cold load fires 401s before refresh | ✅ fixed — same provider change |
| **F7** | HR e2e leaks fixture users | ✅ fixed — cleanup matches the timestamped prefix |
| **F8** | Admin routes have no route-level gate | ✅ fixed — `RouteGuard`; 12 unit + 9 browser cases |
| **F9** | Raw ISO timestamp in the DOB column | ✅ fixed — shared `formatDate`; 12 Vitest cases |
| **F10** | Two HR e2e tests fail on the local DB | 🔎 **open** — pre-existing, belongs to the M21 pass |
| **F11** | Calendar ignored the selected session | ✅ fixed — anchored via `monthWithinSession()`; 8 regression cases |
| **F12** | HR e2e leaks `staff_attendances` rows | 🔎 **open** — same class as F7; deferred to the M21 pass with F10 |
| **F13** | Every `<Select>` is unnamed for screen readers | 📋 **decision needed** — 420 usages / 83 files, only 4 named; component-level fix |
| **F14** | Chart bars used `aria-label` on a bare `div` | ✅ fixed — `role="img"`, matching the Sparkline in the same file |
| **F15** | OpenAPI under-declares ~318 responses | 🔎 **open** — contract debt; **zero 500s** across 474 fuzzed GETs |
| **F16** | Unlabelled month filter on `/admin/fees` | ✅ fixed — `htmlFor`/`id`, matching the correct field in the same file |
| **F17** | 86 pre-existing backend lint errors | 🔎 **open** — verify block omits `lint:check`; 69 are `--fix`-able |

### Harness built

`@playwright/test` + `@axe-core/playwright` installed, `playwright.config.ts`, and
`e2e/` with `smoke.spec.ts`, `sweeps/permissions.spec.ts` and the `support/` helpers
(`auth`, `console-guard`, `mailpit`, `ui`, `a11y`), plus Schemathesis over the
OpenAPI spec. **26 browser tests pass in ~40 s.**

Three things the first run taught the harness, all now encoded:

1. **`storageState` cannot be reused against rotating refresh tokens.** Replaying a
   saved snapshot in a second context presents an already-spent token, which reuse
   detection treats as theft and answers by revoking *every* session for that user.
   Every test now signs in for itself.
2. **The 5/min credential throttle refuses that.** Hence the new
   `AUTH_THROTTLE_ENABLED` env knob — dev/QA only, hard-blocked in production, with
   unit tests pinning the guard.
3. **`hs_session` is set by the browser, not the API**, and a **TEACHER lands on
   `/portal`, not `/admin`**. Both were wrong assumptions that cost a run.

Still open from the Phase 0 plan: **F2** (design decision) and **F10** (M21 pass).

---

### F1 — Every dynamic (`[param]`) route 404s in the running dev server — **blocker**

The role editor, and every other detail page, is unreachable.

| Route | Status |
|---|---|
| `/admin/roles` | 200 |
| `/admin/roles/<real-uuid>` | **404** |
| `/admin/students/<uuid>` | **404** |
| `/admin/guardians/<uuid>` | **404** |
| `/admin/exams/1` | **404** |
| `/admin/settings/general` | **404** |
| `/gallery/1` (public) | **404** |
| `/admin/audit-logs`, `/admin/users`, `/account/sessions` | 200 |

Not an application-code fault as far as the browser can tell — Next never
matches the segment. The RSC flight payload for `/admin/roles/<uuid>` resolves
the tree to `/_not-found`, and even the `(admin)` layout does not render:

```
"c":["","admin","roles","dffefa82-…"],
"f":[[["",{"children":["/_not-found",{"children":["__PAGE__",{}]}]}…
```

Root cause evidence — the dev server's own route table has **no dynamic
routes registered at all**:

```
.next/dev/server/app-paths-manifest.json → 16 entries, has /(admin)/admin/roles/page
                                            but NOT /(admin)/admin/roles/[id]/page
.next/dev/routes-manifest.json          → dynamicRoutes: 0
```

Meanwhile the *production* manifest (`.next/app-path-routes-manifest.json`,
from an older `next build`) does contain `/(admin)/admin/roles/[id]/page`, and
`next.config.ts` is empty (no `output: "export"`). So the route files and
config are fine; the long-running `next dev` process is serving a stale/empty
dynamic route table — most likely because a `next build` was run against the
same `.next` directory while `next dev` stayed up.

**Suggested fix:** stop `next dev`, delete `.next`, restart `npm run dev`, then
re-check `/admin/roles/<uuid>`. If dynamic routes still 404 after a clean
restart, it is a genuine Turbopack/Next 16 routing defect worth escalating.

*Not attempted here:* stopping the owner's dev server needs their go-ahead.
M03-12 and M03-14 stay blocked until this is cleared.

#### ✅ RESOLVED — round 2, 2026-08-12

`rm -rf .next && npm run dev` fixed it. `/admin/roles/c4f06762-…` now renders the full
role editor (evidence in M03-12). All 19 `[param]` directories were on disk the whole
time and `next.config.ts` is empty, so this was purely a stale dev build.

**Two corrections to the round-1 diagnosis, so the next person does not repeat them:**

1. **`routes-manifest.json → dynamicRoutes: 0` is not evidence of anything.** It still
   reads `0` on the healthy server, and `app-paths-manifest.json` held only **3**
   entries immediately after a working navigation. Under Turbopack dev these manifests
   are populated **lazily, per compiled route** — they are not a route table. Do not
   diagnose from them.
2. **An anonymous HTTP status cannot distinguish a matched from an unmatched `/admin`
   route.** `proxy.ts` redirects *everything* under `/admin` before routing, so
   `/admin/roles`, `/admin/roles/<uuid>`, `/admin/totally-bogus-route` and
   `/admin/roles/a/b/c` **all return 307**. Round 1's 200-vs-404 split was meaningful
   only because it was measured while signed in. Always probe dynamic routes
   authenticated.

The reliable check is the one M03-12 uses: sign in, navigate, assert on rendered content.

### F2 — One browser login leaves 2–3 live refresh tokens (session list inflated)

`GET /auth/sessions` reported **3** active sessions for a single freshly
launched isolated browser; the session-manager UI showed **2** device rows with
identical sign-in timestamps, only one flagged `isCurrent`.

`RefreshTokensRepository.listActiveForUser` filters correctly
(`revokedAt: null, expiresAt > now`), so these really are live tokens. The
likely source is the documented 5-second two-tab **grace re-issue**, which by
design "does not re-chain" — so a concurrent/duplicated bootstrap refresh (React
19 dev double-effect will do it) mints a second live token while the first is
never retired.

**Impact:** users see phantom devices in the session manager, and revoking "this
device" may not actually end the session. Worth deciding whether the grace path
should retire the presented token.

#### Round-2 — mechanism confirmed, but this needs a decision, not a patch

Read from `auth.service.ts:184-206` and `rotate()` at `:406-429`. The sequence is:

1. Tab A refreshes with `T1` → `rotate()` issues `T2` and marks
   `T1.revokedAt` + `T1.replacedById = T2`.
2. Tab B (or React 19's dev double-effect) refreshes with the same `T1` inside the
   5-second `ROTATION_GRACE_MS` → `withinGrace` is true, so no theft alarm.
3. `rotate()` runs again and issues `T3` — but its chaining step is guarded by
   `if (!oldRecord.revokedAt)`, and `T1` is already revoked, so **nothing is
   retired**.

`T2` and `T3` are now both live and unrevoked. `listActiveForUser` filters correctly,
so the session manager faithfully reports two devices for one browser.

**Deliberately not fixed here** — every obvious repair trades one problem for a worse
one, and this is session-security semantics:

| Option | Why it is not a drop-in |
|---|---|
| Revoke `T2` when issuing `T3` | Tab A still holds `T2`; its next refresh trips reuse detection and **revokes all the user's sessions** — a logout storm from an ordinary two-tab load. |
| Return the existing replacement instead of minting `T3` | Impossible as built: only the *hash* of `T2` is stored, so the plaintext cannot be handed out again. |
| Give tokens a shared session/lineage id, group the UI by it, revoke the lineage | Correct, and it fixes "sign out this device" properly — but it needs a schema column and a migration. |

The third is the right answer. It is a small M02 design change rather than a QA fix,
so it belongs in `PROJECT_CONTEXT.md` §18 with an owner decision attached. Nothing was
changed in the auth service.

### F3 — The axios interceptor retries business 401s, double-sending the request

Submitting change-password with a wrong current password produced:

```
POST /auth/change-password → 401
POST /auth/refresh         → 200
POST /auth/change-password → 401     ← same wrong password, sent twice
```

The interceptor cannot distinguish "access token expired" from a 401 that *is*
the business answer, so every such rejection costs two requests and two audit
log rows, and burns the 5/min credential throttle twice as fast. Consider
having the backend return 401 only for authentication failures (e.g. 400/422 for
"current password is incorrect"), or having the interceptor retry once only when
the token was actually refreshed.

### F4 — Roles list grant counts include orphaned codes (cosmetic)

Super Admin and Admin both show **294** permissions, while `/auth/me` returns
**292** effective codes. The 2-code gap is the orphaned (registry-removed) codes
— correctly excluded from effective permissions but still counted in the table's
"Permissions" column. Either subtract orphans or badge them.

**Round-2 note.** The 2-code gap is **environment-specific, not structural**. On a
database rebuilt from scratch (`qa:reset`) the registry syncs to **292 codes with 0
orphans**, and the roles list agrees. The 294 seen in round 1 was two codes that had
been removed from the registry at some point in that database's history. So the bug is
purely presentational — the column counts grants rather than *effective* grants — and it
only shows on a long-lived database. Reproduce it by removing a code from the registry
and re-syncing, not by re-seeding.

### F5 — `<Can>`-gated action buttons appear only after `/auth/me` resolves

On a cold load of `/admin/roles`, the table renders before the auth store
hydrates, so "New role" is briefly absent (it does appear — an early automated
assertion caught the gap). Harmless for humans, but any UI automation must wait
on the gated control, not the table.

### F6 — Every cold page load fires two requests that 401 before the refresh lands

Opening `/admin/roles/<id>` by hard navigation produced, with no user error involved:

```
GET /api/v1/roles/c4f06762-…  → 401
GET /api/v1/permissions       → 401
```

The page then rendered correctly, so the single-flight interceptor did refresh and
retry. But the access token is held **in memory only** and a full page load starts with
none, so every cold navigation pays two failed requests, two browser console errors and
a refresh round-trip before any data appears.

**Consequences.** It doubles request volume on every entry to the app; it puts red
errors in the console on a completely healthy page; and — the reason it matters here —
**a naive `console-guard.ts` that fails a test on any `console.error` or any 4xx XHR
would fail every single browser test.** The guard must allow-list the bootstrap 401 on
`/auth/refresh`-adjacent traffic, or the app should not fire queries until the auth
store has resolved.

Related to **F5** (gated controls appear only after `/auth/me` resolves) and **F3** (the
interceptor cannot tell a bootstrap 401 from a business 401) — all three are the same
underlying issue: *the app renders and queries before authentication has settled.*
Worth fixing once, at the provider level, rather than three times.

### F7 — The HR e2e suite leaks fixture users into the database

The local Docker DB holds **13** users named `e2e-hr-staff-<epoch>@test.local`,
accumulated across runs, alongside the single legitimate `admin@hexschool.local`:

```
users=14, schools=1, roles=11, permissions=294, students=0, academic_sessions=0
```

The suite's `cleanup()` deletes fixtures by prefix, but these users survive it — most
likely because they hang off a `staff` row whose FK cascade does not reach `users`, or
because cleanup runs before the user is created on the failure path.

**Impact:** every future run adds more; the user list, any "staff count" statistic and
the M07 browser QA are all polluted. Not a product bug, but it corrupts the QA baseline
and should be cleaned up as part of the Phase 0.4 seed work.

### F8 — Admin routes have no route-level permission gate, only per-request gates

Signed in as the seeded **librarian** (15 permissions), every admin route they have
no permission for still **renders**:

| Route | HTTP | Rendered |
|---|---|---|
| `/admin/roles` | 200 | full page chrome + a live **Export CSV** button |
| `/admin/audit-logs` | 200 | page shell |
| `/admin/users` | 200 | page shell |
| `/admin/fees` | 200 | page shell |
| `/admin/accounting` | 200 | page shell |
| `/admin/communication` | 200 | page shell |

None renders a denial page. On `/admin/roles` the user gets the heading "Roles &
Permissions", the table headers, an **Export CSV** button, and inside the table
*"Failed to load — Insufficient permissions"* with a **"Try again"** button that can
never succeed.

**The security boundary holds** — the API refuses correctly, and that is the
authoritative gate (`PROJECT_CONTEXT.md` §10: "UI gating only — the API is
authoritative"). This is a UX and polish defect, not a data leak. But it is reachable
by ordinary means: a bookmark, a shared URL, the back button, or the browser's address
bar. The sidebar hiding the link is the *only* thing steering users away.

**Suggested fix.** The menu already declares the required code for every route in
`hexschool-frontend/src/lib/config/admin-menu.ts`, so the mapping needed to gate the
route already exists. Either resolve the route's code in the `(admin)` layout and render
a shared "You don't have access to this page" state, or wrap each page shell in `<Can>`
with that fallback. Doing it in the layout is one change and cannot be forgotten by the
next module.

*Also noticed:* `/admin/hr/payroll` returns **404** — the directory holds only `[id]`,
with no index page. Not reachable from the librarian's menu, so it is filed here rather
than as its own finding, but worth checking during the M21 pass.

### F9 — The students list renders a raw ISO timestamp in the Date of Birth column

`/admin/students` as `admin@qa.hexschool.local`, 12 seeded students. Row text:

```
QA-2026-0001 | Ayesha Rahman | QA Class 6 | FEMALE | 2014-01-01T00:00:00.000Z | …
                                                     ^^^^^^^^^^^^^^^^^^^^^^^^
```

The DOB cell prints the unformatted ISO-8601 value straight from the API instead of a
formatted date. The roadmap's Global Conventions require **all dates displayed in
Asia/Dhaka**; this one is displayed in UTC, with a time component, on a field that has
no time at all (`dob` is `@db.Date`).

Cosmetic but very visible, and it is on the busiest list in the product. Worth checking
whether the same cell/formatter is reused elsewhere — admission date, joining date and
enrollment date are all `@db.Date` too.

*Found incidentally while smoke-testing the new QA seed; belongs to the **M09** pass.*

### Observation — Bangla names are stored but never surfaced in the list

Every seeded student carries a `nameBn` (`আয়েশা রহমান`, `তানভীর হাসান`, …), but
`/admin/students` renders only `firstName lastName`; no Bangla appears anywhere on the
page. That may well be intentional. Flagging it for the **M09** charter rather than as a
defect: for a Bangladeshi SMIS it is worth an explicit decision whether the list, the
search index, the CSV export and the ID card surface the Bangla name, because right now
the field is write-only from the admin list's point of view.

### F10 — Two HR e2e tests fail on the local database (pre-existing, not browser QA)

Found while verifying the F7 cleanup fix. `hr.e2e-spec.ts` reports **53 passed,
2 failed** against a freshly reset local Postgres:

```
● HR & Payroll (e2e) › leave applications › approving consumes the balance AND marks
  the days LEAVE (the M12 hook)
    expected 201 "Created", got 409 "Conflict"        (hr.e2e-spec.ts:470)

● HR & Payroll (e2e) › leave applications › withdrawing an approved leave hands the
  days back
    expect(Number(after?.used)).toBeLessThan(Number(before?.used))
    Expected: < 0   Received: 0                        (hr.e2e-spec.ts:533)
```

The second failure is a consequence of the first: nothing was approved, so nothing
could be handed back.

**Confirmed pre-existing.** Reverting `test/hr.e2e-spec.ts` to HEAD and re-running
reproduces both failures identically, so they are not caused by the F7 cleanup change.

The suite builds its dates from `target` = **the previous calendar month**, and the
409 arrives on approval rather than on filing — the shape of the date-dependent
failures `PROJECT_CONTEXT.md` §18 already records four of ("a suite that passes at
14:00 and fails at 19:00 is not flaky, it is wrong"). Not diagnosed further here
because it belongs to the **M21** pass, and guessing at a date bug is how the previous
four got written.

*Note:* `PROJECT_PROGRESS.md` reports 1033 e2e tests all green, so either this is
environment-specific or the count is stale. Worth resolving before trusting the number.

### F11 — The calendar opened on today's month whatever session was selected — **fixed**

With the **QA 2025** session selected, `/admin/calendar` opened on **August 2026** and
reported *"Nothing scheduled this month"* — a month that session cannot cover, since
sessions do not overlap. An event genuinely created in that session (June 2025) was
reachable only by paging back **fourteen months**, with nothing on screen saying the
view had left the session.

Two causes in `src/app/(admin)/admin/calendar/page.tsx`:

1. `useState(thisMonth())` anchored the view to *today* and never reacted to the
   session, which arrives asynchronously and changes with the switcher.
2. `queryKey: ["calendar", month]` omitted the session, so a switch could serve the
   previous session's cached month.

It bites precisely when the switcher is used, which is the feature's whole purpose —
for the current session, today is inside the range and everything looks fine.

**Fix.** New pure helper `monthWithinSession()` in `src/lib/utils/month-grid.ts`:
today's month when today falls inside the session, otherwise the session's first
month. The page re-anchors whenever the session changes, and the session is now part
of the query key. No backend change was needed — `GET /calendar` already accepted
either `month` or `sessionId`.

**Verified in the browser:** QA 2025 → **January 2025**; switching to QA 2026 →
**August 2026**. Regression: 8 cases in `month-grid.test.ts`, including the exact
failing combination (session 2025, today in 2026) and the null-session case that
covers the async first render.

### F12 — The HR e2e suite also leaks `staff_attendances` rows (same class as F7)

Found while auditing which tables actually hold data. The local database carries **92
orphan `staff_attendances` rows** that no seeder creates:

| remarks | rows |
|---|---|
| `Approved Casual Leave` | 84 |
| `Approved Unpaid Leave` | 8 |

They come from `hr.e2e-spec.ts`, where approving leave marks the covered days as LEAVE
(the M12 hook). Its `cleanup()` deletes staff attendance with
`remarks: { contains: NAME }` where `NAME = 'E2EHR'` — but the rows the *service*
writes are stamped `"Approved <leave type>"`, which never contains that marker, so
every run leaves its days behind.

**Exactly the F7 shape**: cleanup matches a marker the production code does not put on
the row. Worth a general rule — *delete e2e fixtures by a foreign key you control (the
session, the staff profile), not by free text the service authors.*

Deferred to the **M21** pass, together with **F10**, since both live in the same suite
and the leave flow needs one careful look rather than two guesses. The QA seeder does
not purge these yet.

---

### F13 — Every `<Select>` in the app is unnamed for a screen reader — **needs a decision**

The first axe run of the admin panel flagged `button-name` (**critical**) on
`/admin/students` (3 nodes) and `/admin/settings/profile` (1 node). The offending
element is always the same shape:

```html
<button type="button" role="combobox" aria-expanded="false"
        data-slot="select-trigger" …>   <!-- no accessible name -->
```

shadcn's `SelectTrigger` is a `<button>`, so a neighbouring `<label>` does not name it
the way it would name an `<input>`. A screen-reader user hears "button, collapsed" with
no indication of what the control selects.

**It is systemic, not per-page:**

| | |
|---|---|
| `SelectTrigger` usages | **420** |
| Files containing one | **83** |
| Usages carrying an `aria-label` | **4** |

So this is essentially every dropdown in the product — class pickers, session pickers,
status filters, the lot. The four that work (the session switcher among them) show the
intended pattern already exists; it was simply never applied.

**Deliberately not fixed during a QA pass.** Editing 420 call sites would be an
enormous, unreviewable diff, and it needs a design decision first: give `SelectTrigger`
an `id` and point the visible `<label>` at it with `htmlFor` (correct, and fixes the
click-to-focus affordance too), or require `aria-label` at every call site (simpler,
but duplicates text already on screen and will drift). The first is better and is a
component-level change, not a QA fix.

**Meanwhile the gate stays useful.** `e2e/support/a11y.ts` excludes the
`[data-slot="select-trigger"]` **selector**, not the `button-name` **rule** — so a new
unlabelled button of any other kind still fails the suite. Delete the entry in
`KNOWN_ISSUE_SELECTORS` when this is fixed.

### F14 — Dashboard chart bars used `aria-label` on a plain `<div>` — **fixed**

`aria-prohibited-attr` (**serious**, 6 nodes) on `/admin`:

```html
<div class="w-full rounded-t bg-primary/80" title="৳0" aria-label="03: ৳0"></div>
```

`aria-label` is not permitted on a generic `div` with no role, so the label is invalid
and screen readers ignore it — the bar's value is simply never announced. The chart
*looked* accessible while conveying nothing.

**Fix:** added `role="img"` in `src/components/shared/charts.tsx`. The `Sparkline` in
the very same file already did this correctly, so the fix is consistency, not
invention. Re-verified: `/admin` now passes the a11y sweep.

### F15 — The OpenAPI spec under-declares ~318 responses — **contract debt, not a bug**

Ran Schemathesis over `/api/docs-json` (474 GET operations, read-only, 11 seconds).

**The headline is good news: zero 500s.** Property-based fuzzing of every GET endpoint
in the product produced no unhandled exception. The global exception filter and
`ValidationPipe` hold up.

Every one of the 318 failures is the API returning a *correct* status the spec does not
declare:

| Reported as | Count |
|---|---|
| Undocumented `404` | 121 |
| Undocumented `400` | 92 |
| Undocumented `403` | 14 |
| "API rejected schema-compliant request" | 91 |

The last row is the same defect seen from the other side. Example —
`GET /accounting/reports/budget-vs-actual`:

```
Expected: 2xx, 401, 403, 404, 409, 5xx     ← what the spec allows
Received: 400
{"success":false,"error":{"code":"BAD_REQUEST",
 "message":"sessionId is required — a budget is set per academic session"}}
```

The behaviour and the message are exactly right; the DTO marks `sessionId` optional, so
the generated spec says optional, so a "schema-compliant" request is one the service
correctly refuses.

**Why it matters** even though nothing is broken: the spec is the published contract
behind 946 Swagger operations. Client generators will produce wrong types, and
Schemathesis cannot become a CI gate while 318 known-benign failures drown any real
one.

**Suggested fix**, in this order: (1) make required params actually required in the
DTOs — that removes the 91 and a chunk of the 400s at the source; (2) add
`@ApiResponse` for 400/403/404 on the endpoints that can return them, ideally via a
shared decorator rather than 900 hand edits. Then re-run and make it a gate.

*Not started — it is an M30-scale API-hardening task, not a QA-pass fix.*

### F16 — Unlabelled month filter on the fees page — **fixed**

`label` (**critical**) on `/admin/fees`, caught by the a11y check added to the
permission sweep — a route the dedicated a11y sweep does not visit, which is the
argument for scanning inside the sweep that already walks every role's routes.

```html
<input type="month">   <!-- no id, and the adjacent <Label> has no htmlFor -->
```

The `<Label>` and `<Input>` were paired visually but not programmatically, so the
control had no accessible name and clicking the label did not focus it.

**Fix:** `htmlFor="invoice-filter-month"` / matching `id` in
`src/app/(admin)/admin/fees/invoices-tab.tsx`. The billing-month field further down the
same file already did exactly this, so again the fix is consistency rather than
invention.

*Worth noting the shape:* F14 and F16 were both a correct pattern existing a few lines
away from an incorrect one. Neither is a knowledge gap — they are copy-paste drift, and
the a11y sweep is what makes them visible.

### F17 — The backend has 86 pre-existing lint errors that the verify block never runs

Surfaced while confirming the `.gitattributes` line-ending conversion broke nothing.
Linting the whole backend source — rather than the handful of paths a module pass
touches — reports:

| Rule | Errors |
|---|---|
| `prettier/prettier` | 69 |
| `@typescript-eslint/no-base-to-string` | 12 |
| `@typescript-eslint/no-unsafe-assignment` | 3 |
| `@typescript-eslint/no-unused-vars` | 2 |
| **Total** | **86** |

Spread across untouched modules — communication, document, enrollment, fee.

**Confirmed pre-existing, not caused by the conversion.** Those files hash
byte-identical to `HEAD` (`git hash-object` == `git rev-parse HEAD:<file>`), so their
content is exactly what was committed; and the errors are real formatting/typing drift
(`Replace ⏎··input:·FineInput,… with input:·FineInput,·config:·FineConfig`), not
carriage returns.

**Why it went unnoticed:** `CLAUDE.md`'s "Verify before claiming done" block runs
`tsc --noEmit` and `jest`, but **not** `lint:check`. Husky's pre-commit hook lints
*staged* files, so drift in files a commit does not touch never surfaces. Twenty-nine
modules of that adds up.

69 of the 86 are `--fix`-able in seconds. Deliberately not done here: it would rewrite
~20 files unrelated to the QA work and bury the campaign's diff. Suggested sequence —
owner commits the QA work, then a standalone `npm run lint` commit, then add
`lint:check` to the verify block so it cannot drift again.
