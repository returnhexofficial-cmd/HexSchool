# PROJECT_CONTEXT.md — SMIS Living Project Memory

> Updated whenever a module changes the architecture or introduces reusable patterns.
> **Last updated:** 2026-07-17 (Module 06 complete — full academic structure live; MasterCrud frontend generic; serial e2e)

---

## 1. Current Architecture

- Two repos: `hexschool-frontend` (Next.js 16, TS, App Router, Turbopack), `hexschool-backend` (NestJS 11, TS). (Product branded HexSchool; DB/bucket keep the `smis` name.)
- **ORM: Prisma 7** (owner decision in M02, replacing TypeORM). Schema in `prisma/schema.prisma`, CLI config in `prisma.config.ts`, runtime via `@prisma/adapter-pg`; migrations: `npx prisma migrate dev|deploy`. Partial indexes/CHECKs are hand-written into migration SQL (`--create-only`, then edit).
- PostgreSQL 16+ single database (team dev DB currently on Neon; compose postgres remains for local use); Redis for cache + BullMQ queues; S3-compatible object storage (MinIO in dev).
- Frontend global state: **Redux Toolkit** (owner decision in M02; roadmap originally said Zustand) — per-tab store via `StoreProvider`, typed hooks in `src/lib/store/hooks.ts`. Server state stays in TanStack Query.
- Next 16 note: middleware is `src/proxy.ts` (renamed from middleware.ts) — optimistic route guards via the non-sensitive `hs_session` hint cookie; real enforcement is always API-side.
- REST API under `/api/v1` (port 4000), Swagger at `/api/docs` (basic-auth in prod); Bull Board at `/admin/queues` (basic-auth always). Frontend dev on port 3000.
- Dev infra via `hexschool-backend/docker-compose.yml`: postgres:16 (host port **5433** — 5432 is taken by a native install on the dev machine), redis:7, MinIO (9000/9001), Mailpit (1025/8025).
- Single-school deployment now; **every business table carries `school_id`** so Module 31 can activate multi-tenancy without schema surgery.
- Docker Compose for dev (postgres, redis, minio, mailpit, backend); Nginx + Docker on Ubuntu for prod (formalized in Module 30).

## 2. Folder Structure

**Backend** — `src/modules/<name>/{entities,dto,controllers,services,repositories,guards,policies,events,jobs}` plus `src/common/{filters,interceptors,pipes,decorators,utils}` and `src/config`.

**Frontend** — route groups: `src/app/(public)` website, `(auth)` login flows, `(admin)` panel, `(portal)` student/parent/teacher, `(platform)` reserved for Module 31. Shared code in `src/components/{ui,shared}`, `src/lib/{api,validations,utils,hooks}`.

## 3. Naming Conventions

- DB: snake_case, plural tables, UUID PKs (`gen_random_uuid()`), constraint prefixes `fk_/uq_/idx_/chk_`.
- API: kebab-case plural resources (`/fee-invoices`), camelCase JSON fields.
- Code: PascalCase classes/components, camelCase functions/vars, TS enums mirroring PG enums.
- Document number patterns (all sequence-table backed, per school, gap-free in transaction): `{SCHOOL_CODE}-S-{YY}{SEQ4}` staff, `{SCHOOL_CODE}-{YEAR}{SEQ5}` students, `ADM-{YY}-{SEQ6}` applications, `INV-{YY}{MM}-{SEQ6}` invoices, `DV/CV/JV/CN-{YY}-{SEQ}` vouchers, `TC-{YY}-{SEQ4}` certificates (per type).

## 4. Coding Standards

- Strict TypeScript both repos; ESLint + Prettier + Husky (lint, typecheck, test pre-commit).
- No `any` without justification comment; no raw SQL outside repositories; no unscoped (missing `school_id`) queries.
- Backend business rules live in services (controllers thin); pure calculation engines (results, payroll) are dependency-free and golden-tested.
- **Repository pattern:** all data access goes through per-entity repository classes extending `BaseRepository` (generic CRUD, pagination, soft-delete + `school_id` scoping, `withTransaction`). Services never touch the ORM/QueryBuilder directly; controllers never touch repositories. Flow is strictly Controller → Service → Repository.

## 5. Shared Utilities & Services (backend)

