---
name: smis-qa
description: Run in-browser QA of SMIS/HexSchool through the Playwright MCP server and fix what it finds — per-module click-throughs, cross-module journeys, permission/portal/session sweeps. Use when asked to QA a module in the browser, verify a flow works for real, reproduce a UI bug, or continue the browser-QA campaign. Owns the QA environment (resettable local database, a login per role), the tracker, and the fix-and-re-verify loop.
---

# SMIS browser QA

Jest/Vitest prove units and API contracts (2445 backend unit / 1033 e2e / 681 Vitest).
This skill proves the app behaves **in a real browser**, and fixes what it finds in the
same pass.

Two documents own the state — read them before starting:

| File | Role |
|---|---|
| `QA_RUNBOOK.md` (repo root) | how to bring the environment up, seeded logins, gotchas, known non-bugs |
| `docs/qa/README.md` | coverage index, cross-cutting sweeps, the pass plan |
| `docs/qa/FINDINGS.md` | the findings register (F1…) with diagnosis and state |
| `docs/qa/NN-*.md` | per-module scenario results, named to match `docs/modules/NN-*.md` |
| `docs/qa/HARNESS.md` | how to drive the browser: selectors, toasts, timing traps |

## Environment, in one breath

```bash
cd hexschool-backend
docker compose up -d postgres redis minio mailpit     # never a bare `up -d`
DATABASE_URL="postgresql://smis:smis@localhost:5433/smis" npm run seed:qa
DATABASE_URL="postgresql://smis:smis@localhost:5433/smis" \
  AUTH_THROTTLE_ENABLED=false SMS_DEV_OUTBOX=true npm run start:dev
cd hexschool-frontend && npm run dev
```

`AUTH_THROTTLE_ENABLED=false` is required for the committed suite: credential routes
are capped at 5/min per IP and every browser test signs in for itself. The flag is
ignored under `NODE_ENV=production`.

**QA runs against local Docker, never Neon.** `.env` points at Neon; the seeders refuse
any non-localhost host (`src/database/seeds/qa/guard.ts`) and the guard runs first in
`qa:reset`, before Prisma can drop anything. Never weaken it.

**Sign in as `admin@qa.hexschool.local` / `QaPass123!`, not the super admin.**
SUPER_ADMIN bypasses every permission check, so it is the one account that cannot
reveal a gating bug. There is a login per role — that is the whole reason the seed
exists.

## The committed browser suite

```bash
cd hexschool-frontend && npm run test:e2e        # 41 specs, ~1.8 min
```

`e2e/smoke.spec.ts` (harness health + F1/F9 guards), `e2e/sweeps/` (`permissions` —
role × route, guards F8; `a11y` — axe over the admin panel and public site; `dates` —
no ISO date rendered on any page), `e2e/modules/`, `e2e/journeys/`, and `e2e/support/`
(`auth`, `console-guard`, `mailpit`, `ui`, `a11y`).

**Dates are the bug that keeps coming back** — F9 → F18 → F24, three times in three
different shapes, plus F25 and F29 for the boundary/"today" variants. Two source guards
now know several shapes each (`no-unlocalised-dates.test.ts` in the frontend,
`no-utc-today.spec.ts` in the backend), but the one that keeps catching *new* ones is
`sweeps/dates.spec.ts`, because it reads the **rendered page** and so needs no knowledge
of field names — it is what caught `effectiveFrom`, which ends in neither `Date` nor
`At`. Add a page to its list whenever a pass reaches a new screen.

**Accessibility.** `expectNoA11yViolations(page, label)` blocks on serious/critical and
reports moderate/minor. When a violation is systemic rather than page-specific, exclude
the **selector** in `KNOWN_ISSUE_SELECTORS` with its finding id — never the **rule**,
which would hide every future instance too (see F13).

**API contract fuzzing.** Schemathesis over the OpenAPI spec, safe here because the QA
database resets:

```bash
curl -s -u admin:admin-dev-pass http://localhost:5007/api/docs-json -o openapi.json
PYTHONIOENCODING=utf-8 schemathesis run openapi.json \
  --url http://localhost:5007 -H "Authorization: Bearer $TOKEN" \
  --include-method GET --max-examples 3 --phases examples,fuzzing
```

`PYTHONIOENCODING=utf-8` is required on Windows or it dies on its own banner. Start with
`--include-method GET`; only open it to mutating methods right after a `seed:qa`. The
first run found **zero 500s** across 474 GETs but 318 spec-vs-reality mismatches — see
**F15** before treating any failure as new.

**Every test signs in for itself via the `signIn` fixture — never `storageState`.**
Refresh tokens rotate, so a replayed snapshot presents a spent token, which reuse
detection treats as theft and answers by revoking *every* session for that user. Two
more traps the fixture encodes: `hs_session` is set by the browser rather than the API
(without it `proxy.ts` bounces every `/admin` navigation to `/login`), and a **TEACHER
account lands on `/portal`, not `/admin`**.

## The loop, per module

