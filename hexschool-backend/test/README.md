# Running the e2e suite

```bash
docker compose up -d postgres redis minio mailpit   # NOT a bare `up -d` — see below
DATABASE_URL="postgresql://smis:smis@localhost:5433/smis" NODE_ENV=test npm run test:e2e
```

Use `npm run test:e2e`, not a bare `jest --config` — the script carries
`--max-old-space-size=8192`.

## Start the infra services by name

**`docker compose up -d` with no arguments also starts the `backend`
service.** That container runs its own copy of the API against the same
Postgres *and the same Redis*, so its BullMQ worker **competes with the test
process for jobs**. A notification or a result-processing run gets picked up
by the container instead of the app under test, never reaches its terminal
status, and the suite reports "did not reach SENT in time" — which reads like
a code defect and is not one.

Symptoms of a polluted queue environment:

- Only the two **queue-dependent** suites fail — `communication` (waits for a
  notification to settle) and `result` (waits for a processing run to
  complete). Everything else is green.
- A *different* subset fails on each run.
- `[ioredis] Unhandled error event: Error: Stream isn't writeable and
  enableOfflineQueue options is false` in the output.

Recovery: `docker compose down`, then `docker compose up -d postgres redis
minio mailpit`. Measured during M20: on a polluted stack `result.e2e-spec`
took **130 s and failed 29 of 55**; on a clean one it is **55/55 in ~10 s**.

**Do not `redis-cli flushall` while anything is connected** — it pulls live
BullMQ structures out from under connected clients and produces exactly the
`Stream isn't writeable` errors above.

## The two budgets, and why they are what they are

Neither is about the code under test.

| | Value | Why |
|---|---|---|
| `--max-old-space-size` (package.json) | **8192** | Every suite's `beforeAll` compiles a whole Nest application, and `maxWorkers: 1` puts all of them in one process (deliberately — the suites share one dev DB, Redis and Mailpit; parallel workers caused cross-suite flakes, see `PROJECT_CONTEXT.md` §16). M19 set 6144 for 19 suites; raised with M20's twentieth. |
| `testTimeout` (jest-e2e.json) | **60000** | Same reason — a `beforeAll` that compiles an app needs room on a contended box. |

Both were raised after a run in which `portal`, `communication` and `website`
all timed out in `beforeAll`. That run turned out to be on a **polluted
stack** (see above), so the raises are a precaution rather than a proven
necessity — they cost nothing and remove a class of misleading red, but do
not treat them as evidence that 20 suites cannot fit in the old budget.

Expect to revisit around 24 suites. Sharding the e2e run is the durable fix
and belongs to M30.

## The tell

When several *unrelated* suites fail in `beforeAll` at once, or only the
queue-dependent ones fail and in a different combination each time, check the
environment before hunting a bug. Both look exactly like a regression and
neither is one.
