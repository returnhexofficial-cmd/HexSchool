# Browser QA Runbook

How to bring up a HexSchool environment that a full browser-QA round can drive —
and, crucially, **reset** between rounds. Results go in
[`docs/qa/`](./docs/qa/) — see [`docs/qa/README.md`](./docs/qa/README.md) for the
index and [`docs/qa/FINDINGS.md`](./docs/qa/FINDINGS.md) for the defect register.

The automated suites (2422 backend unit, 1033 e2e, 666 Vitest) prove units and API
contracts. This environment proves the app behaves in a real browser.

---

## Cold start

### 1 · Infrastructure

```bash
cd hexschool-backend
docker compose up -d postgres redis minio mailpit
```

> **Never run a bare `docker compose up -d`.** It also starts the `backend`
> container, whose BullMQ worker competes for jobs with the process you are
> testing — the same hazard `hexschool-backend/test/README.md` documents for the
> e2e suites. If it is already running: `docker compose stop backend`.

| Service | Port | Used for |
|---|---|---|
| postgres | **5433** → 5432 | the QA database (`smis` / `smis` / `smis`) |
| redis | 6379 | BullMQ; `/health` returns 503 without it |
| minio | 9000 API, **9001 console** | verifying uploads landed (bucket `smis`, `minioadmin`/`minioadmin`) |
| mailpit | 1025 SMTP, **8025 web + API** | OTP, password reset, notices, invoices |

### 2 · Database

```bash
cd hexschool-backend
DATABASE_URL="postgresql://smis:smis@localhost:5433/smis" npm run qa:reset
```

`qa:reset` = `qa:guard` → `prisma migrate reset --force` → `npm run seed` (reference
data) → `npm run seed:qa` (the demo school). Takes a couple of minutes; it replays all
27 migrations against an empty database, which is a free zero-drift check.

> Two things worth knowing, both learned the hard way:
>
> - **`prisma migrate reset` does not run the seed**, even though `prisma.config.ts`
>   declares `migrations.seed`. `npm run seed` has to be an explicit link in the chain,
>   which is why it is one.
> - **Prisma 7 blocks `migrate reset` when it detects an AI agent**, and asks for the
>   user's explicit consent via `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`. That is a
>   good guard — leave it in place and answer it yourself.

To re-seed only the demo data without replaying migrations:

```bash
DATABASE_URL="postgresql://smis:smis@localhost:5433/smis" npm run seed:qa
```

`seed:qa` is destructive **and** re-runnable — it purges its own previous output
first, so run it as often as you like.

> **The seed refuses to run against anything but localhost.** `hexschool-backend/.env`
> points `DATABASE_URL` at the **Neon dev database**, and these seeders would wipe it.
> `src/database/seeds/qa/guard.ts` blocks any non-local host. Do not weaken it; if you
> genuinely need another host, set `QA_ALLOW_DB_HOST`.

### 3 · Backend

```bash
cd hexschool-backend
DATABASE_URL="postgresql://smis:smis@localhost:5433/smis" \
  AUTH_THROTTLE_ENABLED=false npm run start:dev
```

> **`AUTH_THROTTLE_ENABLED=false` is required for the Playwright suite.** Credential
> routes are capped at 5/min per IP and every browser test signs in for itself, so
> without it a run authenticates the first few roles and is refused for the rest —
> which is exactly how the harness failed the first time it was run. The flag is
> ignored when `NODE_ENV=production`, so it cannot weaken a real deployment.

Serves `http://localhost:5007/api/v1`. Confirm all four indicators are up:

```bash
curl -s http://localhost:5007/api/v1/health
```

Other surfaces: Swagger `/api/docs` (946 operations), Bull Board `/admin/queues`
(basic auth `admin` / `admin-dev-pass`).

> **Windows / Git Bash:** `npm run start:dev` uses `nest start --watch`, whose restart
> calls `taskkill`. Launched from Git Bash that is not on `PATH`, so the watcher dies
> on the first file change (the server itself keeps serving). Start it from PowerShell,
> or use `npm run start` and restart manually.

### 4 · Frontend

```bash
cd hexschool-frontend
npm run dev
```

Serves `http://localhost:3000`; `.env.local` already points at `:5007/api/v1`.

> **If any `[param]` detail page 404s, delete `.next` and restart.** A stale dev build
> makes every dynamic route unreachable — that was finding **F1**, and it hid ~19
> detail pages for a whole QA round.
>
> ```bash
> rm -rf .next && npm run dev
> ```

