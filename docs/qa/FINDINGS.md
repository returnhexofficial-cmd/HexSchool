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
| **F12** | HR e2e leaks `staff_attendances` rows | ✅ fixed — 92 orphans found live in QA; purge + a residue check |
| **F13** | Every `<Select>` is unnamed for screen readers | 📋 **decision needed** — 420 usages / 83 files, only 4 named; component-level fix |
| **F14** | Chart bars used `aria-label` on a bare `div` | ✅ fixed — `role="img"`, matching the Sparkline in the same file |
| **F15** | OpenAPI under-declares ~318 responses | 🔎 **open** — contract debt; **zero 500s** across 474 fuzzed GETs |
| **F16** | Unlabelled month filter on `/admin/fees` | ✅ fixed — `htmlFor`/`id`, matching the correct field in the same file |
| **F17** | 86 pre-existing backend lint errors | 🔎 **open** — verify block omits `lint:check`; 69 are `--fix`-able |
| **F18** | 27 dates used the machine locale, not Asia/Dhaka | ✅ fixed — rewritten to `formatDate`/`formatDateTime` across 20 files + a source guard |
| **F19** | SMS-gated flows untestable (no readable message body) | ✅ fixed — dev-only SMS outbox at `GET /dev/sms`, double-gated, 9 tests |
| **F20** | QA seed had no admission cycle | ✅ fixed — seed creates one OPEN cycle straddling today |
| **F21** | Stale draft dead-ends the admission wizard | ✅ fixed — derived notice explains and recovers |
| **F22** | QA seed had no cycle→class rows, so the class picker was empty | ✅ fixed — seed maps all 3 classes with seats + BDT 500 fee |
| **F23** | Seed leaked a student per UI-driven admission | ✅ fixed — purge scoped by school ownership, not name prefix |
| **F24** | Raw ISO dates printed into prose — and onto an ID card | ✅ fixed — 14 sites across both repos; both source guards widened |
| **F25** | Day boundaries built in UTC, so a cycle closed 6 h late | ✅ fixed — `startOfDayIso`/`endOfDayIso` on the Dhaka calendar |
| **F26** | The F23 fix cleaned students but left guardians name-matched | ✅ fixed — whole purge scoped by `schoolId` |
| **F27** | Previous session had sections but no enrolments | ✅ fixed — seed enrols the cohort in both years |
| **F28** | `percentage` meant two different denominators in one report | ✅ fixed — three named functions in the calc engine, 9 golden cases |
| **F29** | Backend "today" was the UTC day, not the Dhaka day | ✅ fixed — 8 sites use `dhakaToday()`; source guard added |
| **F30** | `@db.Time` reached the client raw, so the routine grid printed 1970 timestamps | ✅ fixed — one shared slot view for both endpoints |
| **F31** | 14 pickers asked for `limit: 200` from an API capped at 100 | ✅ fixed — shared `MAX_PAGE_LIMIT` + a guard that checks both repos agree |
| **F32** | Seed had no teacher assignments or bell schedule, so the builder was unusable | ✅ fixed — seeded, plus an empty state naming the missing prerequisite |
| **F33** | Publishing a routine always failed on its own default date | ✅ fixed — `isoDateInput` for the date input |
| **F34** | The conflict tooltip crashed the whole page | ✅ fixed — `Tooltip` is self-providing |

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

### F18 — 27 date renderings used the viewer's machine locale — **fixed**

Found on the staff Documents tab, which showed an uploaded file dated **`8/18/2026`** —
US M/D/YYYY, on a product whose Global Conventions require Asia/Dhaka **DD/MM/YYYY**.

`new Date(x).toLocaleDateString()` with no locale argument formats against whatever the
*viewer's machine* is set to. Two staff members looking at the same row see different
dates, and near midnight they disagree about the day.

Not a one-off — a sweep of the source found **27 call sites across 20 files**:

| Form | Count |
|---|---|
| `new Date(x).toLocaleDateString()` | 9 |
| `new Date(x).toLocaleString()` | 17 |
| `new Date(x).toLocaleTimeString([], …)` | 1 *(left alone — already passes options)* |

Spread across alumni, analytics, communication, complaints, inventory, reports, staff,
students, teachers, users, visitors, the portal and the notification bell.

