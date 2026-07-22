---
name: smis-debug
description: Diagnose failures in SMIS/HexSchool — Nest DI errors and module cycles, hanging or flaky e2e suites, Prisma/migration drift, wrong-database confusion, permission 403s, response-envelope surprises, BullMQ/Redis problems, and phantom lint errors. Use when something is broken, failing intermittently, or behaving differently than the code suggests it should.
---

# Debugging SMIS

Check the known failure modes below before generic debugging — most
surprises in this repo are one of these.

## "Nest can't resolve dependencies of X"

Read the message: it names the missing provider **and the module Nest
looked in**.

1. **Not exported.** Many repositories are deliberately module-private
   (`StudentGuardiansRepository`, `ExamSubjectsRepository` before M14).
   Don't add an export — **re-provision the stateless repository** in the
   consuming module, the convention since M03:
   ```ts
   providers: [ /* … */ StudentGuardiansRepository ]  // only needs PrismaService
   ```
2. **Queue not registered.** `@InjectQueue(NOTIFICATIONS_QUEUE)` needs
   `BullModule.registerQueue({ name })` **in that module too**, not just
   in `QueuesModule`.
3. **A real cycle.** If A imports B and B imports A, one side must switch
   to re-provisioning, or the behaviour must move behind a DI token bound
   in the *earlier* module (`exam.gates.ts`, `TIMETABLE_CONFLICT_CHECKER`).

The e2e suites compile the whole `AppModule`, so **they are the fastest
way to prove the graph is sound** — a DI error fails every test in the
file with `Cannot read properties of undefined`.

## e2e hangs, or every test in a suite fails

- **Redis down** → BullMQ suites hang silently. `docker compose up -d`,
  and start Docker Desktop first.
- **Wrong database.** `.env` points at **Neon**; e2e must run locally:
  ```bash
  DATABASE_URL="postgresql://smis:smis@localhost:5433/smis" NODE_ENV=test \
    npx jest --config ./test/jest-e2e.json --forceExit
  ```
- **Migration not applied** to whichever DB you are hitting →
  `npx prisma migrate status`.
- Suites are **serial by design** (`maxWorkers: 1`) — one dev DB. If you
  see cross-suite interference, check the fixture prefix is distinctive
  and that `cleanup()` runs in `beforeAll` as well as `afterAll`.

## A test passes alone but fails in the full run

Almost always an assertion on shared or process-wide state:
- **`health.e2e-spec`** — memory probes measure the Jest worker carrying
  every prior suite's heap, and the probe map moves to
  `body.error.details` on the resulting 503.
- **Fire-and-forget writes** — audit rows are written after the response
  by design. Poll for them.
- **Leftover fixtures** from a suite that crashed before `afterAll`.

## Migration / drift confusion

- `migrate diff` reporting "No difference detected" does **not** cover
  partial indexes, expression indexes or CHECK constraints — Prisma cannot
  introspect them. Assert those with SQL against `pg_constraint` /
  `pg_indexes`.
- Prisma 7 has **no `--from-url`**. Use
  `DATABASE_URL=… npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`.
- A duplicated index usually means the same rule is declared as `@@unique`
  *and* hand-written with a `WHERE`. Keep the hand-written one only.
- Node scripts using `new PrismaClient()` fail here — the runtime needs the
  `@prisma/adapter-pg` driver adapter. Use `npx prisma db execute --file`
  or `docker compose exec postgres psql` for ad-hoc queries.

## Unexpected 403

1. Is the code in `permission.registry.ts`? An unregistered code is
   orphaned and **denied**.
2. Has the seeder run since it was added? `npm run seed`.
3. Permissions are Redis-cached 5 minutes per user (`perm:{userId}`),
   invalidated on role change — a stale cache looks exactly like a missing
   grant.
4. Is it an **override** permission? Those are runtime checks inside the
   service, not route decorators — the route succeeds and the branch
   throws.
5. Super Admin bypasses by `user_type`, so "works as admin" proves nothing.

## Response shape surprises

- Everything is enveloped: `{ success, data, meta?, message? }`. A test
  reading `res.body.id` should read `res.body.data.id`.
- `@SkipEnvelope()` routes (files, health, iCal) return raw — and on an
  **error** they still go through the global filter, so the shape changes
  between success and failure. Handle both.
- Structured refusals live in `error.details` (`marks`, `conflicts`,
  `unlockedPapers`), never in `message`.

## Guard ordering

Global guards run in **provider registration order**, and root-module
providers register before imported modules'. The chain is pinned in
`AppModule`: Throttler → `JwtAuthGuard` → `PermissionsGuard`. Registering
an `APP_GUARD` from a feature module silently breaks the order.

Also: throttling is **disabled entirely under `NODE_ENV=test`**, so e2e
never exercises rate limits.

## Thousands of `Delete ␍` lint errors

`core.autocrlf=true` with no `.gitattributes` leaves stored line endings
inconsistent per module. The errors are real to eslint but the file is
unchanged in `git diff`. Re-save the affected files as LF, or run
`npx eslint <path> --fix`. `enrollment` and `rbac` still carry ~870 of
these — pre-existing, not yours.

## React "Avoid calling setState() directly within an effect"

A React Compiler **error**, not a warning. Derive the value instead of
storing it, or adjust state during render against an identity key. See
the `smis-frontend` skill.

## Useful one-liners

```bash
# what changed vs the last commit
git status --short && git diff --stat

# does the module graph boot at all?
cd hexschool-backend && DATABASE_URL="postgresql://smis:smis@localhost:5433/smis" \
  NODE_ENV=test npx jest --config ./test/jest-e2e.json health.e2e-spec --forceExit

# infra up?
docker compose ps --format "{{.Service}} {{.State}}"

# which DB am I about to hit?
npx prisma migrate status | head -3
```
