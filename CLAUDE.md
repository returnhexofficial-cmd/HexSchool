# HexSchool / SMIS

School Management Information System for Bangladeshi schools. Two repos in
this workspace, built module by module against a 32-module roadmap.
**15 modules complete.**

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

# e2e — needs Docker (postgres:5433 + redis) and the LOCAL database;
# .env points at Neon, so override it
cd hexschool-backend && docker compose up -d
DATABASE_URL="postgresql://smis:smis@localhost:5433/smis" NODE_ENV=test \
  npx jest --config ./test/jest-e2e.json --forceExit
```

The e2e suite is where this project's real bugs have been found. Run it.