**This is F9's class, product-wide.** F9 fixed one column in the students list and
created `formatDate`/`formatDateTime` for the purpose; nothing then pointed the other
call sites at them.

**Fix.** Mechanical rewrite to the existing, already-tested helpers —
`formatDate` (9) and `formatDateTime` (17) — across 20 files, imports added, `--fix`
run for formatting. Unlike **F13**, this needed no design decision: the utility existed,
the replacement is unambiguous, and it deletes a whole bug class.

**Regression guard at the cheapest layer:** `src/lib/utils/no-unlocalised-dates.test.ts`
greps the source for the banned shape and fails with file:line for each offender. It
also asserts that its own regex still matches a known-bad sample, so a broken pattern
cannot make it vacuously green — this bug is invisible on a machine whose locale is
already en-GB, which is exactly how it survived to a second discovery.

Verified in the browser: the same row now reads **`18/08/2026`**.

### F19 — SMS-gated flows were untestable: no way to read a sent message — **fixed (tooling)**

The M10 public admission wizard opens with a phone-OTP step, and its click-through had
been deferred with the note *"once SMS delivery is real (M17)"*. Driving it showed the
real blocker is narrower and fixable today.

`LogSmsAdapter` logs metadata only:

```
[SMS:log-only] to=01799887766 len=91 unicode=false
```

**The body is deliberately absent** — its own comment says so, because the bodies are
OTPs and temporary passwords. Correct for a log, and it means QA cannot get past screen
one of the wizard: the code is hashed in `otp_codes`, so it is not recoverable from the
database either, and there is a 3-attempt limit so guessing is out.

Email has Mailpit. SMS had nothing.

**Fix — a dev-only SMS outbox, the SMS counterpart to Mailpit:**

| Piece | Behaviour |
|---|---|
| `SmsOutboxService` | Bounded in-memory ring (50), newest first, filterable by recipient |
| `LogSmsAdapter` | Records the body into it — a no-op when disabled |
| `GET /api/v1/dev/sms` | Reads it back; `?to=` filters |

Gated by **two independent conditions**, mirroring `AUTH_THROTTLE_ENABLED`:
`SMS_DEV_OUTBOX=true` **and** `NODE_ENV !== 'production'`. So the flag leaking into a
production environment file still leaves the outbox inert. When disabled the endpoint
answers **404, not 403** — an endpoint that should not exist must not advertise that it
does — and it is `@ApiExcludeController()` so it never reaches Swagger.

9 unit tests pin the guard, including "never on in production even with the flag",
"ignores anything but the exact string `true`", and that the bound drops the *oldest*
message rather than the newest.

**Verified end to end:** requested a code from the public wizard, read
`Your HexSchool verification code is 199409…` from `/dev/sms`, submitted it, and the
wizard advanced with **"Phone verified."** — the step that had blocked this
click-through since M10 shipped.

*This unblocks more than M10: every M17 notification path is SMS-shaped.*

### F20 — The QA seed had no admission cycle, so the wizard dead-ends at step 2

With the phone gate cleared, the wizard's Applicant step asks for an **Admission
cycle** and the picker was empty — `GET /public/admissions/cycles` returned `[]`. There
is nothing to apply *to*, so the whole admission → enrollment chain (the highest-risk
seam in `MODULE_DEPENDENCIES.md`) is unreachable.

Same class as the missing `class_subjects` in pass B: the fixture was thin, not the app.

**Fix:** the QA seed now creates one **OPEN** cycle on the current session, with a
window straddling today (−30/+30 days) so it is genuinely open whenever QA runs. It
cascades from the academic session, so the existing purge already cleans it.

### F21 — A saved draft outliving its admission cycle dead-ends the wizard — **fixed**

The public admission wizard persists a draft to `localStorage` (`hs_admission_draft`) so
an applicant can resume after an interruption. On restore, `cycleId` is handed to the
form verbatim:

```ts
defaultValues: draft.applicant ?? { cycleId: "", … }
```

If that cycle no longer exists — the school closed or replaced it, or the draft simply
sat past the admission window — nothing reconciles the stale id:

| | |
|---|---|
| Cycle select | renders **blank** (no matching `SelectItem` for the value) |
| Class list | **empty** (`selectedCycle` is `undefined`, so `.classes` never resolves) |
| Error shown | **none** |