---

## Seeded logins

Password for **every** QA account: `QaPass123!`

| Login | Role | User type |
|---|---|---|
| `admin@qa.hexschool.local` | admin | ADMIN |
| `principal@qa.hexschool.local` | principal | STAFF |
| `viceprincipal@qa.hexschool.local` | vice-principal | STAFF |
| `office@qa.hexschool.local` | office-staff | STAFF |
| `accountant@qa.hexschool.local` | accountant | STAFF |
| `admissions@qa.hexschool.local` | admission-officer | STAFF |
| `librarian@qa.hexschool.local` | librarian | STAFF |
| `teacher@qa.hexschool.local` | teacher | TEACHER |
| `teacher2@qa.hexschool.local` | teacher | TEACHER |
| `student@qa.hexschool.local` | student | STUDENT |
| `parent@qa.hexschool.local` | parent | PARENT |

Plus the bootstrap super admin `admin@hexschool.local`. Its password is
**`SEED_SUPER_ADMIN_PASSWORD` from `hexschool-backend/.env`** (which is set), falling
back to `ChangeMe123!` only when that variable is absent — so do not assume the default.
A fresh `npm run seed` also sets `mustChangePassword`, so this account lands on the
change-password interstitial; the QA accounts deliberately do not.

Prefer `admin@qa.hexschool.local` for QA. SUPER_ADMIN **bypasses every permission
check**, so it is the one account that cannot reveal a gating bug.

**Having a login per role is the point.** Permission boundaries, the 403 path and the
portals cannot be tested from a SUPER_ADMIN account, which bypasses every check —
tracker scenario M03-13 sat unrun for the entire project until these existed.

### What the demo school contains

| | |
|---|---|
| Sessions | `QA <year>` **ACTIVE/current** + `QA <year-1>` **COMPLETED** (read-only for entry flows, and gives the session switcher something to switch to) |
| Structure | 1 department, 1 shift, 3 classes (levels 6–8), 2 sections per class **per session**, 4 subjects |
| Staff | 6 staff profiles (one per non-teaching role) + 2 teachers |
| Students | 12, all enrolled in the current session, **all with Bangla names** |

Deliberate fixtures, each backing a scenario no happy path reaches:

- **student #1 is linked to the student login** — the portal needs a real student.
- **the parent login owns two children** — the child switcher, and the sharpest test of
  `assertOwnsStudent`, the single IDOR chokepoint for every portal route.
- **`teacher2` holds no sections** — M22's policy service re-reads
  `teacher_section_subjects` live on every request, so proving a roster reassignment
  moves evaluation rights needs both a holder and a non-holder.
- **the last student has no guardian** — every list, export and notification path
  should survive it.
- Bangla names by default, so every module exercises Unicode without a special case.

---

## Gotchas that have already cost a QA round

| | |
|---|---|
| **Login throttling** | 5/min per IP on credential routes, 30/min on refresh. Only disabled under `NODE_ENV=test`. Log in once and reuse the session; do not script login-per-test. |
| **Playwright MCP `--isolated`** | A persistent `--user-data-dir` made the server reuse a live page across runs, carrying form state and network logs between stages — two false failures. |
| **`target` selectors** | Takes a snapshot ref *or* a plain CSS selector. **Not** `:has-text()` — it throws "does not match any elements". Prefer `#role-name`, `input[name=…]`. |
| **Toasts** | sonner, rendered outside `<form>` in the root layout. Query `[data-sonner-toast]` and read within ~4 s before auto-dismiss. |
| **Cold-load 401s** | Every hard navigation fires 1–2 requests that 401 before the refresh lands (finding **F6**) — the access token is in memory only. Expected; do not fail tests on them blindly. |
| **`<Can>` timing** | Gated controls appear only after `/auth/me` resolves (finding **F5**). Wait on the gated control, not the table. |
| **Manifests lie** | `.next/dev/routes-manifest.json → dynamicRoutes: 0` is normal under Turbopack — it is populated lazily per compiled route, not a route table. Do not diagnose routing from it. |
| **Anonymous `/admin/*`** | `proxy.ts` redirects everything under `/admin` with a **307** before routing, matched or not. Probe dynamic routes **signed in**, or you learn nothing. |
| **Asia/Dhaka vs UTC** | Stored UTC, displayed Asia/Dhaka. This has broken the suite four times. "A test that passes at 14:00 and fails at 19:00 is not flaky, it is wrong." Run one pass after 18:00 Dhaka. |
| **First navigation to a route is slow** | Against a cold `next dev`, Turbopack compiles each route on first visit — a navigation can take well over the 10 s default. Give the *first* assertion on a newly-visited route a generous timeout, or the suite reports a compile delay as a routing failure. |
| **`next build` clobbers the dev build** | Running `npx next build` while (or before) `next dev` uses the same `.next` is what produced **F1** in the first place. After any build, `rm -rf .next` before starting dev. |
| **Line endings are LF, enforced** | `.gitattributes` sets `* text=auto eol=lf`, which overrides a global `core.autocrlf=true`. If a file ever shows a whole-file diff or Prettier flags every line with `Delete ␍`, your working copy drifted to CRLF — run `git add --renormalize .` rather than reformatting. |
| **`seed:qa` logs out every open browser** | It purges and recreates the QA users, so any refresh token in a live tab belongs to a deleted account and the next navigation lands on `/login`. Expected — just sign in again. Re-seed *before* a run, not in the middle of one. |