| Service | Provides | Since |
|---|---|---|
| `SettingsService` (exported by `SchoolModule`) | registry-declared keys per group (`settings.registry.ts`); `getValue<T>()` typed getters w/ defaults, Redis 60 s cache + bust-on-write, AES-256-GCM secrets at rest, `__SECRET__` masking over the API | M04 |
| `RedisCacheService` (global `RedisModule`) | generic best-effort JSON cache (get/set/del, Redis-down ⇒ miss/no-op) | M04 |
| Grade-range validators (`grading/grade-range.validator.ts`) | pure overlap + 0–100 coverage checks (frontend mirror in `lib/utils/grade-ranges.ts`) | M04 |
| `StorageModule` | S3 upload/signed-url/delete | M01 |
| `BaseRepository<T>` | repository-pattern base (Prisma edition since M02): CRUD, pagination, soft-delete + `school_id` scoping, `withTransaction` | M01→02 |
| `JwtAuthGuard` (global) + `@Public()` + `@CurrentUser()` | every route authenticated unless explicitly public | M02 |
| `PermissionsGuard` (global) + `@RequirePermissions` (AND) / `@RequireAnyPermission` (OR) | RBAC on any decorated route; Super Admin bypass | M03 |
| `PermissionsService` (exported by `RbacModule`) | effective permission codes per user, Redis-cached 5 min, invalidated on role change | M03 |
| Permission registry (`rbac/registry/permission.registry.ts`) | source of truth for codes; each module appends; seeder syncs (orphan-flags removed codes) | M03 |
| `AuditContextService` (global `AuditModule`, AsyncLocalStorage) | services attach real old/new diffs + attribution to the in-flight request's audit entry | M03 |
| `PasswordService` / `TokenService` / `OtpService` | argon2id + policy, JWT/reset/refresh tokens, hashed OTPs | M02 |
| `notifications` BullMQ queue | email (SMTP) + SMS (log-only until M17) job contract | M02 |
| `NotificationService.send()` | ALL SMS/email/in-app — no direct gateway calls anywhere | M17 |
| Sequence/ID generator | gap-free document numbers | M07 |
| `CalendarService.isHoliday(schoolId, date, appliesTo?)` (exported by `AcademicModule`) | weekly off-days (M04 setting `general.weekly_holidays`) + holiday ranges → `{holiday, reason, title}`; consumed by Attendance (M12) / Payroll (M21) | M05 |
| `SessionsService` (exported by `AcademicModule`) | current-session resolution + session rules for session-scoped modules | M05 |
| `parseDate` (`academic/calendar/date.util.ts`) | strict YYYY-MM-DD parsing (regex shape ≠ valid date — always parse through this) | M05 |
| `buildIcs` (`academic/calendar/ics.util.ts`) | dependency-free RFC 5545 writer (all-day events) | M05 |
| `SectionsRepository` (exported by `AcademicModule`) | roster-side section queries for enrollment (M11) | M06 |
| `StructureCloneService` | yearly rollover: additive/idempotent clone of sections + curriculum maps with preview | M06 |
| `getSectionStudents()` / `getStudentCurrentEnrollment()` | canonical roster queries | M11 |
| Clearance service | aggregated dues/library/hostel clearance | M16→27 |
| `PaymentGatewayService` + adapters (SSLCommerz/bKash/Nagad) | init/verify/reconcile | M16 |
| Report engine registry | param-validated async report runs | M18→29 |
| `AuditInterceptor` (global) | immutable audit_logs row per successful mutation: context-hook diffs → `@Audit()` meta → inference; secret redaction; `@SkipAudit()` for machine noise | M03 |

## 6. Shared Components (frontend)

UI library: **shadcn/ui** (Tailwind-based, components vendored into `src/components/ui`). Shared app components built on it: `DataTable` (server pagination/sort/filter/export), `FormDialog`, `ConfirmDialog`, `PageHeader`, `StatCard`, `EmptyState`, `ErrorState`, `Can` (permission gate), `SessionSwitcher` (M05), `JsonDiff` (M03), **`MasterCrud`** (M06 — config-driven DataTable+FormDialog CRUD page; use it for every future master entity), skeletons. Forms = React Hook Form + Zod (schemas in `src/lib/validations`, mirroring backend DTOs).