1. **Charter — harvest, don't invent.** The scenarios are already written:
   `SMIS_DEVELOPMENT_ROADMAP.md` module §8 *Edge Cases* and §9 *Testing Checklist*;
   `docs/modules/NN-*.md` → *Remaining TODOs* (this is where the "in-browser
   click-through pending" backlog lives); `PROJECT_CONTEXT.md` §11 for the module's
   business-rule invariants. Number them `NN-01…` in the tracker, all ⬜.

2. **Drive** through Playwright MCP.

3. **Triage** each failure: frontend / backend / schema / seed gap / spec ambiguity /
   environment. Check the runbook's *known limitations* first — Bangla-in-PDF, no table
   virtualization, pasted-URL media, HTML-in-a-textarea and stubbed payment gateways are
   accepted and must not be re-filed.

4. **Fix immediately** via `smis-frontend` / `smis-backend` / `smis-database` /
   `smis-debug`, respecting the ground rules in `CLAUDE.md`.

5. **Re-verify in the browser**, then add a regression test **at the lowest layer that
   would have caught it** — a golden engine test beats an e2e test beats a browser test.

6. **Record** in the tracker *and* the module doc's *Manual Testing Results* table,
   which is where the roadmap's Global Conventions say manual QA belongs.

## What every charter must include beyond the happy path

The Global Conventions already mandate, for **every list page**: search, filters,
pagination, sorting, CSV/XLSX export, loading skeleton, empty state, error state. That
is a free checklist — use it. Then add:

- **a permission boundary** — a seeded role that may *not* do the thing, proving both
  the hidden control and the API 403
- **a refusal that leaves no trace** — this project shipped the opposite bug (M15 wrote
  before consulting the gate, so a refused publish left a live publication)
- **session scoping** — flip the switcher; the page must re-query. Every session-scoped
  page reads `useAcademicSession().selected` and never fetches "current" itself
- **immutability** where the module publishes — corrections are re-issues with an audit
  trail, never in-place edits
- **Bangla text, BDT amounts, BD phone numbers, DD/MM/YYYY dates** in at least one form

## Harness gotchas — each of these has already cost a round

- **`--isolated`.** A persistent `--user-data-dir` reuses a live page between runs,
  carrying form state and network logs across stages. It produced two false failures.
- **`target` takes a snapshot ref or a plain CSS selector — not `:has-text()`**, which
  throws "does not match any elements". Prefer `#role-name`, `input[name=…]`. To match
  on text, click via `browser_evaluate`.
- **Assert with `browser_evaluate` returning structured JSON.** Far easier to diff
  between runs than a snapshot tree, and snapshots go to files rather than into the
  tool result.
- **Toasts** are sonner, rendered outside `<form>` in the root layout. **Install a
  `MutationObserver` before the click, in the same `browser_evaluate`** — polling for
  `[data-sonner-toast]` afterwards reads empty on actions that *did* toast and nearly
  produced a bogus "the refusal gives no feedback" finding against M06.
- **Cold loads produce 401s by design** (finding F6) — the access token is in memory
  only, so a hard navigation fires queries before the refresh lands. Do not report them
  as bugs and do not let a console guard fail on them blindly.
- **Gated controls lag `/auth/me`** (F5). Wait on the gated control, not the table.
- **Anonymous `/admin/*` always returns 307**, matched route or not — `proxy.ts`
  redirects before routing. Probe dynamic routes **signed in** or you learn nothing.
- **Next dev manifests are lazy.** `routes-manifest.json → dynamicRoutes: 0` is normal
  under Turbopack; it is not a route table. Never diagnose routing from it.
- **If a `[param]` page 404s, `rm -rf .next` and restart** before investigating
  anything else. That was F1, and it hid ~19 detail pages for an entire round.
- **Asia/Dhaka vs UTC.** Stored UTC, displayed Dhaka; this has broken the suite four
  times. A test that passes at 14:00 and fails at 19:00 is not flaky, it is wrong.

## Verifying beyond the DOM

| Surface | How |
|---|---|
| Email / OTP | Mailpit API `http://localhost:8025/api/v1/messages` |
| SMS / phone OTP | `GET /api/v1/dev/sms?to=<number>` with `SMS_DEV_OUTBOX=true` — the log never carries the body (**F19**) |
| Uploads | MinIO console `:9001` (`minioadmin`/`minioadmin`), bucket `smis` |
| Queued work | Bull Board `/admin/queues` (`admin`/`admin-dev-pass`) |
| Envelope contract | The UI showing `apiErrorMessage`'s fallback *"Something went wrong. Please try again."* means the response did **not** carry the standard error envelope |

## Before calling a module done

```bash
cd hexschool-backend  && npx tsc --noEmit && npx jest --silent
cd hexschool-frontend && npx tsc --noEmit && npx vitest run && npx next build
cd hexschool-backend && DATABASE_URL="postgresql://smis:smis@localhost:5433/smis" \
  NODE_ENV=test npx jest --config ./test/jest-e2e.json --forceExit
cd hexschool-frontend && npm run test:e2e
```

Baseline: **2445 backend unit / 681 frontend Vitest / 41 browser**. The backend e2e
suite has two known failures in `hr.e2e-spec.ts` (finding **F10**) — confirm any new
failure is yours before chasing it.

**Do not commit or push** — the owner commits each module manually.
