# PROJECT_CONTEXT.md — SMIS Living Project Memory

> Updated whenever a module changes the architecture or introduces reusable patterns.
> **Last updated:** 2026-07-15 (Module 02 complete — auth live; ORM switched to **Prisma 7**, frontend state to **Redux Toolkit**)

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
| `SettingsService` | typed, cached, encrypted settings per group | M04 |
| `StorageModule` | S3 upload/signed-url/delete | M01 |
| `BaseRepository<T>` | repository-pattern base (Prisma edition since M02): CRUD, pagination, soft-delete + `school_id` scoping, `withTransaction` | M01→02 |
| `JwtAuthGuard` (global) + `@Public()` + `@CurrentUser()` | every route authenticated unless explicitly public | M02 |
| `PasswordService` / `TokenService` / `OtpService` | argon2id + policy, JWT/reset/refresh tokens, hashed OTPs | M02 |
| `notifications` BullMQ queue | email (SMTP) + SMS (log-only until M17) job contract | M02 |
| `NotificationService.send()` | ALL SMS/email/in-app — no direct gateway calls anywhere | M17 |
| Sequence/ID generator | gap-free document numbers | M07 |
| `isHoliday(date)` | holiday awareness for attendance/payroll | M05 |
| `getSectionStudents()` / `getStudentCurrentEnrollment()` | canonical roster queries | M11 |
| Clearance service | aggregated dues/library/hostel clearance | M16→27 |
| `PaymentGatewayService` + adapters (SSLCommerz/bKash/Nagad) | init/verify/reconcile | M16 |
| Report engine registry | param-validated async report runs | M18→29 |
| Audit interceptor | old/new diff on every mutation | M03 |

## 6. Shared Components (frontend)

UI library: **shadcn/ui** (Tailwind-based, components vendored into `src/components/ui`). Shared app components built on it: `DataTable` (server pagination/sort/filter/export), `FormDialog`, `ConfirmDialog`, `PageHeader`, `StatCard`, `EmptyState`, `ErrorState`, `Can` (permission gate), skeletons. Forms = React Hook Form + Zod (schemas in `src/lib/validations`, mirroring backend DTOs). Session switcher in admin header scopes all session-bound pages.

## 7. API Conventions

- Envelope: `{ success, data, meta?, message? }`; errors `{ success:false, error:{ code, message, details? } }`.
- Pagination `?page&limit&sort=field:asc&search`; max limit 100.
- Mutations audited; `@Public()` routes are the explicit exception list; portal routes additionally pass `OwnershipGuard`.

## 8. Entity Relationship Spine

`schools` ← everything. `users` ←1:1→ `staff_profiles|teachers|students|guardians` (role-specific profile tables). `students` —M:N→ `guardians`. `enrollments` = student × session × class/section (all attendance/marks/fees hang off `enrollment_id`, NOT `student_id`). `class_subjects` defines curriculum per session. Exams → `exam_subjects` → `marks` → `results`. `invoices`→`payments`. Full graph grows per module; see each module §3.

## 9. Authentication Flow

**Live since M02.** Login (email/phone + password, argon2id) → access JWT 15 min (in memory) + rotating opaque refresh 7/30 d (httpOnly `hs_refresh` cookie, path `/api/v1/auth`) → rotation with reuse-detection (reuse outside 5 s two-tab grace ⇒ revoke ALL sessions + SMS alert; rotation never extends the session window). OTP (6-digit, hashed, 5 min, 3 attempts, 60 s resend) for reset/verification; verify-otp mints a 10-min reset token. Lockout 5 fails/15 min (423). Generic errors everywhere (no account enumeration). Frontend: axios single-flight refresh interceptor → `/auth/refresh`; `proxy.ts` guards route groups via the `hs_session` hint cookie; forced-change interstitial when `must_change_password`. Bootstrap Super Admin comes from the seed (`admin@hexschool.local`).

## 10. Authorization Flow