**Session-switcher convention (live since M05):** the admin header hosts `SessionSwitcher`; selection lives in the `academicSession` Redux slice, persisted per user in localStorage (`hs_academic_session:{userId}`), defaulting to the school's `is_current` session. Every session-scoped page/query (M06 sections, M11 enrollment, M12 attendance, …) MUST read `useAcademicSession().selected` — never fetch "current" independently.

## 7. API Conventions

- Envelope: `{ success, data, meta?, message? }`; errors `{ success:false, error:{ code, message, details? } }`.
- Pagination `?page&limit&sort=field:asc&search`; max limit 100.
- Mutations audited; `@Public()` routes are the explicit exception list; portal routes additionally pass `OwnershipGuard`.

## 8. Entity Relationship Spine

`schools` ← everything. `users` ←1:1→ `staff_profiles|teachers|students|guardians` (role-specific profile tables). `students` —M:N→ `guardians`. `enrollments` = student × session × class/section (all attendance/marks/fees hang off `enrollment_id`, NOT `student_id`). **Live since M06:** `classes`/`subjects`/`departments`/`shifts`/`groups` are session-independent masters; `sections` = class × session (identity unique incl. NULL-safe shift via COALESCE index; `class_teacher_id` FK deferred to M08); `class_subjects` defines curriculum per class × session (× optional group). Exams → `exam_subjects` → `marks` → `results`. `invoices`→`payments`. Full graph grows per module; see each module §3.

## 9. Authentication Flow

**Live since M02.** Login (email/phone + password, argon2id) → access JWT 15 min (in memory) + rotating opaque refresh 7/30 d (httpOnly `hs_refresh` cookie, path `/api/v1/auth`) → rotation with reuse-detection (reuse outside 5 s two-tab grace ⇒ revoke ALL sessions + SMS alert; rotation never extends the session window). OTP (6-digit, hashed, 5 min, 3 attempts, 60 s resend) for reset/verification; verify-otp mints a 10-min reset token. Lockout 5 fails/15 min (423). Generic errors everywhere (no account enumeration). Frontend: axios single-flight refresh interceptor → `/auth/refresh`; `proxy.ts` guards route groups via the `hs_session` hint cookie; forced-change interstitial when `must_change_password`. Bootstrap Super Admin comes from the seed (`admin@hexschool.local`).

## 10. Authorization Flow

**Live since M03.** RBAC: permission codes registry (TS code = source of truth, idempotently synced to `permissions`; removed codes orphan-flagged and denied) → roles (11 system roles seeded per school, non-deletable/non-renamable, core sets locked extend-only) → users (`user_roles`; every user keeps ≥1 role, last `super-admin` holder protected). `PermissionsGuard` + `@RequirePermissions()` (AND) / `@RequireAnyPermission()` (OR); permissions cached in Redis 5 min (`perm:{userId}`), invalidated on role change, DB fallback if Redis is down; Super Admin (`user_type`) bypasses. **Guard chain is pinned in `AppModule` providers (Throttler → JwtAuthGuard → PermissionsGuard) — global-guard order follows provider registration order, so never register APP_GUARDs from feature modules.** Role edits use optimistic concurrency (`expectedUpdatedAt` → 409). Frontend `<Can>`/`usePermissions()` + `ADMIN_MENU` permission-per-item config (UI gating only; API is authoritative). Portals add ownership checks (student=self, parent=children via `student_guardians`).

**Audit (M03):** every successful mutating request writes an immutable `audit_logs` row via the global `AuditInterceptor`. New modules: set precise diffs from services via `AuditContextService.set({entityType, entityId, oldValues, newValues})`; use `@Audit({action})` for verb overrides and `@SkipAudit()` only for machine noise. `action` is VARCHAR — extend `AUDIT_ACTIONS` (both repos) instead of migrating an enum.

## 11. Global Business Rules

- One `is_current` academic session (DB partial unique index since M05); sessions never overlap in dates; COMPLETED sessions read-only for entry flows (consumers enforce from M12/M15). Activate rolls the demoted ACTIVE session to COMPLETED.
- One enrollment per student per session; roll unique per section.
- Published results/receipts/vouchers/certificates are immutable — corrections via reversal/reissue with audit trail.
- All money NUMERIC(12,2) BDT; every monetary override needs permission + reason.
- Soft delete everywhere except append-only logs (audit, ledger, login activity, notifications).
- Timezone: store UTC, display Asia/Dhaka; weekly holiday configurable (default Friday).

## 12. Common Validation Rules

