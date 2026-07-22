---
name: smis-testing
description: Write or fix tests for SMIS/HexSchool — backend Jest unit specs for services and pure engines, backend e2e suites in test/*.e2e-spec.ts, and frontend Vitest tests. Use when adding test coverage, when a test is failing or flaky, or when deciding what a new feature must prove. Encodes the mocking style, the e2e fixture/cleanup pattern, how to run e2e against the right database, and the bugs this project has actually shipped.
---

# SMIS testing

Backend Jest (`*.spec.ts` beside the source, `rootDir: src`) + e2e
(`test/*.e2e-spec.ts`). Frontend Vitest + Testing Library.
Current baseline: **808 backend unit / 280 e2e (15 suites) / 195 frontend**.

## Pure engines: golden tests

Engines in `src/modules/<name>/calc/` are dependency-free, so test them
directly with hand-computed fixtures and **name the domain rule in the
test title**:

```ts
it('never lets a failed optional subject fail the candidate', () => { … });
it('fails the whole exam on one compulsory F, with GPA 0.00', () => { … });
```

Export a shared fixture from the first spec that defines it — the NCTB
scale lives in `grading-snapshot.spec.ts` and the other four engine specs
import `NCTB` from it.

Cover the boundary that the naive implementation gets wrong: 32.5 %
(between bands), exactly-at-pass-mark, absent vs missing, the optional
subject, an empty input.

## Service specs: plain object mocks

No `Test.createTestingModule` for services — construct directly with
`as never` mocks. That is the whole convention:

```ts
service = new MarksService(
  marks as never,
  corrections as never,
  candidates as never,
  exams as never,
  sessions as never,
  { getUserPermissionCodes: jest.fn().mockResolvedValue([]) } as never,
  { set: jest.fn() } as never,
);
```

**When you add a constructor parameter to a service, every existing spec
breaks.** `tsc --noEmit` finds them all — fix each with a mock and a
one-line comment saying what it defaults to.

Lint rules that shape spec code (these are errors, not warnings):
- `require-await` — `jest.fn(async (fn) => fn({}))` fails; write
  `jest.fn((fn) => Promise.resolve(fn({})))`.
- `no-unsafe-assignment` — a nested `expect.objectContaining` inside an
  object literal fails. Cast the call instead:
  ```ts
  const [payload] = repo.create.mock.calls[0] as [{ markId: string }];
  expect(payload.markId).toBe('mark-1');
  ```
- Rich refusals travel in `error.details`, not the message. Pull them out
  typed with a small helper rather than matching a nested shape.

## e2e suites

One per module, `test/<module>.e2e-spec.ts`, **serial** (`maxWorkers: 1`)
because all 15 share one dev DB / Redis / Mailpit.

Structure, copied from `exam.e2e-spec.ts` / `result.e2e-spec.ts`:

1. `Test.createTestingModule({ imports: [AppModule] })`, then mirror
   `main.ts`: `setGlobalPrefix('api/v1')`, `cookieParser()`, the same
   `ValidationPipe`.
2. `syncPermissionRegistry` + `seedSystemRoles`, then `cleanup()`.
3. Build fixtures under a **distinctive prefix** (`E2E-RS`, `E2E RS`) and
   delete by that prefix in `cleanup()`, called in both `beforeAll` and
   `afterAll`. FK cascades from the academic session take most of it.
4. Create **narrow roles** to prove the permission boundaries — the M15
   suite has a role that may enter and submit marks but not verify them,
   and one that may verify but not publish. That is the point of a
   four-eyes flow and only e2e can show it.
5. Dates relative to today (`day(-13)`), never hard-coded — status guards
   depend on the exam window being in the past.

**Drive the DB constraints past the service on purpose.** The hand-written
CHECKs are the last line of defence and only a real database proves them:

```ts
await expect(
  prisma.$executeRawUnsafe(`UPDATE marks SET is_absent = true, total = 40 WHERE id = '${id}'`),
).rejects.toThrow(/chk_marks_absent_empty/);
```

**Poll for asynchronous work**, never sleep-and-hope: a queued processing
run (`waitForRun`), and any fire-and-forget audit row.

### Running e2e

`.env` points at **Neon**. Always override to the local Docker Postgres:

```bash
cd hexschool-backend
docker compose up -d                       # postgres:5433, redis, minio, mailpit
DATABASE_URL="postgresql://smis:smis@localhost:5433/smis" NODE_ENV=test \
  npx jest --config ./test/jest-e2e.json --forceExit
# one suite:  … --config ./test/jest-e2e.json result.e2e-spec --forceExit
```

**Redis must be up.** Suites that touch BullMQ hang silently without it —
start Docker Desktop first.

## Bugs this project actually shipped — test for these shapes

Each was found late; each is a class, not a one-off.

- **M14 — a pure engine de-duplicated a pair by comparing ids**, so the
  same-day clash was dropped whenever the UUIDs sorted the other way. The
  unit suite missed it because every fixture listed `es-1` before `es-2`.
  → *When an engine compares ids, assert both orders.*
- **M15 — the write happened before the gate was consulted**, so a refused
  publish still left an active publication live, and a republish was never
  gated at all. → *Test that a refusal leaves no trace.*
- **health e2e asserted on process-wide state** (heap), which is the Jest
  worker's, not the app's; and the probe map moves from `body.details` to
  `body.error.details` on a 503. → *Never assert on the worker's memory;
  handle both response shapes.*
- **school e2e read a fire-and-forget audit row once** and lost the race.
  → *Poll.*

## Frontend

Vitest + jsdom, `src/**/*.test.{ts,tsx}`, alias `@ → src`. The highest-value
tests are the **mirrored engines** in `src/lib/validations/*.test.ts` —
they must agree with the backend engine, so port the backend's cases and
keep the same test names.

```bash
cd hexschool-frontend && npx vitest run
```

## Before calling anything done

```bash
cd hexschool-backend  && npx tsc --noEmit && npx jest --silent
cd hexschool-frontend && npx tsc --noEmit && npx vitest run
# plus the e2e command above, and `npx next build`
```

Report the **new totals and the delta** — every completion doc does.
