# Module 01 — Project Setup & Core Infrastructure · Completion Document

| | |
|---|---|
| **Module** | 01 — Project Setup & Core Infrastructure |
| **Completion date** | 2026-07-15 |
| **Actual effort** | 1 dev-day (est. was 4) |
| **Roadmap section** | `SMIS_DEVELOPMENT_ROADMAP.md` → Module 01 |

> **Repo naming note:** the repositories are `hexschool-backend` (NestJS 11) and
> `hexschool-frontend` (Next.js 16) — the product is branded HexSchool; "smis"
> is retained as the database/bucket name.

## Summary of Implemented Features

**Backend (`hexschool-backend`)**
- NestJS 11, strict TypeScript, ESLint + Prettier, Husky pre-commit (lint + typecheck + test).
- **TypeORM locked** as the ORM (enum + migration ergonomics with Nest DI) — rationale recorded in `PROJECT_CONTEXT.md` §16.
- `@nestjs/config` + Joi fail-fast env validation (`.env.example` committed).
- Global infrastructure: `ValidationPipe` (whitelist/forbidNonWhitelisted/transform), `AllExceptionsFilter` (error envelope incl. `VALIDATION_ERROR` details), `TransformResponseInterceptor` (`{ success, data, meta?, message? }` with meta-lifting and `@SkipEnvelope()` opt-out), nestjs-pino request logging with request-id correlation and secret redaction.
- `AppBaseEntity` / `SchoolScopedEntity` + `BaseRepository<T>` (CRUD, `paginate` with search/sort whitelists, soft-delete via `DeleteDateColumn`, `school_id` scoping, `withTransaction` unit-of-work, `withManager` escape hatch).
- Swagger at `/api/docs` (basic-auth-guarded in production).
- `@nestjs/throttler` global 100 req/min (override decorator available for auth routes in M02).
- Helmet, compression, CORS whitelist from env, `trust proxy`.
- BullMQ + Redis wired; demo `system` queue + processor; **Bull Board** at `/admin/queues` behind basic auth.
- `HealthModule` (terminus): DB, Redis (custom indicator), disk, memory. `VersionController` (`BUILD_SHA`/`BUILD_TIME`).
- `StorageModule`: S3 wrapper (upload / signed URL / delete) with bucket-per-purpose config, MinIO in dev.
- Migration + seed scripts (`migration:generate|run|revert`, `seed` — idempotent runner).
- GitHub Actions CI: lint → typecheck → unit tests → migrations → e2e → build → docker build.

**Frontend (`hexschool-frontend`)**
- Next.js 16 (App Router, Turbopack), strict TS, src/ layout, ESLint, Prettier, Husky.
- Tailwind v4 + **shadcn/ui** (vendored into `src/components/ui`, radix base, neutral palette, light/dark tokens), Inter + Noto Sans Bengali via `next/font` (`--font-sans` stack).
- Route groups scaffolded: `(public)` (home, maintenance), `(auth)` (login placeholder), `(admin)`, `(portal)`.
- Axios instance with **single-flight refresh interceptor** (queues concurrent 401s; `/auth/refresh` endpoint arrives in M02) + TanStack Query provider (retry 1, staleTime 30 s) + devtools.
- Shared components v1: `DataTable` (server-driven pagination/sort/search, CSV export, skeleton/empty/error states), `PageHeader`, `FormDialog` (RHF + Zod), `ConfirmDialog`, `EmptyState`, `ErrorState`, `Spinner`/`LoadingBlock`/`CardSkeleton`, `StatCard`.
- Global `error.tsx`, `global-error.tsx`, `not-found.tsx`, `/maintenance` page.
- Vitest + Testing Library; GitHub Actions CI (lint → typecheck → test → build).

**Dev environment**
- `docker-compose.yml` (in backend repo): postgres:16, redis:7, MinIO (+ bucket-init job), Mailpit, backend (dev target). All containers pinned to UTC.
- Multi-stage `Dockerfile` (deps → development → build → production, non-root runtime, BUILD_SHA/BUILD_TIME args).

## Database Changes
- Database `smis`; migration `1752537600000-BaseConventions` — enables `pgcrypto` and `citext` extensions. No business tables (by design).

## API Endpoints Added
```
GET /api/v1/health    (raw terminus shape via @SkipEnvelope; 503 when degraded)
GET /api/v1/version   (git sha, build time, env)
```
Plus non-API surfaces: `/api/docs` (Swagger), `/admin/queues` (Bull Board, basic auth).

## Frontend Pages Created
- `/` (public placeholder), `/login` (placeholder), `/admin` (placeholder), `/portal` (placeholder), `/maintenance`, global 404 + error boundaries.