The applicant sees a blank cycle, an empty class dropdown, and no explanation. There is
no way forward and no way to tell that anything is wrong — clearing site data is the
only escape.

Reproduced exactly: draft held `cycleId c0bfcd46…` while the only live cycle was
`bb7a6cd7…`.

**Fix.** Derive the condition and say so, rather than silently failing:

```ts
const draftCycleGone = Boolean(draftCycleId) && !cycles.isPending && !selectedCycle;
```

with a notice under the field: *"The admission cycle saved with your draft is no longer
open. Pick a current one to continue — the rest of your answers have been kept."*

Deliberately **derived, not cleared in an effect**: leaving the stale value in place
keeps the notice on screen until the applicant picks a real cycle, and choosing one
overwrites the bad id naturally. Clearing it would make the notice vanish instantly and
leave them staring at an empty form with no idea why. It also avoids the
`react-hooks/set-state-in-effect` trap that the F11 fix hit.

**Verified in the browser** with the stale draft in place: notice appeared, picking the
live cycle populated the class list (`QA Class 6 — fee BDT 500.00`) and cleared the
notice.

### F22 — QA seed created a cycle with no classes, so the wizard's class picker was empty

An `AdmissionCycle` carries its **own** class list (`admission_cycle_classes`: seats +
application fee), and the public wizard reads *that*, not the school's class master.
The seed created the cycle but no rows, so `GET /public/admissions/cycles` returned a
cycle whose `classes` was `[]` and step 2 could not be completed.

Third fixture gap of the same shape in two passes (after `class_subjects` in M08 and the
cycle itself in M10) — the seed keeps being one join-table short of the flow under test.

**Fix:** the seed now maps all three classes onto the cycle with 30 seats and a BDT 500
application fee, which also gives the fee/payment path something real to exercise.

### F23 — The QA seed leaked a student for every admission driven through the UI — **fixed**

Caught by the committed browser suite, not by inspection: `smoke.spec.ts` asserts the
seed lands **exactly 12 students**, and after journey **J1** it found 13 — and stayed at
13 through repeated reseeds.

The purge matched `studentUid startsWith 'QA-'`, which is what the *seeder* names its
students. But a QA round can **admit an applicant through the M10 wizard**, and that
student is created by the application with the school's real id pattern
(`HEX-202600001`). So:

- the admission application cascaded away with the academic session,
- the student it created did not,
- leaving an invisible orphan — no application, no enrolment, just a stray row that
  accumulates one per admission run and breaks the head-count assertion.

Matching on the admission class does not rescue it either: deleting the QA classes
**nulls `admission_class_id`** first, so the only reference that could identify the row
is gone by the time the purge looks. Verified — the orphan's `admission_class_id` was
`null`.

**This is the third instance of one pattern** (after **F7** users and **F12**
`staff_attendances`): *cleanup keyed on a marker the production code never applies.*

**Fix:** scope the student purge by **ownership** rather than naming — every student in
the QA school goes, because this seeder owns that school outright and `guard.ts` already
makes it impossible to run against anything but a local database. Verified: 12 students
and 0 orphans across repeated reseeds, and the browser suite back to 26 passed.

**The general rule, now three times over:** delete fixtures by a key you control — the
school, the session, a foreign key — never by text the application writes.

### F24 — Raw ISO dates printed into prose, including onto a student's ID card — **fixed**

Found on the M09 student detail page, whose header read:

```
QA-2026-0001 · QA Class 6 · admitted 2026-01-05T00:00:00.000Z
```

**This is F9 for the third time**, and the reason it came back is that the F18 source
guard only knew one shape of the mistake. It greps for
`new Date(x).toLocaleDateString()` — a call that never happens here. These sites call
*no* formatter at all: they interpolate the API value straight into a sentence, or
`.slice(0, 10)` it into the ISO form.

Fourteen sites, in three groups:

| Where | Shape | Count |
|---|---|---|
| Frontend prose | `` `admitted ${s.admissionDate}` `` | 2 |
| Frontend ISO truncation | `` `${c.startAt.slice(0, 10)}` `` | 6 |
| **Backend generated documents** | `date.toISOString().slice(0, 10)` | 6 |

The backend group is the serious one, because those are **printed artifacts**: a student
ID card (`Date of Birth 2014-01-01`), an admit card's test date, a donation receipt, a
visitor pass's validity, and a certificate register's "Printed" footer. A school hands
these to parents.

