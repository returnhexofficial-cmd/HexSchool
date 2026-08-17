# HexSchool / SMIS

School Management Information System for Bangladeshi schools. Two repos in
this workspace, built module by module against a 32-module roadmap.
**29 modules complete.**

- `hexschool-backend` — NestJS 11, Prisma 7, Postgres 16, Redis/BullMQ, S3
- `hexschool-frontend` — Next.js 16 (App Router), React 19, TanStack Query,
  Redux Toolkit, shadcn/ui, RHF + Zod

## Read these before changing anything

| File | Role |
|---|---|
| `PROJECT_CONTEXT.md` | **living architecture memory** — shared services, entity spine, global business rules, every technical decision with its rationale (§16), open technical debt (§18). The authority when the roadmap disagrees. |
| `PROJECT_PROGRESS.md` | what is done, what is next, current test counts |
| `SMIS_DEVELOPMENT_ROADMAP.md` | per-module specification + the Global Conventions that apply to every module |
| `MODULE_DEPENDENCIES.md` | build order, and the hooks each module left for later ones |
| `docs/modules/NN-*.md` | one completion document per finished module |
| `QA_RUNBOOK.md` | how to stand up the browser-QA environment (local DB, a login per role) |
| `docs/qa/README.md` | browser-QA index: coverage, sweeps, pass plan |
| `docs/qa/FINDINGS.md` | every defect browser QA found, with its diagnosis and state |
| `docs/qa/NN-*.md` | per-module QA results, named to match `docs/modules/NN-*.md` |

## Skills

Task-specific guidance lives in `.claude/skills/`. Invoke the one that
matches:

| Skill | For |
|---|---|
| `smis-module` | implement/resume a numbered roadmap module end to end |
| `smis-backend` | NestJS controllers, services, repositories, DTOs, engines, wiring |
| `smis-frontend` | Next 16 pages, API clients, validations, shared components |
| `smis-database` | Prisma schema, hand-written migration SQL, verification |
| `smis-testing` | Jest unit + e2e suites, Vitest, and this project's real bugs |
| `smis-docs` | completion docs and the four living trackers |
| `smis-debug` | DI errors, flaky/hanging e2e, drift, 403s, envelope surprises |
| `smis-architecture` | where code belongs, cycle-free integration, design review |
| `smis-qa` | in-browser QA via Playwright MCP, and fixing what it finds |

## Ground rules

- **Controller → Service → Repository, one direction.** Services never
  touch Prisma; controllers never touch repositories.
- **Every business table carries `school_id`**; every query is scoped by it
  and excludes soft-deleted rows.
- **Attendance, marks and fees key on `enrollment_id`, never `student_id`.**
- Business arithmetic lives in dependency-free engines under
  `src/modules/<name>/calc/` and is golden-tested.
- New capabilities need a code in the permission registry; new knobs need a
  key in the settings registry. Both are append-only and test-enforced.
- Published artifacts are immutable — corrections are re-issues with an
  audit trail.
- **Do not commit or push.** The owner commits each module manually.

## Verify before claiming done

```bash
cd hexschool-backend  && npx tsc --noEmit && npx jest --silent
cd hexschool-frontend && npx tsc --noEmit && npx vitest run && npx next build

# e2e — needs Docker and the LOCAL database; .env points at Neon, so override it.
# Start services BY NAME: a bare `up -d` also starts the backend container,
# whose BullMQ worker steals jobs from the process under test.
cd hexschool-backend && docker compose up -d postgres redis minio mailpit
DATABASE_URL="postgresql://smis:smis@localhost:5433/smis" NODE_ENV=test \
  npx jest --config ./test/jest-e2e.json --forceExit

# browser suite — needs the QA seed and both servers up (see QA_RUNBOOK.md)
cd hexschool-frontend && npm run test:e2e
```

The e2e suite is where this project's real bugs have been found. Run it.

Baseline: **2422 backend unit / 666 frontend Vitest / 26 browser**. `hr.e2e-spec.ts`
has two known pre-existing failures — see finding F10 in `docs/qa/FINDINGS.md`.