RBAC: permission codes registry (code = source of truth) → roles → users. `PermissionsGuard` + `@RequirePermissions()`; permissions cached in Redis 5 min, invalidated on role change; Super Admin bypass. Frontend `<Can>` + menu permission config. Portals add ownership checks (student=self, parent=children via `student_guardians`).

## 11. Global Business Rules

- One `is_current` academic session; COMPLETED sessions read-only.
- One enrollment per student per session; roll unique per section.
- Published results/receipts/vouchers/certificates are immutable — corrections via reversal/reissue with audit trail.
- All money NUMERIC(12,2) BDT; every monetary override needs permission + reason.
- Soft delete everywhere except append-only logs (audit, ledger, login activity, notifications).
- Timezone: store UTC, display Asia/Dhaka; weekly holiday configurable (default Friday).

## 12. Common Validation Rules

BD phone `^01[3-9]\d{8}$` (normalized). NID 10/13/17 digits. Birth cert 17 digits. Password ≥ 8 with upper/lower/digit. Uploads whitelisted by type/size per feature. Bangla SMS = 70-char UCS-2 segments (cost calc).

## 13. Reusable Hooks (frontend)

`useAppDispatch`/`useAppSelector`/`useAuth` (typed Redux hooks, M02), `useDebounce`; planned: `usePermissions`, `useSession` (academic session switcher), `useDataTable`, `useConfirm`. (Grows per module.)

## 14. Environment Variables

See `.env.example` in each repo. Core: `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `S3_*`, `SMTP_*`, `SMS_GATEWAY_*`, `SSLCOMMERZ_*`, `BKASH_*`, `NAGAD_*`, `RECAPTCHA_*`, `SETTINGS_ENCRYPTION_KEY`, `CORS_ORIGINS`, optional `SEED_SUPER_ADMIN_PASSWORD`; frontend `NEXT_PUBLIC_API_URL`. Joi-validated at boot.

## 15. Third-Party Integrations

SSLCommerz / bKash / Nagad (adapter pattern, server-side verification mandatory), BD SMS gateway (configurable HTTP adapter, DLR webhook), SMTP, Google reCAPTCHA, Google Maps embed, S3.

## 16. Technical Decisions & Rationale

| Decision | Rationale | Module |
|---|---|---|
| **Prisma 7 over TypeORM** (reverses M01) | owner decision; generated type-safety, prisma migrate workflow; TypeORM fully removed | M02 |
| Redux Toolkit over Zustand for frontend global state | owner decision; RTK slices + typed hooks, per-tab store for App Router | M02 |
| Refresh tokens opaque (not JWT) | revocability needs a DB row anyway; SHA-256 hash stored, plaintext only in cookie | M02 |
| Extra `TOKEN_REUSE` login-event enum value | theft response is distinct from lock in the audit trail | M02 |
| `DEFAULT_SCHOOL_ID` constant until M04 | `schools` table doesn't exist yet; M04 must create the row with this exact id | M02 |
| Health disk probe Linux-only | `check-disk-space` needs `wmic`, gone on modern Windows 11; prod is Linux | M01 |
| shadcn `field.tsx` instead of legacy `form.tsx` | new shadcn registry deprecated the form wrapper; `FormDialog` uses RHF `FormProvider` directly | M01 |
| Repository pattern over Active Record / direct ORM in services | data access isolated from business logic; swappable/testable (mock repos in unit tests); single place to enforce soft-delete + tenant scoping | M01 (owner decision) |
| shadcn/ui as component library | vendored components (full control, no lockstep upgrades), Tailwind-native, RHF/Zod-friendly | M01 (owner decision) |
| `school_id` on all tables from day one | Module 31 SaaS without rewrite | M01 |
| Refresh in httpOnly cookie (web) | XSS-resistant; body-based reserved for mobile | M02 |
| Permissions NOT in JWT | instant revocation via Redis cache | M03 |
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