**Fix.** Frontend sites go through the existing `formatDate`. The backend gained
`dhakaDisplayDate()` in `common/utils/clock.util.ts` — beside the Dhaka helpers that
already existed for M12/M13 — because there was no *display* formatter on that side at
all, only machine-form truncation.

**Both guards widened**, which matters more than the fixes:

- `no-unlocalised-dates.test.ts` gained a second rule that flags a date-shaped value
  interpolated into **prose**. It distinguishes a sentence from a react-query key or an
  ISO construction by whether the literal's *static* text contains a space — after
  stripping **every** interpolation, not just the date-shaped ones, since an unrelated
  `${pad(d.getMonth() + 1)}` contains a space and would otherwise disguise a key as a
  sentence. Exempts `format*`/`*Relative` calls and `getFullYear()` (a year is not a
  date). Four self-tests pin those distinctions so the rule cannot pass vacuously.
- `clock.util.spec.ts` gained three cases for `dhakaDisplayDate`, one of them at 19:30
  UTC — already the next day in Dhaka, and precisely when a receipt printed in
  Bangladesh would otherwise carry yesterday's date.

**A caveat worth keeping.** 68 backend call sites use `toISOString().slice(0, 10)` and
most are legitimate — date keys, file names, API payloads. Only the ones a human reads
off a generated document were changed. The remaining PDF/XLSX generators
(fees, accounting, library, hostel) are listed for their own passes rather than
swept blind, since telling a display string from a lookup key needs the module's context.

### F25 — A day picked in Dhaka was stored as a UTC day, so an admission cycle closed six hours late — **fixed**

Noticed while fixing F24: the admission cycle dialog turned the two `<input type="date">`
values into instants by string concatenation.

```ts
startAt: `${values.startAt}T00:00:00.000Z`,
endAt:   `${values.endAt}T23:59:59.999Z`,
```

Bangladesh is UTC+6, and the backend compares that instant directly
(`now > cycle.endAt.getTime()`). So a cycle advertised as closing on the 31st **kept
accepting applications until 05:59 on the 1st**, Dhaka time — and one advertised as
opening on the 1st did not actually open until 06:00 that morning. The bug was invisible
because the display side truncated the same value back to `2026-08-31`; formatting it
correctly for F24 is what exposed it, since `endAt` then rendered as **01/09/2026**.

`/admin/audit-logs` had the same fault from the other direction: `dateFrom` used
`new Date("2026-08-01")` (UTC midnight → 06:00 Dhaka, missing the first six hours of the
day) and `dateTo` used ``new Date(`${d}T23:59:59`)``, which parses in **the viewer's own**
timezone — the same machine-dependence as F18, in a filter rather than a label.

**Fix:** `startOfDayIso` / `endOfDayIso` in `lib/utils/date.ts`, fixed to `+06:00` — the
same reasoning `clock.util.ts` already documents on the backend, that BD has had no DST
since 2009, so a day boundary is a constant shift and needs no timezone library. Four
Vitest cases, including the one that states the bug outright:
`formatDate("2026-08-31T23:59:59.999Z")` is `01/09/2026`, while both new helpers
round-trip to `31/08/2026`.

**The lesson is about the pairing.** Storing a boundary in one calendar and displaying it
in another hides each error behind the other: two wrongs rendered right. The F24 fix
could only be finished by fixing F25 as well.

### F26 — The F23 fix only cleaned half, and the half it missed was the worse one — **fixed**

Found by counting rows after driving the M09 XLSX import: **guardians went 11 → 12
across a reseed**, and two rows had no student attached at all —
`মোঃ ফরিদ রহমান` (created by journey **J1**, last pass) and
`মোঃ সেলিম চৌধুরী` (created by the import, minutes earlier).

F23 converted the `students` purge to ownership-scoping and stopped there. The very next
line still read:

```ts
await prisma.guardian.deleteMany({ where: { name: { startsWith: 'QA ' } } });
```

A guardian created by the *application* is named by whoever filled the form — an
applicant, or a cell in a spreadsheet — so no prefix match will ever find it.

**This one is worse than a stray student**, because guardian **phone is the dedup key**
for siblings. A leftover row means the next run's sibling-dedup check reuses the stale
guardian and passes *without exercising the dedup at all* — a green test proving nothing.
A leaked student breaks a count and announces itself; a leaked guardian quietly disables
an assertion.