BD phone `^01[3-9]\d{8}$` (normalized). NID 10/13/17 digits. Birth cert 17 digits. Password ≥ 8 with upper/lower/digit. Uploads whitelisted by type/size per feature. Bangla SMS = 70-char UCS-2 segments (cost calc).

## 13. Reusable Hooks (frontend)

`useAppDispatch`/`useAppSelector`/`useAuth` (typed Redux hooks, M02), `useDebounce`, `usePermissions` (`can`/`canAny`/`isSuperAdmin`, M03), `useAcademicSession` (session switcher: `sessions`/`selected`/`current`/`select`, M05); planned: `useDataTable`, `useConfirm`. (Grows per module.)

## 14. Environment Variables

See `.env.example` in each repo. Core: `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `S3_*` (+ optional `S3_BUCKET_BRANDING` since M04), `SMTP_*`, `SETTINGS_ENCRYPTION_KEY` (32 chars — consumed since M04; rotating it orphans stored secrets), `CORS_ORIGINS`, optional `SEED_SUPER_ADMIN_PASSWORD`; frontend `NEXT_PUBLIC_API_URL`. Gateway credentials (SMS/SSLCommerz/bKash/Nagad) live in **encrypted school settings**, not env (M04 decision); `RECAPTCHA_*` arrives with M10. Joi-validated at boot.

## 15. Third-Party Integrations

SSLCommerz / bKash / Nagad (adapter pattern, server-side verification mandatory), BD SMS gateway (configurable HTTP adapter, DLR webhook), SMTP, Google reCAPTCHA, Google Maps embed, S3.

## 16. Technical Decisions & Rationale

| Decision | Rationale | Module |
|---|---|---|
| **Prisma 7 over TypeORM** (reverses M01) | owner decision; generated type-safety, prisma migrate workflow; TypeORM fully removed | M02 |
| Redux Toolkit over Zustand for frontend global state | owner decision; RTK slices + typed hooks, per-tab store for App Router | M02 |
| Refresh tokens opaque (not JWT) | revocability needs a DB row anyway; SHA-256 hash stored, plaintext only in cookie | M02 |
| Extra `TOKEN_REUSE` login-event enum value | theft response is distinct from lock in the audit trail | M02 |
| `DEFAULT_SCHOOL_ID` constant until M04 | `schools` table doesn't exist yet; M04 must create the row with this exact id — **done: the M04 migration inserts it before adding the users/roles FKs** | M02→04 |
| Settings keys declared in a TS registry (like permission codes) | typed/validated writes, per-key secrecy, no migration to add keys within a group | M04 |
| School logo stored as S3 key, URL signed on every read | signed URLs expire (1 h); the key is the stable reference | M04 |
| Settings secrets envelope `iv.tag.cipher` (AES-256-GCM) | GCM authenticates — tampered rows fail closed to registry defaults; key rotation = re-enter secrets | M04 |
| Health disk probe Linux-only | `check-disk-space` needs `wmic`, gone on modern Windows 11; prod is Linux | M01 |
| shadcn `field.tsx` instead of legacy `form.tsx` | new shadcn registry deprecated the form wrapper; `FormDialog` uses RHF `FormProvider` directly | M01 |
| Repository pattern over Active Record / direct ORM in services | data access isolated from business logic; swappable/testable (mock repos in unit tests); single place to enforce soft-delete + tenant scoping | M01 (owner decision) |
| shadcn/ui as component library | vendored components (full control, no lockstep upgrades), Tailwind-native, RHF/Zod-friendly | M01 (owner decision) |
| `school_id` on all tables from day one | Module 31 SaaS without rewrite | M01 |
| Refresh in httpOnly cookie (web) | XSS-resistant; body-based reserved for mobile | M02 |
| Permissions NOT in JWT | instant revocation via Redis cache (5 min TTL + explicit invalidation; DB fallback when Redis down) | M03 |
| All APP_GUARDs declared in AppModule (JwtAuthGuard moved out of AuthModule) | global-guard execution = provider registration order; root registers before imports, so cross-module ordering is only guaranteed in one providers array | M03 |
| `audit_logs.action` VARCHAR, id BIGSERIAL, no FK to users | verbs grow per module without enum migrations; table stays partition-ready for M30 retention | M03 |
| Audit writes fire-and-forget | auditing must never delay/fail the mutation; failures logged | M03 |
| `RbacModule` re-provides `UsersRepository` instead of importing AuthModule | AuthModule imports RbacModule for /auth/me — keeps the module graph acyclic (repos are stateless) | M03 |
| Calendar dates as `@db.Date` + YYYY-MM-DD strings end-to-end | no timezone ambiguity; strict `parseDate` round-trip catches regex-shape-valid but impossible dates (`2026-13-99` reached Prisma as Invalid Date before) | M05 |
| Holidays hard-deleted, events soft-deleted | per roadmap spec — cancelling a holiday removes it (audit trail keeps history); events keep the standard business-entity lifecycle | M05 |
| Weekly off-days = M04 setting, not holiday rows | one source of truth, per-school configurable; `isHoliday` merges setting + ranges | M05 |
| `src/modules/academic/` namespace shared by M05+M06 | sessions/calendar and classes/sections/subjects are one domain; avoids `academic-*` module sprawl | M05 |
| COALESCE unique indexes for nullable identity columns | Postgres treats NULLs as distinct — `uq_sections_identity`/`uq_class_subjects_identity` map NULL shift/group to the nil UUID inside the index | M06 |
| `<entity>.manage` permission granularity for structure masters | no real-world role splits create vs delete for a shift/department; reads share one `structure.view` | M06 |
| Prisma model `SchoolClass` for table `classes` | `class` is a TS keyword in generated client code | M06 |
| e2e suites run serially (`maxWorkers: 1` in jest-e2e.json) | six suites share ONE dev DB/Redis/Mailpit — parallel workers caused cross-suite flakes | M06 |
| Grading snapshot copied into results | grade-system edits never mutate published results | M04/M15 |
| Attendance/marks/fees keyed on `enrollment_id` | correct history across transfers/promotions | M11 |
| Gateway SUCCESS only after server-side validate | redirect params are forgeable | M16 |
| In-process events now, BullMQ for heavy work | simple first, queue-swap-ready | M01 |

## 17. Assumptions

- Single school until Module 31; Bangla content via dual fields (`name_bn`), full i18n backlogged.
- NCTB grading default; configurable per school.
- Internet-connected deployment (no offline mode); parents primarily on mobile browsers.
- BD income tax slabs simplified/configurable, not a full tax engine.

## 18. Outstanding Technical Debt

- **M01:** CI workflows authored but never executed (no GitHub remotes yet) — verify on first push (backend CI now runs `prisma migrate deploy`).
- **M01:** clean-clone `docker compose up` verified on Windows/Docker Desktop only; Ubuntu run pending.
- **M01:** `DataTable` export is CSV-only; XLSX arrives with the report engine (M18).
- **M01:** `BaseRepository` school scoping is an explicit parameter; request-scoped tenant injection deferred to M31.
- **M02:** `users.school_id` has no FK until M04 creates `schools` (must use `DEFAULT_SCHOOL_ID` for the first school row).
- **M02:** SMS is log-only until M17; OTP delivery to phone-only users not yet real.
- **M02:** throttling disabled entirely under `NODE_ENV=test`; e2e never exercises rate limits.
- **M02:** dev `.env` points `DATABASE_URL` at Neon while docker-compose still ships a local postgres — align when deployment story firms up (M30).
- **M03:** audit fallback `newValues` is the redacted request body — services that mutate meaningful state must call `AuditContextService.set()` for real entity diffs (RolesService/AuthService are the reference implementations).
- **M03:** user role assignment has API only (`GET/PUT /users/:id/roles`); the UI slot lives in the Module 07 user detail page.
- **M03:** `audit_logs` monthly partitioning + retention deferred to M30. ~~users/roles FKs deferred~~ — added in M04.
- **M03→04:** `PermissionsCacheService` still owns its own Redis client — fold into the generic `RedisCacheService` during a quiet module.
- **M04:** gateway configs have no persisted `verified_at` state (test endpoints report pass/fail only); revisit with M16/M17.
- **M04:** in-browser logo-upload click-through pending (API/resize/signed-URL layers individually verified).
- **M06:** `sections.class_teacher_id` is a bare UUID column — M08 must add the `teachers` FK.
- **M06:** "subject removal blocked once marks exist" guard slot in ClassSubjectsService awaits the M15 marks table.
- **M06:** one e2e suite leaves an open handle at teardown (`--forceExit` in use); chase with `--detectOpenHandles`.