---

## Known limitations — do not file these as new findings

Recorded in `PROJECT_CONTEXT.md` §18 and accepted:

- **PDFs cannot render Bangla** — plain pdfkit; a Bangla name transliterates.
- **No table is virtualized** — 100+ row grids are slow by design, for now.
- **No media library** — cover images, voucher/leave/ticket attachments, visitor photos
  and certificate backgrounds are pasted URLs, not uploads.
- **Rich text is HTML in a textarea**, no WYSIWYG (M19, M20, M22, M27).
- **Payment gateways are stubbed** — SSLCommerz/bKash/Nagad sandboxes are blocked on
  external accounts.
- **Public-site Lighthouse Performance 79** vs a ≥90 target (`app/layout.tsx` hydrates
  Redux + TanStack + Auth on static marketing pages).

---

## The committed browser suite

```bash
cd hexschool-frontend
npm run test:e2e            # all projects
npm run test:e2e -- --project=qa
npm run test:e2e:ui         # interactive
npm run test:e2e:report     # last HTML report
```

Layout under `hexschool-frontend/e2e/`:

| Path | Contents |
|---|---|
| `smoke.spec.ts` | harness health + regression guards for **F1** and **F9** |
| `sweeps/` | data-driven passes across roles and routes (permission sweep guards **F8**) |
| `modules/` | per-module specs, `NN-<module>.spec.ts` |
| `journeys/` | the cross-module golden threads |
| `support/` | `auth`, `console-guard`, `mailpit`, `ui` helpers |

### Sign-in: why every test logs in for itself

The usual Playwright pattern — authenticate once in a `setup` project and reuse
`storageState` — **does not work against this app**, and it fails destructively:

- refresh tokens **rotate**, so every cold page load spends the presented token;
- Playwright builds a fresh context per test, replaying the *same* saved snapshot;
- from the second test on, that token is already revoked, which is indistinguishable
  from theft — reuse detection revokes **every session for that user** and the test
  lands on `/login`.

So `e2e/support/auth.ts` exposes a `signIn` fixture that logs in per test through the
API. Two details it encodes, both of which cost a debugging cycle to find:

- **`hs_session` is set by the browser, not the API.** It is the non-sensitive hint
  `proxy.ts` uses for its optimistic route guard, so an API-only login must add it by
  hand or every `/admin` navigation bounces to `/login`.
- **A TEACHER account lands on `/portal`, not `/admin`.** The landing route follows the
  account's *user type*; the teacher role still carries admin permissions and can
  navigate into `/admin` from there.

## Before calling a module's QA done

```bash
cd hexschool-backend  && npx tsc --noEmit && npx jest --silent
cd hexschool-frontend && npx tsc --noEmit && npx vitest run && npx next build

# e2e — local DB, and start infra services by name
cd hexschool-backend
docker compose up -d postgres redis minio mailpit
DATABASE_URL="postgresql://smis:smis@localhost:5433/smis" NODE_ENV=test \
  npx jest --config ./test/jest-e2e.json --forceExit

# browser suite — needs the QA seed and both servers running (see above)
cd hexschool-frontend && npm run test:e2e
```

Baseline: **2422 backend unit / 666 frontend Vitest / 26 browser**. The backend e2e suite is 1033 across 29 suites, with two known
failures in `hr.e2e-spec.ts` (finding **F10**).

Record the outcome in the tracker **and** in the module's own
`docs/modules/NN-*.md` → "Manual Testing Results" table, which is where the roadmap's
Global Conventions say manual QA belongs.