**Fix:** the whole purge block is scoped by `schoolId` — guardians, teachers, staff
profiles, sections, classes, subjects, departments, shifts. Every one of those tables
carries a `school_id` (the global rule), the application can create rows in all of them
during a QA round, and this seeder owns the demo school outright.

Verified: 12 students, 10 guardians, **0 unlinked guardians**, stable across reseeds.

**Fourth instance of the pattern**, and the first one found *inside a fix for the
pattern*. The rule after F23 was written as a rule and then applied to a single line.
Applying it to the whole block is what it should have meant the first time — when a
cleanup bug is found, convert every sibling deletion in the same block, not just the row
that bit.

### F27 — The COMPLETED session was empty, so its read-only rule could not be tested — **fixed**

M12's completion doc calls this out as notable: *"COMPLETED/ARCHIVED sessions are
read-only — the M05 rule, enforced for the first time here."* It is the rule that stops
someone quietly editing last year's register.

It could not be reached. The seed creates sections in **both** sessions — with a comment
saying that is "what makes the session-scoping sweep meaningful" — but enrolled students
only in the current one. With no enrolment in the old session there is no roster, nothing
to mark, and therefore nothing for the guard to refuse.

Two things went untested as a result:

- **COMPLETED sessions are read-only** (M12, M14, M15 all lean on it).
- **Session scoping** — the switcher only proves anything when the two sessions hold
  *different* rosters. An empty previous year cannot show a leak.

**Fix:** every student also gets a prior-year enrolment. Two details matter more than the
row itself:

- its status is **`PROMOTED`**, which is what `PromotionService.closeEnrollment` actually
  writes to a source enrolment — not the `COMPLETED` that reads plausibly but no code
  path produces. Seeding the status the product would have produced is the difference
  between a fixture and a guess, and it is what makes journey **J6** (year rollover)
  meaningful;
- the current-year rows are now typed `PROMOTED` too, bar two `NEW` admissions, so the
  fixture reads like a school in its second year rather than its first.

Verified afterwards: `POST /attendance/students` into the old session returns **400
"Session QA 2025 is COMPLETED — attendance is read-only"**, and the GET reports
`editable: false` with the identical `lockReason` — the write guard and the read hint
agree, which is the part worth checking.

**One observation, not filed as a defect.** The historical sheet's roster comes back
*empty*, because the canonical roster is deliberately ACTIVE-only
(`findSectionRoster`, documented as such). So a past year's page shows "read-only" over
an empty table rather than the day's record. Historical attendance is meant to be read
through the reports, which query the attendance rows directly — that is a defensible
split, but the empty table is a rough edge worth a UX decision rather than a fix.

### F12 (closed) — 92 orphaned `staff_attendances` rows, found live in the QA database

Open since the first pass, deferred twice as "an e2e cleanup problem". It was not: the
QA database itself was carrying **92 orphaned rows** dating back to 2026-07-02, and they
surfaced in this pass as **phantom LEAVE on the staff attendance sheet** — 8 teachers and
84 staff who no longer exist.

The cause is the M08 design decision, working exactly as documented: `staff_attendances`
is polymorphic (`person_type` + `person_id`, **no foreign key**) so the teacher and staff
lifecycles stay independent. Nothing cascades. Deleting the employees leaves their
attendance behind, attributable to nobody.

**Fix:** the purge deletes `staff_attendances` for the school explicitly, and *before*
the employees, while the rows can still be attributed. Verified: 0 rows after a reseed.

This also mattered beyond the sheet — **M21 payroll reads `staff_attendances`**, so the
pass I deferred this to would have been computing pay against phantom leave.

### F28 — One report, two numbers both called "percentage" — **fixed**

`GET /attendance/reports/student/:id` returned **42.86%** in its summary and **60%** for
the only section the student sat in, over the same range. Both fields were named
`percentage`.

The summary used the engine, which implements the roadmap formula — *(present + late +
½ half-day) ÷ working days*. The per-section figure came from `dayPercentage`, a private
helper in the reporting service that divided by **marked days** instead. 3 ÷ 7 against
3 ÷ 5.

The helper had five callers, and this is the part worth being careful about — **three of
them were right**:

| Caller | Question | Correct denominator |
|---|---|---|
| Daily sheet, per section | one day | students marked ✓ |
| Daily sheet, totals | one day | students marked ✓ |
| Summary trend point | one day | students marked ✓ |
| **Student report, per section** | a range | working days ✗ |
| **Summary, per section** | a range | working days × heads ✗ |

For a single day there *are* no working days to divide by, and an unmarked student is
missing data rather than an absence. The bug was not the formula but that one name
served two questions, in a helper sitting outside the golden-tested engine — which is
where this project's ground rules say arithmetic belongs, precisely so it cannot drift.

**Fix.** Three named functions in `calc/percentage.util.ts`, each documenting its
denominator: `sameDayPercentage`, `rangePercentage`, `cohortPercentage`. Nine golden
cases pin them, including the exact shape that exposed this (`42.86`) and an assertion
that `rangePercentage` and `summarize` agree.

Two further defects fell out of doing it properly:

- **The per-section figure needed real windows.** A student who transfers mid-year sits
  in two sections, and the working days must be split at the transfer date — which is
  why the marked-days shortcut existed. The report already loads every enrolment with
  its `enrollmentDate`, so the windows are derivable: each enrolment owns the days from
  its start until the next one begins. Verified: for a student in a single section the
  two figures are now identical (42.86% both), which is the invariant that was broken.
- **The school-wide figure read 100%.** Spotted only after fixing the sections: `overall`
  divided a whole school's present-days by working days with no headcount, so six
  present-days over eight working days read as full attendance. It is a cohort like any
  other — `6 ÷ (7 × 12)` = **7.14%**, which is the honest number for a school where one
  section of six was ever marked.

**The lesson is about naming, not arithmetic.** Every one of these numbers was a
plausible ratio. What made them wrong was that a reader — a head teacher deciding exam
eligibility — cannot tell which denominator they are looking at when both are called
`percentage` and sit in the same payload.

### F29 — "Today" was the UTC day, so for six hours every night it was yesterday — **fixed**

Surfaced by a routine created on **19 August** in Dhaka coming out **effective from the
18th**.

```ts
const today = new Date().toISOString().slice(0, 10);   // today in UTC
```

Bangladesh is UTC+6, so between 18:00 and midnight UTC — **midnight to 6 AM local**,
every day — that expression returns the previous day. Eight call sites had it, and the
consequences were not cosmetic:

| Site | What it dated a day early |
|---|---|
| `certificate-templates.service` | a certificate's printed `issueDate` |
| `admission-applications.service` | the `admissionDate` written when an applicant becomes a student |
| `timetable.service` | a new routine's `effective_from` |
| `attendance.executors` | the default date on an attendance dashboard — opening on the wrong register |
| `enrollments`, `exams`, `hostel-export` | comparison dates and a printed footer |

`dhakaToday()` has existed in `clock.util.ts` since M12 and is exactly this, done
correctly. The mistake is that the raw idiom *reads* right.

**Fix:** all eight go through `dhakaToday()`, plus `no-utc-today.spec.ts` — a source
guard banning `new Date()` (no argument) truncated to a date, while leaving the
legitimate `someInstant.toISOString().slice(0, 10)` alone.

### F30 — A `@db.Time` column reached the client raw, and the routine grid printed 1970 — **fixed**

Every row of the routine builder — the module's central screen — was labelled:

```
Period 1
1970-01-01T07:30:00.000Z–1970-01-01T08:15:00.000Z
```

Prisma returns `@db.Time` as a **Date on 1970-01-01**. `GET /period-slots` mapped it to
`"07:30"` through a `toView` helper; `GET /timetables/:id` embedded the raw Prisma model
instead. **The same column, two shapes, from two endpoints** — the frontend bug was only
downstream of that.

**Fixed at the source, not the symptom.** `toView` was private, which is why the second
endpoint could not reuse it. It is now an exported `toPeriodSlotView`, documented as the
only way a slot may reach a client, and the timetable detail maps through it. Patching
the frontend instead would have left the next consumer to rediscover it.

### F31 — Fourteen pickers asked for more rows than the API allows, and silently rendered empty — **fixed**

Found because the routine builder's cell editor logged a 400 on open:
`GET /sections?sessionId=…&limit=200` → **"limit must not be greater than 100"**.