## Components Created (new shared/reusable only)
- `DataTable`, `PageHeader`, `FormDialog`, `ConfirmDialog`, `EmptyState`, `ErrorState`, `Spinner`/`LoadingBlock`/`CardSkeleton`, `StatCard`, `QueryProvider`.
- Hooks/utils: `useDebounce`, `exportToCsv`, `bdPhoneSchema`, `passwordSchema`.

## Business Rules Implemented
- Fail-fast env validation (missing/malformed env ⇒ boot refusal).
- DB unreachable at boot ⇒ retries exhaust ⇒ non-zero exit (orchestrator restarts).
- Redis down ⇒ health reports degraded (503 with component detail); HTTP API stays up.
- Response/error envelopes standardized exactly as PROJECT_CONTEXT §7.

## Known Limitations
- Health disk probe is skipped on local **Windows** dev machines (`check-disk-space` shells out to `wmic`, removed in modern Windows 11). It runs on Linux (Docker/CI/prod) unchanged.
- Native PostgreSQL on the dev machine occupies port 5432 → compose maps postgres to host **5433** (`DATABASE_URL` in `.env.example` reflects this). In-network compose still uses 5432.
- CI workflows are authored but unverified against GitHub (no remote configured yet).
- "docker compose up from clean clone on Ubuntu" executed on Windows/Docker Desktop instead; Ubuntu run pending first deployment.
- shadcn's new registry replaced the `form` wrapper with `field.tsx`; `FormDialog` uses RHF's `FormProvider` directly.

## Future Improvements
- XLSX export for `DataTable` (CSV only for now) — arrives naturally with the report engine (M18).
- Request-scoped `school_id` injection into `BaseRepository` (currently explicit parameter) — revisit at M31.

## Breaking Changes
- None (first module).

## Migration Steps
1. `cd hexschool-backend && cp .env.example .env` (fill secrets) `&& docker compose up -d postgres redis minio minio-init mailpit`
2. `npm ci && npm run migration:run && npm run seed`
3. `npm run start:dev` → API at `http://localhost:4000`, Swagger at `/api/docs`.
4. `cd hexschool-frontend && cp .env.example .env.local && npm ci && npm run dev` → `http://localhost:3000`.

## Environment Variable Changes
| Variable | New/Changed | Purpose |
|---|---|---|
| `DATABASE_URL`, `REDIS_URL` | New | Postgres / Redis connections |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | New | Validated now, consumed in M02 |
| `S3_ENDPOINT/REGION/ACCESS_KEY/SECRET_KEY/BUCKET_DEFAULT/FORCE_PATH_STYLE` | New | Object storage |
| `SMTP_HOST/PORT/USER/PASS/FROM` | New | Mail (Mailpit in dev) |
| `CORS_ORIGINS` | New | Comma-separated origin whitelist |
| `SETTINGS_ENCRYPTION_KEY` | New | 32-char AES-256 key (consumed in M04) |
| `RATE_LIMIT_TTL_MS`, `RATE_LIMIT_MAX` | New | Global throttle |
| `ADMIN_DASH_USER`, `ADMIN_DASH_PASS` | New | Swagger (prod) + Bull Board basic auth |
| `BUILD_SHA`, `BUILD_TIME` | New | `/version` metadata, injected by CI/Docker |
| `NEXT_PUBLIC_API_URL` (frontend) | New | API base URL |

## Manual Testing Results
| Scenario | Result | Notes |
|---|---|---|
| `docker compose up` infra from clean state | ✅ | postgres/redis/minio(+bucket)/mailpit healthy |
| `migration:run` + `seed` | ✅ | Extensions created; seed runner reports empty registry |
| Backend unit tests (11) | ✅ | Envelope interceptor + exception filter shapes |
| Backend e2e (3) against live infra | ✅ | health 200 w/ component statuses; version enveloped; 404 envelope |
| Live boot smoke test | ✅ | `/api/v1/health` 200, `/api/v1/version` OK, Swagger 200, Bull Board 401→200 with creds |
| Frontend tests (9) | ✅ | DataTable server pagination + axios single-flight refresh (mocked) |
| Frontend production build | ✅ | 6 routes, static prerender clean |

## Remaining TODOs
- [ ] Push both repos to GitHub and confirm CI runs green.
- [ ] Run `docker compose up` from a clean clone on an Ubuntu host.

## Links to Related Modules
- Depends on: — (first module)
- Unlocks / hooks completed for: Module 02 (JWT env slots, throttler override point, `(auth)` route group, axios refresh interceptor awaiting `/auth/refresh`)
- `PROJECT_CONTEXT.md` sections updated: §1, §14, §16, §18