Every list endpoint validates `limit` with `@Max(MAX_PAGE_LIMIT)`, capped at 100.
Over-asking is **not clamped** — it is a 400, and a rejected query renders as an empty
dropdown. Fourteen call sites asked for 200 or 300:

- the routine builder's **"combined with"** picker — the control that tells the conflict
  checker two sections legitimately share a teacher, so combined classes were
  unreachable;
- the **promotion wizard's target sections**, on both its pages;
- the assignment, inventory, library and alumni pickers.

The failure mode is what makes it dangerous: nothing throws, nothing appears in the UI,
and an empty dropdown is indistinguishable from a school that has not set anything up.

**Fix:** a frontend `MAX_PAGE_LIMIT` mirroring the backend constant, all 14 sites capped,
and a Vitest guard — which also **reads the backend file and asserts the two constants
still agree**, since they are a contract rather than a coincidence.

**Left as debt:** 100 is a ceiling, not a page size. A school with more than 100 sections
or alumni still needs a searchable or paginated picker; this turns a broken control into
a truncated one, which is better but not finished.

### F32 — The QA seed could not reach the routine builder at all — **fixed**

Two prerequisites were missing, and each dead-ended the module:

- **No bell schedule.** M13 refuses to build a routine without period slots — correctly,
  and with a good empty state saying so. But every reseed then left a QA round
  hand-building five periods first, and M12's period-mode marking unreachable for the
  same reason.
- **No teacher assignments.** The cell editor's teacher list is built from this session's
  M08 assignments, so a substitute can be picked and the assigned teacher ★-marked. With
  zero assignments the dropdown was **empty and no cell could be completed**.

**Fix:** the seed creates a five-period bell schedule (four lessons around a tiffin
break) and 24 subject assignments, split so that one teacher genuinely cannot be in two
places — which is what gives the conflict checker something real to catch.

**Plus a product fix.** An empty teacher list is a dead end a real school hits on its
first day, and the builder said nothing at all. It now names the missing prerequisite,
the same way the period-slots page already does one screen away.

### F33 — Publishing a routine always failed, on its own default date — **fixed**

Publish returned **400** and the UI showed a bare *"Validation failed"*.

`PublishDialog` seeds its date field from `timetable.effectiveFrom`, which the API
returns as a full instant (`2026-08-19T00:00:00.000Z`). An `<input type="date">` cannot
display that, so it rendered **empty** — but React state still held the ISO string, and
`onConfirm(date)` sent it to a DTO validating `^\d{4}-\d{2}-\d{2}$`.

So the default path — open the dialog, accept the pre-filled date, publish — failed every
time, and the field looked blank, so nobody could see what was wrong. It worked only if
the user happened to pick a date manually.

**Fix:** `isoDateInput(timetable.effectiveFrom)` — the helper introduced for **F24**,
which exists precisely to turn an instant into what a date input needs. Verified end to
end: the field pre-fills `19/08/2026` and publishing succeeds.

**A second, smaller thing, not separately filed:** the toast showed the envelope's
`message` ("Validation failed") and dropped its `details` array, which named exactly which
property was wrong. Worth surfacing — recorded against the envelope-contract sweep.

### F34 — The conflict tooltip crashed the entire page — **fixed**

The routine builder's red cells carry a tooltip listing every reason. Rendering one threw

```
Error: `Tooltip` must be used within `TooltipProvider`
```

which reached the route's error boundary, so the whole builder became **"Something went
wrong"**.

The severity is in *when* it fires. The tooltip renders **only when a cell actually
conflicts**, so the page worked perfectly until a genuine double-booking existed — and
then died at exactly the moment it had something important to say. It is the module's
headline feature.

It survived to now because producing a real conflict needs two sections, a shared
teacher, a bell schedule, and a *published* competitor (drafts deliberately do not
compete). That is the setup **F32** had made impossible.

**Fix:** the vendored `Tooltip` now provides its own context, which is what upstream
shadcn does — so the next consumer cannot reintroduce it. It was the only consumer in the
codebase, added for M13 and never rendered.

**Verified:** the cell shows `border-destructive`, and the tooltip reads *"Teacher clash:
Rahim Uddin is busy in QA Class 6 — A (Period 1 07:30)"* — naming the teacher, the
competing section and the slot. It also confirms the documented claim that conflicts are
**recomputed on read**: section B was never re-saved; publishing section A turned its cell
red on the next load.
