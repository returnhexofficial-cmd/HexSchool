# SMIS Development Roadmap

**School Management Information System — Master Development Document**
Target market: Bangladeshi educational institutions (Primary, High School, Kindergarten, English Version/Medium, Madrasa, Vocational, Private, Semi-Government)

| | |
|---|---|
| Frontend | Next.js (latest, TypeScript, App Router) — repo: `smis-frontend` |
| Backend | NestJS (latest, TypeScript) — repo: `smis-backend` |
| Database | PostgreSQL 16+ with **Prisma 7** (TypeORM was chosen in Module 01, reversed by owner decision in Module 02 — see PROJECT_CONTEXT §16) |
| Auth | JWT Access + Refresh Token, RBAC |
| Storage | S3-compatible (MinIO locally, any S3 provider in prod) |
| Payments | SSLCommerz, bKash, Nagad (Rocket later) |
| Notifications | SMS (BD gateways: e.g. SSL Wireless / BulkSMSBD / Alpha SMS) + Email (SMTP) |
| Deployment | Docker + Nginx + Ubuntu |
| API Style | REST, versioned (`/api/v1`), documented with Swagger |

---

## How To Use This Document

1. Modules are implemented **strictly in order** unless `MODULE_DEPENDENCIES.md` permits parallelism.
2. When the instruction **"Complete the next module"** is given:
   - Read `PROJECT_PROGRESS.md` → find the next incomplete module.
   - Read `PROJECT_CONTEXT.md` → follow all established conventions.
   - Implement the module exactly as specified below.
   - Create `docs/modules/NN-module-name.md` (completion document).
   - Update `PROJECT_PROGRESS.md`, `PROJECT_CONTEXT.md` (if architecture changed), and `MODULE_DEPENDENCIES.md` (if relationships changed).
   - Tick the module's Completion Checklist here.
3. Every module must be **production-quality**: validated, tested, documented, permission-guarded, and consistent with prior modules.

---

## Global Conventions (apply to EVERY module — do not restate per module)

### Database (all tables)
- Primary key: `id UUID DEFAULT gen_random_uuid()`.
- Audit fields: `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`, `created_by UUID NULL`, `updated_by UUID NULL`.
- Soft delete: `deleted_at TIMESTAMPTZ NULL` on all business entities (never on join/log tables unless stated). All default queries exclude soft-deleted rows.
- Multi-school readiness: every business table carries `school_id UUID NOT NULL REFERENCES schools(id)` from day one, even while running single-school. All unique constraints are **scoped by `school_id`**.
- Naming: snake_case tables/columns, plural table names, `fk_`, `uq_`, `idx_`, `chk_` prefixes for constraints/indexes.
- Money: `NUMERIC(12,2)`, currency BDT assumed; never floats.
- Enums: PostgreSQL native enums, mirrored as TypeScript enums in a shared `@smis/constants` location on both repos.
- All schema changes go through migrations. Never `synchronize: true` outside local dev.

### Backend (NestJS)
- Module layout: `src/modules/<name>/{entities,dto,controllers,services,repositories,guards,policies,events,jobs}`.
- **Repository pattern (mandatory):** every entity gets a repository class (`src/modules/<name>/repositories/<entity>.repository.ts`) extending a shared `BaseRepository` (generic CRUD, pagination, soft-delete scoping, `school_id` scoping). Services contain business logic ONLY and never touch the ORM/EntityManager/QueryBuilder directly — all data access (queries, transactions via a unit-of-work helper, raw SQL) lives in repositories. Controllers → Services → Repositories, strictly one direction.
- DTOs use `class-validator` + `class-transformer`; every controller uses global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
- Standard response envelope: `{ success, data, meta?, message? }`; standard error envelope from a global exception filter: `{ success: false, error: { code, message, details? } }`.
- Pagination: `?page=1&limit=20&sort=field:asc&search=` → response `meta: { page, limit, total, totalPages }`. Max limit 100.
- Auth: `JwtAuthGuard` global; `@Public()` decorator for open routes; `PermissionsGuard` + `@RequirePermissions('student.create')` for authorization.
- Every mutating endpoint writes an audit log entry (Module 03 provides the interceptor).
- Events via `@nestjs/event-emitter` (in-process now, swap-friendly for a queue later). Heavy work (SMS, email, PDF) goes through BullMQ + Redis jobs.
- API paths: kebab-case plural resources — `GET /api/v1/students`, `POST /api/v1/fee-invoices`.

### Frontend (Next.js)
- App Router, all pages under `src/app/(admin)/...` for the panel, `src/app/(public)/...` for the website, `src/app/(portal)/...` for student/parent/teacher portals.
- Data: TanStack Query for all server state; Axios instance with interceptors (attach access token, auto-refresh on 401, redirect to login on refresh failure).
- Forms: React Hook Form + Zod schemas (Zod schemas mirror backend DTOs; keep in `src/lib/validations/`).
- UI kit: **shadcn/ui** (decided) on Tailwind + shared components: `DataTable` (server pagination/sort/filter/export), `FormDialog`, `ConfirmDialog`, `PageHeader`, `StatCard`, `EmptyState`, `ErrorState`, `Can` (permission gate).
- Every list page ships with: search, filters, pagination, sorting, column export (CSV/XLSX), loading skeleton, empty state, error state.
- Role-based UI: menu items and action buttons wrapped in `<Can permission="...">`; routes guarded in middleware + layout-level checks.
- All dates displayed in `Asia/Dhaka`; stored UTC.

### Testing (every module)
- Backend: unit tests for services (business rules), e2e tests for controllers (happy path + auth + validation failures).
- Frontend: component tests for forms (validation) and critical flows.
- Manual QA checklist executed and recorded in the module completion doc.

---

## Module Index

**Phase 1 — MVP (Modules 01–18)**

| # | Module | Status |
|---|--------|--------|
| 01 | Project Setup & Core Infrastructure | ☑ |
| 02 | Authentication | ☑ |
| 03 | Authorization, Roles & Audit Logging | ☑ |
| 04 | School Setup & Settings | ☑ |
| 05 | Academic Session & Calendar | ☑ |
| 06 | Academic Structure (Class, Section, Group, Shift, Subject, Department) | ☑ |
| 07 | Staff & User Management | ☑ |
| 08 | Teacher Management | ☑ |
| 09 | Student & Guardian Management | ☑ |
| 10 | Admission Management | ☑ |
| 11 | Enrollment & Promotion | ☑ |
| 12 | Attendance Management | ☑ |
| 13 | Timetable / Class Routine | ☐ |
| 14 | Examination Management | ☐ |
| 15 | Marks & Result Processing | ☐ |
| 16 | Fees & Payments | ☐ |
| 17 | Communication & Notifications (SMS/Email) | ☐ |
| 18 | Portals & Dashboards (Student, Parent, Teacher, Principal) + Reports v1 | ☐ |

**Phase 2 — Operations (Modules 19–29)**

| # | Module | Status |
|---|--------|--------|
| 19 | Website CMS (Public Site) | ☐ |
| 20 | Accounting & Finance | ☐ |
| 21 | HR & Payroll | ☐ |
| 22 | Assignments & Homework | ☐ |
| 23 | Library Management | ☐ |
| 24 | Inventory & Assets | ☐ |
| 25 | Transport Management | ☐ |
| 26 | Hostel Management | ☐ |
| 27 | Document Management & Certificates | ☐ |
| 28 | Complaint, Visitor & Alumni Management | ☐ |
| 29 | Reports & Analytics v2 | ☐ |

**Phase 3 — Platform (Modules 30–32)**

| # | Module | Status |
|---|--------|--------|
| 30 | System Administration, Backup & Deployment Hardening | ☐ |
| 31 | Multi-School (SaaS) Enablement | ☐ |
| 32 | Future Expansion (Mobile API v2, QR/RFID, LMS, AI Analytics) | ☐ |

> Note on ordering vs. the SRS phases: the public Website CMS is scheduled at Module 19 (start of Phase 2) rather than first, because its dynamic content (notices, results, admission portal, verification) depends on the academic/exam/admission modules existing. If a static public site is needed on day one, a temporary brochure site can be deployed independently.

---

# Module 01 — Project Setup & Core Infrastructure

## 1. Goal
Bootstrap both repositories with production-grade scaffolding, shared conventions, Docker environments, database connectivity, global error handling, logging, configuration, health checks, and the shared UI foundation — so every subsequent module only adds features, never infrastructure.

## 2. Dependencies
None (first module).

## 3. Database Design
- Create database `smis`, extension `pgcrypto` (for `gen_random_uuid()`), `citext`.
- Base migration establishing conventions only; no business tables yet.
- Abstract base entity (TypeORM `BaseEntity` class or Prisma model conventions) implementing: `id`, `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at`.
- Global soft-delete query scope.

## 4. Backend Tasks (NestJS)
### Setup
- [x] `nest new smis-backend` (strict TS, ESLint + Prettier, Husky pre-commit: lint + typecheck + test).
- [x] Decide & lock ORM: ~~TypeORM~~ → **Prisma 7** (owner decision in Module 02; TypeORM removed, data layer rebuilt — rationale in `PROJECT_CONTEXT.md` §16).
- [x] `@nestjs/config` with Joi env validation (`.env.example` committed).
- [x] Docker Compose (dev): `postgres:16`, `redis:7`, `minio`, `mailpit` (SMTP catcher), backend.
- [x] Global `ValidationPipe`, global exception filter, response envelope interceptor, request-logging middleware (pino via `nestjs-pino`, request-id correlation).
- [x] `BaseRepository<T>` abstract class (find/paginate/create/update/softDelete/restore, automatic `deleted_at` + `school_id` scoping, `withTransaction` unit-of-work helper) — the repository-pattern foundation every module's repositories extend.
- [x] Swagger at `/api/docs` (protected by basic auth in prod).
- [x] Rate limiting (`@nestjs/throttler`): global 100 req/min, stricter override decorator for auth routes.
- [x] Helmet, CORS whitelist from env, compression.
- [x] BullMQ + Redis wiring, one demo queue (`system`), Bull Board at `/admin/queues` (guarded).
- [x] `HealthModule`: `GET /health` (DB, Redis, disk, memory via `@nestjs/terminus`).
- [x] `StorageModule`: S3 client wrapper — `upload`, `getSignedUrl`, `delete`; bucket-per-purpose config.
- [x] Migration + seed scripts (`npm run migration:generate|run|revert`, `npm run seed`).
- [x] CI (GitHub Actions): lint → typecheck → test → build → docker build.
### APIs
- `GET /api/v1/health`
- `GET /api/v1/version` (git sha, build time)

## 5. Frontend Tasks (Next.js)
- [x] `create-next-app` (TS strict, App Router, ESLint, Prettier, Husky).
- [x] Tailwind + shadcn/ui (decided component library — install via CLI, components vendored into `src/components/ui`); theme tokens (light/dark), Bangla-friendly font stack (Inter + Noto Sans Bengali).
- [x] Folder skeleton: `(public)`, `(auth)`, `(admin)`, `(portal)` route groups; `src/components/ui`, `src/components/shared`, `src/lib/{api,validations,utils,hooks}`.
- [x] Axios instance + TanStack Query provider (`QueryClient` defaults: retry 1, staleTime 30 s).
- [x] Shared components v1: `DataTable`, `PageHeader`, `FormDialog`, `ConfirmDialog`, `EmptyState`, `ErrorState`, `Spinner/Skeletons`, `StatCard`.
- [x] Global error boundary, not-found page, maintenance page.
- [x] Env handling (`NEXT_PUBLIC_API_URL`), `.env.example`.
- [x] CI: lint → typecheck → test → build.

## 6. Business Rules
- All environments (dev/staging/prod) must be reproducible from Docker Compose / documented deploy steps.
- No secret ever committed; Joi validation fails fast on missing envs.

## 7. Validation Rules
- Env schema validates: DB URL, JWT secrets, Redis URL, S3 creds, SMTP, CORS origins.

## 8. Edge Cases
- DB unreachable at boot → app exits non-zero (orchestrator restarts) rather than serving errors.
- Clock skew: containers pinned to UTC; display timezone is frontend concern.
- Redis down → queues degrade gracefully; health endpoint reports degraded, API stays up for non-queue features.

## 9. Testing Checklist
- [x] e2e: health endpoint returns 200 with component statuses.
- [x] Unit: response interceptor + exception filter shapes.
- [x] Frontend: DataTable renders server-driven pagination; axios refresh-interceptor unit test (mocked).
- [x] Manual: `docker compose up` from clean clone works on Ubuntu.

## 10. Completion Checklist
- [x] Both repos bootstrapped & CI green
- [x] Docker dev environment working
- [x] Global pipes/filters/interceptors in place
- [x] Swagger live
- [x] Shared UI components built
- [x] `PROJECT_CONTEXT.md` seeded with all decisions
- [x] Completion doc `docs/modules/01-project-setup.md` written

---

# Module 02 — Authentication

## 1. Goal
Secure login for all user types (admin, staff, teacher, student, parent) with JWT access + rotating refresh tokens, OTP-backed password reset, multi-device session management, activity logging, and password policy.

## 2. Dependencies
- Module 01.

## 3. Database Design
**Entities**
- `users`: `id`, `school_id`, `email CITEXT NULL`, `phone VARCHAR(15) NULL`, `password_hash`, `user_type ENUM('SUPER_ADMIN','ADMIN','STAFF','TEACHER','STUDENT','PARENT')`, `status ENUM('ACTIVE','INACTIVE','SUSPENDED','PENDING')`, `last_login_at`, `password_changed_at`, `failed_login_attempts INT DEFAULT 0`, `locked_until TIMESTAMPTZ NULL`, `must_change_password BOOL DEFAULT false`, audit + soft delete.
  - Constraints: `uq_users_email(school_id, email)`, `uq_users_phone(school_id, phone)`, `chk_users_contact` (email OR phone NOT NULL).
- `refresh_tokens`: `id`, `user_id FK`, `token_hash` (SHA-256 of token), `device_info JSONB` (ua, ip, device name), `expires_at`, `revoked_at NULL`, `replaced_by_id NULL` (rotation chain), `created_at`. Index on `user_id`, `token_hash`.
- `otp_codes`: `id`, `user_id FK NULL`, `identifier` (email/phone), `code_hash`, `purpose ENUM('PASSWORD_RESET','LOGIN_2FA','PHONE_VERIFY','EMAIL_VERIFY','ADMISSION')`, `expires_at`, `consumed_at NULL`, `attempts INT DEFAULT 0`, `created_at`.
- `login_activities`: `id`, `user_id`, `event ENUM('LOGIN_SUCCESS','LOGIN_FAILED','LOGOUT','REFRESH','PASSWORD_CHANGED','LOCKED')`, `ip`, `user_agent`, `created_at`. (No soft delete — append-only log.)

## 4. Backend Tasks (NestJS)
### Entities
- [x] `User`, `RefreshToken`, `OtpCode`, `LoginActivity` (Prisma models in `prisma/schema.prisma`).
### DTOs
- [x] `LoginDto` (identifier: email|phone, password, deviceName?), `RefreshDto`, `ForgotPasswordDto`, `VerifyOtpDto`, `ResetPasswordDto`, `ChangePasswordDto`, `LogoutDto (allDevices?: boolean)`.
### Validation
- [x] Password policy: min 8, 1 upper, 1 lower, 1 digit; reject 1000-most-common list; phone must match BD format `^01[3-9]\d{8}$`.
### Services
- [x] `AuthService`: login (argon2 verify), token pair issue, refresh **rotation with reuse detection** (reused token ⇒ revoke whole chain), logout (this device / all), lockout (5 fails → 15 min).
- [x] `OtpService`: 6-digit code, hash-stored, 5 min expiry, max 3 verify attempts, resend cooldown 60 s; dispatch via SMS/Email queue (`notifications`; SMS log-only until M17).
- [x] `PasswordService`: hashing (argon2id), policy checks, forced-change flow.
### Guards
- [x] `JwtAuthGuard` (global) + `@Public()` decorator; `ThrottlerGuard` overrides on credential routes (5/min per IP; refresh 30/min).
### Events
- [x] `user.logged_in`, `user.locked`, `password.changed` (+ `login_failed`, `logged_out`, `refreshed`, `token_reuse`) → listener writes `login_activities` + sends alert SMS on lock/theft.
### Scheduled Jobs
- [x] Nightly purge of expired refresh tokens & OTPs (>30 days).
### APIs
```
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
POST   /api/v1/auth/forgot-password
POST   /api/v1/auth/verify-otp
POST   /api/v1/auth/reset-password
POST   /api/v1/auth/change-password
GET    /api/v1/auth/me
GET    /api/v1/auth/sessions            (list active devices)
DELETE /api/v1/auth/sessions/:id        (revoke one device)
```
- Access token TTL 15 min; refresh 7 days (30 days with "remember me"); refresh delivered as httpOnly Secure SameSite=Lax cookie for web, body for future mobile.

## 5. Frontend Tasks (Next.js)
- [x] `(auth)/login`, `forgot-password`, `verify-otp`, `reset-password`, `change-password` pages (RHF + Zod).
- [x] Auth store (**Redux Toolkit** — owner decision, replaces the originally planned Zustand): user + permissions from `/auth/me`; token refresh handled by axios interceptor with single-flight refresh (queue concurrent 401s).
- [x] Route guards (Next 16 `proxy.ts`, the renamed middleware): protect `(admin)`/`(portal)`/`/account` routes via `hs_session` hint cookie, redirect by user_type after login (admin → dashboard, student/parent → portal).
- [x] Session manager page (`/account/sessions`: active devices, revoke buttons, sign-out-everywhere).
- [x] Forced password change interstitial when `must_change_password`.
- [x] Lockout & error messaging (generic "invalid credentials" — never reveal which field failed).

## 6. Business Rules
- One user account may map to multiple roles later (Module 03), but `user_type` fixes portal routing.
- Students/parents log in with phone or generated username; email optional.
- Refresh token reuse anywhere ⇒ treat as theft: revoke all sessions of that user, notify via SMS.
- Suspended/inactive users can authenticate nothing, including refresh.

## 7. Validation Rules
- Identifier normalized (trim, lowercase email, normalize BD phone to `01XXXXXXXXX`).
- OTP: exactly 6 digits; reject after expiry/consumed/3 attempts.
- New password ≠ last password.

## 8. Edge Cases
- Concurrent refresh from two tabs → single-flight on frontend; backend rotation tolerates one in-flight race by 5 s grace on `replaced_by`.
- User deleted/suspended mid-session → guard re-checks user status on refresh (not every request; acceptable 15 min window).
- OTP SMS gateway down → queue retries with backoff; user sees "code sent" only after enqueue success.
- Clock skew on JWT `exp` → 30 s leeway.

## 9. Testing Checklist
- [x] Unit: rotation + reuse detection, lockout counter, password policy.
- [x] e2e: login happy path, wrong password ×5 → 423 Locked, refresh flow, logout-all.
- [x] Frontend: form validation, interceptor refresh test, proxy (middleware) redirects.
- [x] Manual QA: live curl flow incl. reuse-detection; in-browser reset journey via Mailpit pending (see completion doc TODOs).

## 10. Completion Checklist
- [x] Entities & migrations (Prisma)
- [x] All endpoints + Swagger
- [x] Guards global
- [x] Frontend auth flow end-to-end
- [x] Tests passing (43 backend / 25 frontend)
- [x] Docs: `docs/modules/02-authentication.md`

---

# Module 03 — Authorization, Roles & Audit Logging

## 1. Goal
Full RBAC: roles, granular permissions, role-permission and user-role assignment, a `PermissionsGuard`, frontend `<Can>` gating — plus the global audit-log interceptor every later module relies on.

## 2. Dependencies
- Module 02.

## 3. Database Design
- `permissions`: `id`, `code` (`student.create`, `exam.mark.entry`…), `module`, `description`. Seeded from code registry; `uq(code)`.
- `roles`: `id`, `school_id`, `name`, `slug`, `description`, `is_system BOOL` (system roles: Super Admin, Admin, Principal, Vice Principal, Teacher, Accountant, Admission Officer, Librarian, Student, Parent, Office Staff — non-deletable), audit/soft-delete. `uq(school_id, slug)`.
- `role_permissions`: `role_id FK`, `permission_id FK`, PK(both).
- `user_roles`: `user_id FK`, `role_id FK`, PK(both).
- `audit_logs`: `id BIGSERIAL`, `school_id`, `user_id NULL`, `action` (`CREATE|UPDATE|DELETE|LOGIN|EXPORT|...`), `entity_type`, `entity_id`, `old_values JSONB NULL`, `new_values JSONB NULL`, `ip`, `user_agent`, `created_at`. Partition-ready (monthly) — index `(school_id, entity_type, entity_id)`, `(user_id, created_at)`.

## 4. Backend Tasks (NestJS)
- [x] Permission registry: single TS file of all permission codes per module (source of truth; sync-to-DB seeder is idempotent — new codes inserted, removed codes flagged).
- [x] `PermissionsGuard` + `@RequirePermissions(...codes)` (AND semantics; `@RequireAnyPermission` for OR). Super Admin bypasses.
- [x] Permission set embedded in access-token claims? **No** — fetched at login into `/auth/me`, cached server-side (Redis, 5 min) for guard checks, invalidated on role change.
- [x] `AuditInterceptor`: applied globally to mutating routes; diffs old/new via service-layer hooks (`AuditContextService`, AsyncLocalStorage); sensitive fields (password_hash, token) redacted.
- [x] CRUD: roles, assign permissions to role, assign roles to user.
- [x] Seeder: system roles with sensible default permission sets.
### APIs
```
GET/POST/PUT/DELETE /api/v1/roles
GET                 /api/v1/permissions
PUT                 /api/v1/roles/:id/permissions
GET/PUT             /api/v1/users/:id/roles
GET                 /api/v1/audit-logs        (filter: user, entity, action, date range)
GET                 /api/v1/audit-logs/:id
```

## 5. Frontend Tasks (Next.js)
- [x] Roles list + role editor (permission matrix grouped by module, check-all per module, search).
- [x] User role assignment UI (API live in M03; UI hosted by the Module 07 user detail page as planned).
- [x] `<Can permission="x">` component + `usePermissions()` hook; sidebar menu config declares required permission per item.
- [x] Audit log viewer: filterable table, JSON diff viewer dialog (old vs new, highlighted).

## 6. Business Rules
- System roles cannot be deleted or renamed; their permissions can be extended but core ones locked.
- A user must retain ≥1 role; the last Super Admin cannot be demoted/deleted.
- Role changes invalidate that user's permission cache immediately.
- Audit logs are immutable — no update/delete API exists.

## 7. Validation Rules
- Role slug: kebab-case, unique per school. Permission codes must exist in registry.

## 8. Edge Cases
- Permission removed from registry but referenced by role → seeder marks orphaned, guard denies gracefully.
- Two admins editing same role → last-write-wins with `updated_at` optimistic check (409 on stale).
- Huge audit tables → monthly partitions + retention policy (Module 30).

## 9. Testing Checklist
- [x] Unit: guard AND/OR logic, super-admin bypass, cache invalidation.
- [x] e2e: 403 without permission, 200 with; role CRUD; last-super-admin protection (unit-tested; e2e covers grant/revoke round-trip).
- [x] Frontend: `<Can>` hides/shows; permission matrix saves correctly.

## 10. Completion Checklist
- [x] RBAC tables + seeds
- [x] Guard + decorators wired into global setup
- [x] Audit interceptor live and used by all future modules
- [x] Role management UI
- [x] Tests passing (64 backend unit + 27 e2e / 38 frontend)
- [x] Docs: `docs/modules/03-authorization-audit.md`

---

# Module 04 — School Setup & Settings

## 1. Goal
Establish the school's identity and system-wide configuration: profile, branding, academic defaults, grading systems, SMS/Email/payment gateway settings, and a generic key-value settings service consumed by every module.

## 2. Dependencies
- Modules 01–03.

## 3. Database Design
- `schools`: `id`, `name`, `name_bn`, `code` (short unique code, used in IDs), `eiin_number NULL` (BD Education Board ID), `type ENUM('PRIMARY','HIGH_SCHOOL','KINDERGARTEN','ENGLISH_VERSION','ENGLISH_MEDIUM','MADRASA','VOCATIONAL','COLLEGE')`, `address`, `phone`, `email`, `website`, `logo_url`, `established_year`, `principal_name`, `status`, audit/soft-delete.
- `school_settings`: `id`, `school_id`, `key VARCHAR`, `value JSONB`, `group` (`general|academic|sms|email|payment|attendance|exam|fees`), `uq(school_id, key)`.
- `grading_systems`: `id`, `school_id`, `name` (e.g. "NCTB Standard"), `is_default BOOL`, audit.
- `grade_points`: `id`, `grading_system_id FK`, `grade` (`A+`…`F`), `point NUMERIC(3,2)`, `min_mark`, `max_mark`, `chk(min<=max)`, `uq(grading_system_id, grade)`; non-overlapping ranges enforced in service.
  - Seed NCTB default: A+ 80–100 (5.00), A 70–79 (4.00), A− 60–69 (3.50), B 50–59 (3.00), C 40–49 (2.00), D 33–39 (1.00), F 0–32 (0.00).

## 4. Backend Tasks (NestJS)
- [x] `SettingsService`: typed getters with defaults + Redis cache; secrets (gateway API keys) encrypted at rest (AES-256-GCM, key from env). Keys declared in a TS settings registry (per-group type/secret/default).
- [x] School profile CRUD (single record for now; list-ready for Module 31). Migration also inserts the bootstrap school (`DEFAULT_SCHOOL_ID`) and adds the deferred `users`/`roles` FKs.
- [x] Grading system CRUD with overlap validation (+ 0–100 coverage required to become default).
- [x] Logo upload → S3 via StorageModule (image validation: type, ≤2 MB, resize to 512px via sharp; stored as key, signed URL on read).
- [x] Settings test endpoints: send test SMS / test email using saved config (SMS log-only until M17).
### APIs
```
GET/PUT  /api/v1/school
POST     /api/v1/school/logo
GET/PUT  /api/v1/settings/:group
POST     /api/v1/settings/test-sms | test-email
GET/POST/PUT/DELETE /api/v1/grading-systems
```

## 5. Frontend Tasks (Next.js)
- [x] Settings area with tabbed sections: School Profile, Academic, Grading Systems, SMS Gateway, Email, Payment Gateways, Theme/Logo (route-based tabs; logo lives on the Profile tab).
- [x] Grading system editor (inline-editable grade rows, live overlap warnings).
- [x] Secret fields masked with reveal toggle; "Send test" buttons with result toast.

## 6. Business Rules
- Exactly one default grading system per school.
- Grade ranges must cover 0–100 with no gaps/overlaps before a system can be set default.
- Changing a grading system never mutates already-published results (results snapshot their grades — Module 15).

## 7. Validation Rules
- EIIN: 6 digits if provided. Phone/email formats. JSONB settings validated per-group by Zod-like schemas server-side.

## 8. Edge Cases
- Gateway credentials invalid → test endpoints surface provider error; saving still allowed (flagged unverified).
- Settings cache stale after direct DB edit → cache bust on every settings write; TTL 60 s safety net.

## 9. Testing Checklist
- [x] Unit: grade overlap validator, settings encryption round-trip.
- [x] e2e: settings CRUD per group, permission-guarded (+ live test-email via Mailpit).
- [x] Manual: logo renders in admin sidebar header (wired; in-browser upload click-through pending — see completion doc TODOs).

## 10. Completion Checklist
- [x] Tables + NCTB seed
- [x] SettingsService consumed via DI (exported from SchoolModule)
- [x] Settings UI complete
- [x] Tests passing (91 backend unit + 42 e2e / 46 frontend)
- [x] Docs: `docs/modules/04-school-setup.md`

---

# Module 05 — Academic Session & Calendar

## 1. Goal
Academic years/sessions, holidays, and the academic calendar — the temporal backbone scoping enrollment, attendance, exams, and fees.

## 2. Dependencies
- Module 04.

## 3. Database Design
- `academic_sessions`: `id`, `school_id`, `name` ("2026"), `start_date`, `end_date`, `status ENUM('UPCOMING','ACTIVE','COMPLETED','ARCHIVED')`, `is_current BOOL`, audit/soft-delete. `uq(school_id, name)`; `chk(start_date < end_date)`. Partial unique index: only one `is_current=true` per school.
- `holidays`: `id`, `school_id`, `session_id FK`, `title`, `start_date`, `end_date`, `type ENUM('GOVERNMENT','RELIGIOUS','SCHOOL','WEEKLY')`, `applies_to ENUM('ALL','STUDENTS','STAFF')`, audit.
- `calendar_events`: `id`, `school_id`, `session_id`, `title`, `description`, `start_date`, `end_date`, `type ENUM('EXAM','EVENT','MEETING','SPORTS','CULTURAL','OTHER')`, `is_public BOOL` (shows on website), audit/soft-delete.
- Weekly holiday config in settings (default Friday, optional Saturday — configurable per school).

## 4. Backend Tasks (NestJS)
- [x] Session CRUD; `activate` endpoint (transactional: demote current, promote target; demoted ACTIVE → COMPLETED).
- [x] Holiday & event CRUD; date-range overlap queries; `isHoliday(date)` service used by Attendance/Payroll (weekly off-days from the M04 setting + holiday ranges). CSV bulk holiday import with row-level error report.
- [x] iCal export of calendar (`GET /calendar.ics`).
### APIs
```
GET/POST/PUT/DELETE /api/v1/academic-sessions
POST                /api/v1/academic-sessions/:id/activate
GET/POST/PUT/DELETE /api/v1/holidays
GET/POST/PUT/DELETE /api/v1/calendar-events
GET                 /api/v1/calendar?month=&session_id=
```

## 5. Frontend Tasks (Next.js)
- [x] Sessions list with status badges + activate confirm dialog (warning copy about scoping effects).
- [x] Calendar page: month grid (holidays/events color-coded), list view, add-event dialog, iCal download.
- [x] Global session switcher in admin header (persisted per user, defaults to current session) — all session-scoped pages read from it (`useAcademicSession()`).

## 6. Business Rules
- Exactly one current session. Sessions cannot overlap in dates for the same school.
- A COMPLETED session becomes read-only for attendance/marks entry (view + reports only).
- Deleting a session is blocked once any enrollment/attendance/exam references it (soft-delete blocked too — archive instead).

## 7. Validation Rules
- Holiday range must fall within its session. Event end ≥ start.

## 8. Edge Cases
- Mid-year session date correction after attendance exists → allowed only if no attendance/exam records fall outside new range.
- Bangladeshi context: government holidays announced late → bulk holiday import (CSV) supported.

## 9. Testing Checklist
- [x] Unit: single-current invariant, overlap detection, `isHoliday`.
- [x] e2e: activate flow, blocked delete (+ CSV import, iCal, month aggregate).
- [x] Frontend: calendar renders holidays (grid util tested); session switcher persists (localStorage per user; in-browser click-through pending — see completion doc TODOs).

## 10. Completion Checklist
- [x] Tables + APIs + UI
- [x] Session switcher adopted as a global convention (documented in PROJECT_CONTEXT §13)
- [x] Tests passing (118 backend unit + 53 e2e / 55 frontend)
- [x] Docs: `docs/modules/05-academic-session.md`

---

# Module 06 — Academic Structure

## 1. Goal
Classes, sections, groups (Science/Commerce/Arts), shifts (Morning/Day), subjects, and departments — plus class-subject mapping. Defines "where a student sits and what they study."

## 2. Dependencies
- Module 05.

## 3. Database Design
- `departments`: `id`, `school_id`, `name`, `code`, audit/soft-delete. (Used by staff & subjects.)
- `shifts`: `id`, `school_id`, `name`, `start_time TIME`, `end_time TIME`, audit.
- `classes`: `id`, `school_id`, `name` ("Class 6"), `name_bn`, `numeric_level INT` (6), `display_order`, audit/soft-delete. `uq(school_id, numeric_level)`.
- `groups`: `id`, `school_id`, `name ENUM-ish but table` ('Science','Commerce','Arts','General','Vocational'), applicable from class level (BD: groups start class 9).
- `sections`: `id`, `school_id`, `class_id FK`, `session_id FK`, `name` ("A"), `shift_id FK NULL`, `group_id FK NULL`, `capacity INT`, `class_teacher_id FK NULL (teachers)`, `room_no`, audit/soft-delete. `uq(school_id, session_id, class_id, name, shift_id)`.
- `subjects`: `id`, `school_id`, `name`, `name_bn`, `code`, `department_id NULL`, `type ENUM('THEORY','PRACTICAL','BOTH')`, audit/soft-delete. `uq(school_id, code)`.
- `class_subjects`: `id`, `class_id FK`, `subject_id FK`, `session_id FK`, `group_id NULL`, `is_optional BOOL` (4th subject), `full_marks_default INT`, `display_order`. `uq(class_id, subject_id, session_id, group_id)`.

## 4. Backend Tasks (NestJS)
- [x] CRUD for all six entities + class-subject mapping endpoints (bulk assign subjects to class).
- [x] "Clone structure to new session" service: copies sections & class-subject maps from a previous session (used yearly; additive/idempotent, preview dry-run, class teachers not copied).
- [x] Guard deletes: class/section/subject with dependent enrollments/marks → block with explanatory 409 (holidays/sections/mappings guarded now; enrollment/marks guards extend in M11/M15).
### APIs
```
CRUD /api/v1/departments | shifts | classes | groups | sections | subjects
GET/PUT /api/v1/classes/:id/subjects?session_id=
POST    /api/v1/academic-structure/clone   {from_session, to_session}
```

## 5. Frontend Tasks (Next.js)
- [x] Management pages for each entity (DataTable + FormDialog pattern — via the new reusable `MasterCrud` generic).
- [x] Class detail page: tabs — Sections, Subjects (order via up/down arrows, optional flag), per selected session (session switcher).
- [x] Clone-to-session wizard with preview diff (count-level preview).

## 6. Business Rules
- Sections are session-scoped (Class 6-A of 2026 ≠ 2027). Classes and subjects are session-independent masters.
- Groups apply only to configured class levels (default ≥ 9); section with a group must belong to such a class.
- A subject can't be removed from a class-session once marks exist for it.
- Section capacity is advisory at creation, enforced at enrollment (Module 11) with override permission.

## 7. Validation Rules
- Shift times: start < end. Section name ≤ 5 chars. Subject code uppercase alphanumeric.

## 8. Edge Cases
- Same subject THEORY+PRACTICAL split marks — handled by subject `type` + exam mark distribution (Module 14), not duplicate subjects.
- Madrasa/Vocational naming — `name_bn` + free-form class names supported alongside numeric_level.
- Mid-session new section (admission surge) → allowed; routine/exam seat plans must be regenerated manually (warn in UI).

## 9. Testing Checklist
- [x] Unit: clone service, delete guards.
- [x] e2e: CRUD matrix + uniqueness violations → 409 (+ ordering persistence, clone preview/idempotency).
- [x] Frontend: class-subject ordering persists (verified via e2e re-PUT; editor state keyed to server mapping).

## 10. Completion Checklist
- [x] All entities + mapping
- [x] Clone wizard
- [x] Tests passing (138 backend unit + 67 e2e / 60 frontend)
- [x] Docs: `docs/modules/06-academic-structure.md`

---

# Module 07 — Staff & User Management

## 1. Goal
Central administration of all system users and non-teaching staff records: creation, invitation, status control, department assignment, and profile management. (Teachers and students get dedicated modules on top of this.)

## 2. Dependencies
- Modules 03, 04, 06 (departments).

## 3. Database Design
- `staff_profiles`: `id`, `school_id`, `user_id FK uq`, `employee_id VARCHAR uq(school_id)`, `first_name`, `last_name`, `name_bn`, `designation` (`ENUM('PRINCIPAL','VICE_PRINCIPAL','ACCOUNTANT','ADMISSION_OFFICER','LIBRARIAN','OFFICE_STAFF','LAB_ASSISTANT','SECURITY','CLEANER','OTHER')`), `department_id NULL`, `gender ENUM('MALE','FEMALE','OTHER')`, `dob`, `blood_group`, `nid_number`, `photo_url`, `address JSONB {present, permanent}`, `joining_date`, `employment_type ENUM('PERMANENT','CONTRACT','PART_TIME')`, `status ENUM('ACTIVE','ON_LEAVE','RESIGNED','TERMINATED','RETIRED')`, audit/soft-delete.
- `staff_documents`: `id`, `staff_id FK`, `title`, `type ENUM('NID','CERTIFICATE','CV','PHOTO','CONTRACT','OTHER')`, `file_url`, `uploaded_by`, audit.

## 4. Backend Tasks (NestJS)
- [x] Staff CRUD; on create → transactional user creation with temp password (`must_change_password=true`) + welcome SMS/email via queue (+ designation-mapped default system role).
- [x] Employee ID generator: pattern from settings (`general.employee_id_pattern`, default `{SCHOOL_CODE}-S-{YY}{SEQ4}`) — `document_sequences` table per school+prefix, gap-free within transaction (shared `SequenceService`).
- [x] Photo & document uploads (S3, images ≤2 MB → EXIF-normalized 512px PNG, docs ≤10 MB, pdf/jpg/png only).
- [x] Status transitions endpoint with reason logging (feeds HR later); RESIGNED/TERMINATED → account deactivation cascade.
- [x] User admin endpoints: reset password (admin-initiated), activate/deactivate, role assignment (uses Module 03).
### APIs
```
CRUD  /api/v1/staff
POST  /api/v1/staff/:id/documents      DELETE /api/v1/staff/:id/documents/:docId
PUT   /api/v1/staff/:id/status
GET   /api/v1/users                    (all users, filter by type/status/role)
PUT   /api/v1/users/:id/status
POST  /api/v1/users/:id/reset-password
```

## 5. Frontend Tasks (Next.js)
- [x] Staff list (filters: designation, department, status; export).
- [x] Staff create/edit multi-section form (personal, employment, address, photo upload — crop UI deferred, server normalizes).
- [x] Staff detail page: profile, documents (upload/preview/delete), roles, activity log tab.
- [x] Users list page (all account types) with quick actions (reset password, deactivate) behind `<Can>`.

## 6. Business Rules
- Deactivating a user revokes all refresh tokens immediately.
- RESIGNED/TERMINATED staff auto-deactivates the linked user account (event listener).
- Employee IDs never reused, even after soft delete.

## 7. Validation Rules
- NID: 10, 13 or 17 digits (BD formats). DOB ⇒ age ≥ 18. Joining date ≤ today.

## 8. Edge Cases
- Staff without email (common) → phone-only account; welcome via SMS.
- Duplicate NID entry attempt → warn (soft check, not unique constraint — data quality varies).
- Photo EXIF orientation → normalize server-side.

## 9. Testing Checklist
- [x] Unit: ID generator concurrency (parallel creates → no dup — covered by e2e parallel-create test + row-lock upsert design).
- [x] e2e: create staff creates user; status cascade deactivation.
- [x] Frontend: multi-step form validation, document upload (schema-tested; in-browser upload click-through pending — see completion doc TODOs).

## 10. Completion Checklist
- [x] Entities + APIs + UI
- [x] ID generator documented as shared service in PROJECT_CONTEXT
- [x] Tests passing
- [x] Docs: `docs/modules/07-staff-users.md`

---

# Module 08 — Teacher Management

## 1. Goal
Teacher profiles with qualifications, joining/salary-grade info, subject expertise, class/subject assignment, schedule view, leave basics, and evaluation records.

## 2. Dependencies
- Modules 06, 07.

## 3. Database Design
- `teachers`: `id`, `school_id`, `user_id FK uq`, `employee_id`, personal fields as staff (or: teacher **extends** staff_profiles via `staff_id FK uq` — chosen approach: separate table sharing the user, with same personal columns; record decision), `department_id`, `designation ENUM('HEAD_TEACHER','ASSISTANT_HEAD','SENIOR_TEACHER','ASSISTANT_TEACHER','SUBJECT_TEACHER','PART_TIME')`, `salary_grade`, `mpo_index_no NULL` (BD MPO), `specialization`, audit/soft-delete.
- `teacher_qualifications`: `id`, `teacher_id FK`, `degree`, `institution`, `passing_year`, `result`, `document_url NULL`.
- `teacher_subjects`: `teacher_id FK`, `subject_id FK` — expertise mapping. PK(both).
- `teacher_section_subjects`: `id`, `session_id`, `teacher_id FK`, `section_id FK`, `subject_id FK`, `uq(session_id, section_id, subject_id)` — who teaches what where.
- `teacher_evaluations`: `id`, `teacher_id`, `session_id`, `evaluator_id`, `criteria JSONB`, `score NUMERIC(5,2)`, `remarks`, `evaluated_at`, audit.
- Leave tables deferred to Module 21 (HR); interim `teacher_leaves` minimal: `id, teacher_id, from_date, to_date, type ENUM('CASUAL','SICK','MATERNITY','UNPAID','OTHER'), status ENUM('PENDING','APPROVED','REJECTED'), reason, approved_by` — designed to be migrated into HR leave later.

## 4. Backend Tasks (NestJS)
- [x] Teacher CRUD (+ user creation as Module 07 pattern incl. `teacher` system role), qualifications CRUD, expertise mapping.
- [x] Assignment service: assign teacher→section+subject (replace semantics, expertise check + `teacher.assign.override`); conflict check hook interface (`TIMETABLE_CONFLICT_CHECKER`, no-op until M13). + bulk transfer helper, class-teacher FK/cap on sections.
- [x] Leave request/approve endpoints + events (`teacher.leave.approved` → attendance module marks Leave).
- [x] Teacher workload report: periods/week per teacher (finalized after Module 13; interim = assignment counts).
### APIs
```
CRUD /api/v1/teachers
CRUD /api/v1/teachers/:id/qualifications
GET/PUT /api/v1/teachers/:id/subjects
GET/POST/DELETE /api/v1/teacher-assignments        (?session_id=&section_id=)
GET  /api/v1/teachers/:id/schedule
CRUD /api/v1/teacher-leaves (+ POST /:id/approve|reject)
CRUD /api/v1/teachers/:id/evaluations
```

## 5. Frontend Tasks (Next.js)
- [x] Teacher list/detail (tabs: Profile, Qualifications, Subjects, Assignments — doubles as the interim Schedule view, Leaves, Evaluations, Documents).
- [x] Assignment matrix page: pick section → grid of subjects × teacher dropdown (expertise-matching teachers ★-highlighted; override confirm).
- [x] Leave approval inbox for principal/admin.
- [x] Evaluation form with configurable criteria (from settings JSON `academic.teacher_evaluation_criteria`).

## 6. Business Rules
- One teacher per (session, section, subject) — reassignment replaces, keeping history via audit log.
- Teacher can be class_teacher of at most N sections (setting, default 1).
- Approved leave overlapping another approved leave → blocked.
- Assigning a subject the teacher lacks expertise in → warning, allowed with `teacher.assign.override` permission.

## 7. Validation Rules
- Passing year 1950–current. Evaluation score 0–100. Leave from ≤ to; within active session.

## 8. Edge Cases
- Teacher resigns mid-session → assignments must be transferred before status change (blocking check with bulk-transfer helper).
- Part-time teacher across shifts → allowed; timetable module handles time conflicts.

## 9. Testing Checklist
- [x] Unit: assignment uniqueness, leave overlap.
- [x] e2e: teacher lifecycle, resign-with-assignments blocked (+ transfer → resign → cascade).
- [x] Frontend: assignment matrix save; leave approve flow (schema-tested; in-browser click-through pending — see completion doc TODOs).

## 10. Completion Checklist
- [x] Entities + APIs + UI
- [x] Assignment history auditable
- [x] Tests passing
- [x] Docs: `docs/modules/08-teachers.md`

---

# Module 09 — Student & Guardian Management

## 1. Goal
The student master record: registration, rich profile (guardian, medical, documents), ID cards with QR, status lifecycle, transfer, and per-student history views. Guardians become parent portal users.

## 2. Dependencies
- Modules 06, 07 (user pattern).

## 3. Database Design
- `students`: `id`, `school_id`, `user_id FK uq NULL` (portal account, created lazily), `student_uid VARCHAR uq(school_id)` (permanent ID, e.g. `{SCHOOL_CODE}-{ADMISSION_YEAR}{SEQ5}`), `first_name`, `last_name`, `name_bn`, `gender`, `dob`, `blood_group NULL`, `religion ENUM('ISLAM','HINDUISM','BUDDHISM','CHRISTIANITY','OTHER')`, `birth_certificate_no VARCHAR NULL uq soft(school)`, `photo_url`, `present_address JSONB`, `permanent_address JSONB`, `admission_date`, `admission_class_id`, `previous_school NULL`, `status ENUM('ACTIVE','INACTIVE','TRANSFERRED','GRADUATED','DROPPED','SUSPENDED')`, `qr_token VARCHAR uq` (random, rotatable — used on ID card), audit/soft-delete.
- `guardians`: `id`, `school_id`, `user_id FK uq NULL`, `name`, `name_bn`, `relation ENUM('FATHER','MOTHER','BROTHER','SISTER','UNCLE','AUNT','GRANDPARENT','LEGAL_GUARDIAN','OTHER')`, `phone`, `email NULL`, `nid NULL`, `occupation`, `monthly_income NUMERIC NULL`, `address JSONB`, audit/soft-delete.
- `student_guardians`: `student_id FK`, `guardian_id FK`, `relation`, `is_primary BOOL`, `is_emergency_contact BOOL`, PK(student, guardian). One primary per student (partial unique index).
- `student_medical_info`: `id`, `student_id uq`, `height_cm`, `weight_kg`, `allergies TEXT`, `chronic_conditions TEXT`, `disabilities TEXT`, `emergency_notes TEXT`, audit. *(Access restricted: `student.medical.view` permission only.)*
- `student_documents`: as staff_documents pattern (`BIRTH_CERTIFICATE`,`PHOTO`,`TRANSFER_CERTIFICATE`,`PREVIOUS_MARKSHEET`,`OTHER`).
- `student_status_history`: `id`, `student_id`, `from_status`, `to_status`, `reason`, `changed_by`, `created_at`.

## 4. Backend Tasks (NestJS)
- [x] Student CRUD (registration usually flows from Admission — Module 10 — but direct registration supported for migrations/walk-ins).
- [x] Guardian CRUD + linking (search-existing-guardian by phone to avoid duplicates — siblings share guardians).
- [x] Portal account provisioning: `POST /students/:id/create-account` and `POST /guardians/:id/create-account` (phone-based login, temp password by SMS).
- [x] ID card generation: PDF (single + batch per section) with photo, QR (`qr_token`), school branding; template configurable. QR rotate endpoint.
- [x] Bulk import (XLSX) with validation report (row-level errors downloadable) — critical for onboarding existing schools.
- [x] Aggregated history endpoints (attendance %, results summary — implemented as the source modules land; return empty gracefully until then).
### APIs
```
CRUD /api/v1/students        GET /api/v1/students/:id/full   (profile+guardians+medical+docs)
CRUD /api/v1/guardians       POST/DELETE /api/v1/students/:id/guardians
GET/PUT /api/v1/students/:id/medical
POST /api/v1/students/:id/documents
PUT  /api/v1/students/:id/status
POST /api/v1/students/:id/id-card        POST /api/v1/sections/:id/id-cards
POST /api/v1/students/import             GET /api/v1/students/import-template
GET  /api/v1/students/:id/attendance-history | performance-history
POST /api/v1/students/:id/create-account
```

## 5. Frontend Tasks (Next.js)
- [x] Student list: filters (session, class, section, group, gender, status), quick search by name/UID/phone, bulk actions (ID cards, SMS), export.
- [x] Registration wizard: Personal → Guardians (search-or-create) → Address → Medical → Documents → Review.
- [x] Student detail: tabs Profile / Guardians / Medical (permission-gated) / Documents / Attendance / Results / Fees / Timeline (status history + audit).
- [x] Guardian list + detail (children listed).
- [x] Import wizard: upload → validation report table → confirm import.
- [x] ID card preview + batch print dialog.

## 6. Business Rules
- `student_uid` is permanent and never changes across sessions/classes; roll numbers are enrollment-scoped (Module 11).
- Exactly one primary guardian; primary guardian phone is the default SMS target.
- Status change to TRANSFERRED/DROPPED/GRADUATED requires clearing dues check (soft warning until Fees module, hard-block after Module 16 with override permission) and auto-deactivates portal account.
- Medical info visible only to permitted roles; never included in exports by default.

## 7. Validation Rules
- Birth certificate: 17 digits if provided. DOB sane per class level (warn if age outside class ± 3 yrs). Guardian phone mandatory & BD-format.

## 8. Edge Cases
- Twins/siblings: same guardian, similar names → duplicate detector (name+dob+guardian phone) warns, never blocks.
- Guardian is also staff → same phone across user types allowed (user uniqueness is per school+type — adjust Module 02 constraint note: uniqueness enforced at `(school_id, user_type, phone)`).
- Photo missing at ID card time → placeholder + card flagged incomplete.
- Import with Bangla names → UTF-8 XLSX handled; template includes `name_bn` column.

## 9. Testing Checklist
- [x] Unit: UID generator, duplicate detector, primary-guardian invariant.
- [x] e2e: full registration, guardian linking, status transitions, import happy/invalid rows.
- [x] Frontend: wizard step validation, import error display.
- [x] Manual: batch ID card PDF prints correctly (CR80 layout).

## 10. Completion Checklist
- [x] Entities + APIs + UI
- [x] Import pipeline
- [x] ID card PDFs
- [x] Tests passing (230 backend unit + e2e all suites / 88 frontend)
- [x] Docs: `docs/modules/09-students-guardians.md`

---

# Module 10 — Admission Management

## 1. Goal
End-to-end admission: public online application, application fee payment, admission test, merit & waiting lists, approval → student conversion, and admission reporting.

## 2. Dependencies
- Modules 06, 09; payment gateway integration is stubbed until Module 16 (design the interface now, wire SSLCommerz/bKash in 16; offline payment recording works immediately).

## 3. Database Design
- `admission_cycles`: `id`, `school_id`, `session_id FK`, `name` ("Admission 2027"), `class_ids UUID[]` or child table `admission_cycle_classes(cycle_id, class_id, seats INT, application_fee NUMERIC)`, `start_at`, `end_at`, `test_required BOOL`, `status ENUM('DRAFT','OPEN','CLOSED','COMPLETED')`, `instructions TEXT`, audit.
- `admission_applications`: `id`, `school_id`, `cycle_id FK`, `application_no VARCHAR uq` (`ADM-{YY}-{SEQ6}`), `class_id FK`, applicant snapshot fields (name, name_bn, dob, gender, religion, photo_url, previous school & result JSONB, addresses JSONB), guardian snapshot JSONB, `phone` (contact, verified via OTP), `status ENUM('DRAFT','SUBMITTED','PAYMENT_PENDING','UNDER_REVIEW','TEST_SCHEDULED','PASSED','FAILED','SELECTED','WAITLISTED','ADMITTED','REJECTED','CANCELLED','EXPIRED')`, `payment_status ENUM('UNPAID','PAID','WAIVED','REFUNDED')`, `payment_ref NULL`, `test_marks NUMERIC NULL`, `merit_position INT NULL`, `student_id FK NULL` (after conversion), audit.
- `admission_tests`: `id`, `cycle_id`, `class_id`, `test_date`, `venue`, `total_marks`, `pass_marks`.
- `admission_seat_allocations` derived (selected count vs seats).

## 4. Backend Tasks (NestJS)
- [x] Public endpoints (`@Public()` + reCAPTCHA + OTP phone verify) for apply/track.
- [x] Application no. generator (SequenceService `admission:{YY}`); draft save/resume implemented client-side (localStorage) — server-side phone+OTP drafts deferred (see completion doc).
- [x] Payment interface — offline record now (`recordPayment` + waive/refund); online callback slot for Module 16.
- [x] Test mark entry (bulk), merit list generation (order: test_marks desc, tiebreak: previous result GPA desc, then dob asc), auto SELECTED up to seats, remainder WAITLISTED.
- [x] Waitlist promotion endpoint (when a selected applicant cancels/expires — auto + manual promote-N).
- [x] Convert-to-student service: create student + guardians (dedupe by phone) via exported StudentsService; admission completes at ADMITTED, enrollment backfilled by M11 (ordering note honored: **run Module 11 before first real admission cycle**).
- [x] Notifications at every status change (SMS templates; log-only until M17. Exception by design: raw PASSED/FAILED mark entry stays silent — merit is the announcement).
- [x] Admit card PDF (test roll = application no, venue, date; public + admin download).
### APIs
```
CRUD /api/v1/admission-cycles (+ /:id/open|close)
POST /api/v1/public/admissions/apply           GET /api/v1/public/admissions/track?app_no=&phone=
POST /api/v1/public/admissions/verify-otp
GET  /api/v1/admission-applications (filters)  PUT /:id/status
POST /api/v1/admission-applications/:id/payment (offline record)
POST /api/v1/admission-cycles/:id/test-marks   POST /:id/generate-merit-list
GET  /api/v1/admission-cycles/:id/merit-list | waiting-list
POST /api/v1/admission-applications/:id/admit  (convert to student)
GET  /api/v1/admission-reports/summary
```

## 5. Frontend Tasks (Next.js)
- [x] Public: admission landing (open cycles), multi-step application form (mobile-first, photo upload, Bangla input), OTP verify, payment step (offline instructions until M16), tracking page, admit card download.
- [x] Admin: cycle setup (classes, seats, fees, test), applications table (status pipeline filters), application review actions, test-marks bulk entry grid, merit list tab (publish to website arrives with M19), convert-to-student confirm flow, reports (applied/paid/selected/admitted funnel).

## 6. Business Rules
- One application per (cycle, class, phone+dob) — duplicate blocked with friendly message.
- Merit list can be generated only after cycle test marks locked; regeneration voids previous list (audited).
- SELECTED applicants get an admission deadline (setting, default 7 days) → auto EXPIRED job promotes waitlist.
- Application fee non-refundable by default (WAIVED possible with permission).
- Conversion is idempotent — re-admit of ADMITTED app returns existing student.

## 7. Validation Rules
- Cycle end > start; within session. Test marks ≤ total. Photo ≤ 1 MB jpg/png. Applicant age vs class-level bounds (from settings) hard-checked.

## 8. Edge Cases
- Payment succeeded but callback lost → reconciliation endpoint by gateway txn id (Module 16 fleshes out).
- Applicant applies to multiple classes → allowed (separate apps) unless setting forbids.
- Seats increased after merit publish → "promote next N from waitlist" action.
- Cycle closed early with SUBMITTED unpaid apps → auto CANCELLED + SMS.

## 9. Testing Checklist
- [x] Unit: merit ordering & tiebreaks, waitlist promotion, expiry job (+ transition map, payment rules, idempotent admit).
- [x] e2e: public apply→track flow, admin funnel transitions, convert-to-student guards (SELECTED-only + idempotent re-admit; 21 assertions).
- [x] Frontend: public form validation incl. OTP + admin schemas (13 validation tests).

## 10. Completion Checklist
- [x] Cycle + application lifecycle complete
- [x] Merit/waitlist engine
- [x] Public UX mobile-first (responsive layout; on-device click-through pending SMS delivery in M17)
- [x] Tests passing (261 backend unit + 21 admission e2e / 101 frontend)
- [x] Docs: `docs/modules/10-admission.md`

---

# Module 11 — Enrollment & Promotion

## 1. Goal
Bind students to (session, class, section, group, shift) with roll numbers; power yearly class promotion, section transfer, and the canonical "current students of section X" query every other module uses.

## 2. Dependencies
- Modules 06, 09.

## 3. Database Design
- `enrollments`: `id`, `school_id`, `student_id FK`, `session_id FK`, `class_id FK`, `section_id FK`, `group_id NULL`, `shift_id NULL`, `roll_no INT`, `enrollment_date`, `type ENUM('NEW','PROMOTED','READMITTED','TRANSFERRED_IN')`, `status ENUM('ACTIVE','TRANSFERRED_OUT','PROMOTED','RETAINED','COMPLETED','CANCELLED')`, `optional_subject_id NULL` (4th subject), audit.
  - `uq(student_id, session_id)` — one enrollment per session.
  - `uq(session_id, section_id, roll_no)` — roll unique within section.
- `enrollment_transfers`: `id`, `enrollment_id`, `from_section_id`, `to_section_id`, `reason`, `transferred_by`, `created_at`.
- `promotion_batches`: `id`, `school_id`, `from_session_id`, `to_session_id`, `status ENUM('DRAFT','EXECUTED','ROLLED_BACK')`, `criteria JSONB`, `executed_by`, `executed_at`.
- `promotion_items`: `id`, `batch_id`, `student_id`, `from_enrollment_id`, `decision ENUM('PROMOTE','RETAIN','GRADUATE','EXCLUDE')`, `to_class_id NULL`, `to_section_id NULL`, `result_snapshot JSONB NULL`.

## 4. Backend Tasks (NestJS)
- [x] Enroll endpoint (single + bulk-by-section), auto roll assignment (next available / alphabetical batch assign / manual).
- [x] Section transfer (keeps roll or reassigns per setting).
- [x] Promotion wizard services: build batch from result data (pass/fail per Module 15 when available; manual decisions supported before that), preview, execute (transaction: close old enrollments, create new, statuses), rollback (only if no attendance/marks on new session — guard is a hook until M12/M15).
- [x] Canonical query service: `getSectionStudents(sectionId)` / `getStudentCurrentEnrollment(studentId)` — exported for Attendance/Exams/Fees.
### APIs
```
CRUD /api/v1/enrollments        POST /api/v1/enrollments/bulk
POST /api/v1/enrollments/:id/transfer-section
POST /api/v1/enrollments/roll-assign   {section_id, strategy}
CRUD /api/v1/promotions (+ /:id/preview /:id/execute /:id/rollback)
GET  /api/v1/sections/:id/students
```

## 5. Frontend Tasks (Next.js)
- [x] Enrollment page per section: student picker (unenrolled-in-session filter), roll editor (inline edit + renumber-by-strategy), optional-subject column.
- [x] Transfer dialog with capacity indicator.
- [x] Promotion wizard: pick sessions → auto class mapping (Class 6→7 etc.) → per-student decision grid (auto-filled, editable) → preview counts → execute → rollback.

## 6. Business Rules
- Student cannot enroll twice in the same session (hard constraint).
- Enrollment class must offer the chosen group/optional subject (validated against `class_subjects`).
- Section capacity enforced; override needs `enrollment.capacity.override`.
- Promotion to same/lower class = RETAIN path; final class PROMOTE ⇒ GRADUATE (student status update).
- Executing promotion requires target session structure to exist (clone from Module 06 first).

## 7. Validation Rules
- Roll 1–9999. Transfer target section same class+session. Batch cannot execute twice.

## 8. Edge Cases
- Mid-year transfer-in student (from another school) → enrollment `TRANSFERRED_IN`, attendance/fees prorated from enrollment_date.
- Promotion executed then a result correction → rollback blocked once new-session data exists; manual correction endpoints with audit instead.
- Student admitted after promotion executed → normal NEW enrollment in new session.

## 9. Testing Checklist
- [x] Unit: roll uniqueness (DB partial index + P2002 translation), promotion decision engine, rollback reversal, capacity override.
- [x] e2e: single/bulk enroll, capacity + override, transfer with roll reassign, renumber, roster, section delete guard, full promotion build→execute→rollback.
- [x] Frontend: enrollment/promotion validation schemas (roll bounds, transfer target, distinct sessions).

## 10. Completion Checklist
- [x] Entities + APIs + UI
- [x] Canonical section-student service adopted (`getSectionStudents` / `getStudentCurrentEnrollment` exported from EnrollmentModule)
- [x] Tests passing (283 backend unit + 11 enrollment e2e / 107 frontend)
- [x] Docs: `docs/modules/11-enrollment-promotion.md`

---

# Module 12 — Attendance Management

## 1. Goal
Daily attendance for students (per section, optionally per period) and staff/teachers, manual + QR modes, late/leave handling, holiday awareness, absence SMS alerts, and attendance reports.

## 2. Dependencies
- Modules 05 (holidays), 08, 09, 11; Module 17 provides real SMS sending (queue interface exists from 02).

## 3. Database Design
- `student_attendances`: `id`, `school_id`, `enrollment_id FK`, `date DATE`, `period_id NULL` (Module 13; NULL = daily mode), `status ENUM('PRESENT','ABSENT','LATE','LEAVE','HALF_DAY','HOLIDAY')`, `check_in_time NULL`, `method ENUM('MANUAL','QR','IMPORT','AUTO')`, `remarks NULL`, `marked_by`, audit. `uq(enrollment_id, date, period_id)` (with NULLs treated via coalesce index).
- `staff_attendances`: same shape keyed by `staff_id/teacher_id` (`person_type ENUM('TEACHER','STAFF')`, `person_id`), `uq(person_type, person_id, date)`.
- `attendance_settings` (settings group): mode (daily|period), late-after time, half-day rules, SMS-on-absent toggle, SMS time.
- `student_leave_applications`: `id`, `student_id`, `from_date`, `to_date`, `reason`, `applied_by ENUM('GUARDIAN','ADMIN')`, `status`, `approved_by` — approved leave auto-marks LEAVE.

## 4. Backend Tasks (NestJS)
- [x] Bulk mark endpoint: section+date grid submit (upsert semantics; re-mark allowed same day with `attendance.edit` permission, audited).
- [x] QR check-in endpoint: scan `qr_token` → resolves student → marks PRESENT/LATE by time; device-agnostic (any phone camera page).
- [x] Holiday guard: marking on holiday blocked unless override (+ convert-a-marked-date-to-HOLIDAY admin tool).
- [x] Auto-absent job (optional setting): at cutoff time, unmarked students in marked sections → ABSENT.
- [x] Absent-SMS job: after cutoff, batch SMS to primary guardians ("Your child X was absent today") — queued; real send with M17.
- [x] Reports: daily section sheet, monthly register (matrix student × days), student %-summary, staff monthly, late analysis, class-comparison; XLSX/PDF export.
### APIs
```
GET/POST /api/v1/attendance/students     {section_id, date, entries[]}
POST     /api/v1/attendance/qr-checkin   {qr_token}
GET/POST /api/v1/attendance/staff
CRUD     /api/v1/student-leaves (+ approve/reject)
GET      /api/v1/attendance/reports/daily | monthly | student/:id | staff | summary
```

## 5. Frontend Tasks (Next.js)
- [x] Marking page: pick section+date → roster grid (all-present default, tap to toggle A/L/Late, remarks popover), sticky save bar, already-marked banner with edit mode.
- [x] QR scanner page (device camera via the browser's `BarcodeDetector` + manual/USB-scanner fallback; big success/fail feedback + student photo confirmation).
- [x] Staff attendance page (similar grid).
- [x] Leave applications inbox (approve → reports the corrected days).
- [x] Reports pages with month matrix (sticky-column scroll table; virtualization deferred), export buttons, trend sparkline + section comparison table.

## 6. Business Rules
- Attendance cannot be taken for future dates, or dates outside the active session, or holidays (override permission for special classes).
- LATE counts as present for % but tracked separately; threshold from settings.
- Approved student leave overrides ABSENT for those dates (retroactive fix job).
- Attendance % = present+late+half(0.5) ÷ working days since enrollment_date (excludes holidays & pre-enrollment days).
- Editing past attendance beyond N days (setting, default 7) requires elevated permission.

## 7. Validation Rules
- Entries must belong to the section; date valid; status enum; one record per student/date/period.

## 8. Edge Cases
- Section with zero students → friendly empty state, marking disabled.
- Student transferred mid-month → report splits by section correctly (attendance rides on enrollment).
- Duplicate QR scan within 5 min → idempotent "already marked".
- Sudden government holiday declared after marking → admin tool to convert a date to HOLIDAY (audited, recalculates %).
- SMS cost control: absent-SMS deduped per student per day; global daily cap setting.

## 9. Testing Checklist
- [x] Unit: % calculation (mid-entry, transfers, half-days), working-day calendar, holiday guard, edit window, auto-absent + absent-SMS jobs, QR thresholds/dedupe.
- [x] e2e: bulk mark idempotency, holiday guard + override permission, convert-to-holiday, leave retro-fix, reports, XLSX/PDF export, promotion-rollback guard. (QR e2e covers the guard/404 paths; the timing logic is unit-tested — a full scan needs a current-session enrollment the shared dev DB must keep.)
- [x] Frontend: validation schemas + Dhaka date helpers. Grid performance with 100+ students and the scanner on a mobile viewport remain in-browser TODOs.

## 10. Completion Checklist
- [x] Student + staff attendance live
- [x] QR mode working (BarcodeDetector + manual fallback; real-camera click-through pending)
- [x] Reports + exports
- [x] SMS alert job (queued; sends once Module 17 done)
- [x] Tests passing (344 backend unit + 17 attendance e2e / 119 frontend)
- [x] Docs: `docs/modules/12-attendance.md`

---

# Module 13 — Timetable / Class Routine

## 1. Goal
Weekly class routines: period definitions, section timetables mapping period × day → subject + teacher + room, teacher-conflict detection, and printable/portal-visible routines. Also exam routines' foundation (Module 14 reuses period slots).

## 2. Dependencies
- Modules 06, 08, 11.

## 3. Database Design
- `period_slots`: `id`, `school_id`, `shift_id FK`, `name` ("Period 1","Tiffin"), `start_time`, `end_time`, `type ENUM('CLASS','BREAK','ASSEMBLY')`, `display_order`. `uq(shift_id, display_order)`.
- `timetables`: `id`, `school_id`, `session_id`, `section_id FK uq(session)`, `status ENUM('DRAFT','PUBLISHED')`, `effective_from`, audit/soft-delete.
- `timetable_entries`: `id`, `timetable_id FK`, `day ENUM('SAT'..'FRI')`, `period_slot_id FK`, `subject_id FK`, `teacher_id FK`, `room_no NULL`. `uq(timetable_id, day, period_slot_id)`.

## 4. Backend Tasks (NestJS)
- [x] Period slot CRUD per shift (overlap validation).
- [x] Timetable builder endpoints: create draft, upsert entries (bulk), publish.
- [x] Conflict engine: on entry upsert, check teacher not already booked (same session, same day+overlapping slot in any section) and room not double-booked; return conflict details.
- [x] Teacher schedule + workload endpoints (periods/week) — completes Module 08 stub.
- [x] Routine PDF (section) + teacher personal routine PDF.
- [x] `getCurrentPeriod(sectionId, datetime)` helper (used by period attendance).
### APIs
```
CRUD /api/v1/period-slots
GET/POST /api/v1/timetables            PUT /api/v1/timetables/:id/entries (bulk)
POST /api/v1/timetables/:id/publish    GET /api/v1/timetables/conflicts?teacher_id=&day=&slot=
GET  /api/v1/sections/:id/routine      GET /api/v1/teachers/:id/routine
GET  /api/v1/timetables/:id/pdf
```

## 5. Frontend Tasks (Next.js)
- [x] Routine builder: grid (days × periods), cell editor popover (subject → filtered teacher list → room), live conflict badges (red cell + tooltip "Mr. X busy in 7-B"), copy-day, clear-day, publish with validation summary.
- [x] Teacher routine viewer; section routine print view.
- [x] Master routine page: whole-school grid by shift (read-only heat view of teacher load).

## 6. Business Rules
- Only PUBLISHED routines visible in portals.
- Entry subject must be in the section's class-subject map; teacher must be assigned to that section+subject (warning + override).
- BREAK/ASSEMBLY slots can't hold entries.
- Weekly holidays (settings) excluded from day options.
- One active timetable per section per session; publishing a new version archives the old (effective_from history).

## 7. Validation Rules
- Slot times within shift bounds; no overlapping slots per shift.

## 8. Edge Cases
- Two sections legitimately sharing one teacher same slot (combined class) → allowed via explicit `combined_with_section_id` marker rather than override abuse.
- Shift change mid-session → new timetable version; old attendance untouched.
- Teacher leave day → routines don't change; substitution feature deferred to Phase 3 backlog (confirmed at M13 completion — `freeByDay` on the teacher routine is the raw material for it).

## 9. Testing Checklist
- [x] Unit: conflict engine matrix (same slot, overlapping custom slots, cross-shift).
- [x] e2e: build → publish → portal fetch; conflict rejection.
- [x] Frontend: grid interactions, conflict UX (schema-tested; in-browser click-through pending — see completion doc TODOs).

## 10. Completion Checklist
- [x] Slots + builder + conflicts
- [x] PDFs
- [x] Teacher workload finalized
- [x] Tests passing
- [x] Docs: `docs/modules/13-timetable.md`

---

# Module 14 — Examination Management

## 1. Goal
Exam definitions: exam types & terms, exam schedules (routine), mark distribution per subject (CQ/MCQ/Practical, full/pass marks), seat plans, and admit cards — everything needed before mark entry.

## 2. Dependencies
- Modules 05, 06, 11, 13 (slots reused for exam scheduling), 04 (grading systems).

## 3. Database Design
- `exam_types`: `id`, `school_id`, `name` ("Half Yearly","Annual","Class Test","Model Test"), `weight NUMERIC(5,2) NULL` (for combined final results), audit.
- `exams`: `id`, `school_id`, `session_id`, `exam_type_id FK`, `name`, `class_ids` via `exam_classes(exam_id, class_id)`, `start_date`, `end_date`, `grading_system_id FK`, `status ENUM('DRAFT','SCHEDULED','ONGOING','MARK_ENTRY','PROCESSING','PUBLISHED','ARCHIVED')`, `result_publish_at NULL`, audit/soft-delete.
- `exam_subjects`: `id`, `exam_id`, `class_id`, `subject_id`, mark distribution: `full_marks INT`, `pass_marks INT`, `cq_marks NULL`, `mcq_marks NULL`, `practical_marks NULL`, `ca_marks NULL` (continuous assessment), per-component pass flags, `exam_date NULL`, `start_time NULL`, `duration_min NULL`, `room NULL`. `uq(exam_id, class_id, subject_id)`.
- `seat_plans`: `id`, `exam_id`, `room`, `date`; `seat_plan_entries(seat_plan_id, enrollment_id, seat_no)` — generated.

## 4. Backend Tasks (NestJS)
- [ ] Exam type CRUD; exam wizard endpoints (create → attach classes → per class-subject distribution defaults from `class_subjects.full_marks_default` → schedule dates).
- [ ] Exam routine generator/editor + clash checks (same class two subjects same day optional-rule; room capacity vs candidates).
- [ ] Seat plan generator: strategies (roll serpentine across rooms, mixed-class anti-cheating interleave), regenerate, PDF per room + summary.
- [ ] Admit card generation: per student PDF with photo, exam schedule, seat, signature blocks; batch by section; setting "block admit card if dues" (activates after Module 16).
- [ ] Status machine transitions with guards (can't enter MARK_ENTRY before end_date unless override; can't PUBLISH before Module 15 processing complete).
### APIs
```
CRUD /api/v1/exam-types
CRUD /api/v1/exams (+ /:id/classes /:id/subjects /:id/status)
GET/PUT /api/v1/exams/:id/routine
POST /api/v1/exams/:id/seat-plans/generate     GET .../seat-plans/pdf
POST /api/v1/exams/:id/admit-cards             (batch, filters)
```

## 5. Frontend Tasks (Next.js)
- [ ] Exam setup wizard (type → classes → subjects & marks distribution grid → routine calendar → review).
- [ ] Exam list with status pipeline; exam detail tabs (Subjects, Routine, Seat Plan, Admit Cards, Marks [Module 15], Results [15]).
- [ ] Seat plan visual (room boxes with seat chips), regenerate confirm.
- [ ] Admit card batch dialog with dues-block toggle.

## 6. Business Rules
- Pass marks ≤ full marks; component marks sum = full marks when components used.
- An exam's grading system is frozen at PUBLISH (snapshot id + full grade table copied into result data — Module 15).
- Exam dates must lie within session; routine dates within exam start–end.
- Only enrolled ACTIVE students of attached classes are candidates; optional-subject students only sit their chosen optional.

## 7. Validation Rules
- Duration 10–360 min. Room strings ≤ 20 chars. Weight 0–100 across an exam-type set used in combined results must be validated at combine time (Module 15).

## 8. Edge Cases
- Subject added to class after exam created → "sync subjects" action shows diff.
- Student enrolled after seat plan generated → append-to-last-room action + admit card single reissue.
- Postponed exam day (strike/weather — common) → shift-routine tool (moves a date, cascades notifications).

## 9. Testing Checklist
- [ ] Unit: distribution validation, seat plan strategies, status machine.
- [ ] e2e: wizard end-to-end, admit card generation with/without photo.
- [ ] Frontend: distribution grid validation, routine calendar edits.

## 10. Completion Checklist
- [ ] Types, exams, subjects, routine
- [ ] Seat plans + admit cards PDFs
- [ ] Tests passing
- [ ] Docs: `docs/modules/14-examination.md`

---

# Module 15 — Marks & Result Processing

## 1. Goal
Mark entry (per subject/section, component-wise), moderation, GPA/grade calculation, merit positions, tabulation sheet, report cards, transcripts, publish-to-portal/website, and result analytics.

## 2. Dependencies
- Module 14.

## 3. Database Design
- `marks`: `id`, `exam_id`, `exam_subject_id FK`, `enrollment_id FK`, `cq NUMERIC NULL`, `mcq NULL`, `practical NULL`, `ca NULL`, `total NUMERIC` (computed & stored), `is_absent BOOL`, `grade VARCHAR NULL`, `grade_point NUMERIC NULL`, `entered_by`, `status ENUM('DRAFT','SUBMITTED','VERIFIED','LOCKED')`, audit. `uq(exam_subject_id, enrollment_id)`.
- `results`: `id`, `exam_id`, `enrollment_id`, `total_marks NUMERIC`, `obtained_marks NUMERIC`, `gpa NUMERIC(4,2)`, `gpa_without_optional NUMERIC`, `grade`, `failed_subjects INT`, `status ENUM('PASSED','FAILED','INCOMPLETE','WITHHELD')`, `merit_position_section INT NULL`, `merit_position_class INT NULL`, `grading_snapshot JSONB`, `published_at NULL`, audit. `uq(exam_id, enrollment_id)`.
- `result_publications`: `id`, `exam_id`, `published_by`, `published_at`, `channels JSONB` (portal/website/sms), `is_active BOOL` (unpublish support).
- Combined/final result: `combined_results` mirroring `results` with `exam_type weights` snapshot (Annual = 30% Half-Yearly + 70% Annual, configurable).

## 4. Backend Tasks (NestJS)
- [ ] Mark entry endpoints: grid fetch (section+subject roster with existing marks), bulk upsert (DRAFT), submit (teacher), verify (controller/head), lock.
- [ ] Calculation engine (pure, heavily unit-tested):
      component pass rules → subject grade via grading snapshot → NCTB GPA: average of grade points with optional-subject bonus rule (BD: 4th subject points above 2.00 added) → fail if any compulsory subject F → grade from GPA table.
- [ ] Merit ranking: by GPA desc, then total obtained desc, then configurable tiebreak (roll asc); section & class scopes; ties share position (1,2,2,4 style — competition ranking).
- [ ] Processing job (BullMQ): compute all results for exam, idempotent, progress reporting.
- [ ] Report card PDF (per student: subject rows with components, grade, GPA, merit, attendance %, teacher/principal signature blocks, school branding); tabulation sheet XLSX/PDF (full section matrix); transcript (multi-exam).
- [ ] Publish endpoint → portal visibility + website result-search index + optional bulk SMS ("GPA 4.83, Merit 3") — queued.
- [ ] Result analytics: pass rate by class/section/subject, GPA distribution histogram, subject difficulty (avg %), year-over-year comparison.
- [ ] Re-check/correction flow: LOCKED mark change requires `marks.correction` permission + reason; triggers targeted re-processing + republish diff log.
### APIs
```
GET/PUT /api/v1/exams/:examId/marks?section_id=&subject_id=
POST    /api/v1/exams/:examId/marks/submit | verify | lock
POST    /api/v1/exams/:examId/process           GET .../process/status
GET     /api/v1/exams/:examId/results (filters) GET /api/v1/results/:id
POST    /api/v1/exams/:examId/publish | unpublish
GET     /api/v1/exams/:examId/tabulation | report-cards (batch pdf) 
GET     /api/v1/students/:id/transcript?session_id=
GET     /api/v1/exams/:examId/analytics
POST    /api/v1/combined-results/generate {exam_ids, weights}
GET     /api/v1/public/results/search {exam, class, roll|student_uid}   (website)
```

## 5. Frontend Tasks (Next.js)
- [ ] Mark entry grid: keyboard-first (arrow/enter navigation), per-component columns, absent checkbox, live total & out-of-range highlighting, autosave DRAFT, submit/verify/lock actions by role.
- [ ] Processing page with progress bar + error list (e.g., "12 students missing Math marks").
- [ ] Results table (GPA, grade, merit, status chips), student result drawer, publish dialog (channels checkboxes, schedule datetime).
- [ ] Report card preview, batch download; tabulation view; analytics dashboard (charts: pass-rate bars, GPA histogram, subject heatmap).
- [ ] Public website result-search page (exam+class+roll → result card) — ships with Module 19 but API ready here.

## 6. Business Rules
- Marks cannot exceed component/full marks (DB CHECK + DTO).
- Absent ⇒ all components null, total 0, subject grade F (configurable: "Absent" label, counts as fail).
- Processing requires ALL exam_subjects' marks LOCKED (or explicitly waived per subject with permission) — else INCOMPLETE results generated only with override.
- Published results are immutable snapshots; corrections create new publication version with visible changelog.
- Optional (4th) subject never causes overall FAIL.
- WITHHELD status for dues/disciplinary (manual, permission-gated) — hides result in portal/public search.

## 7. Validation Rules
- Numeric marks ≥ 0, ≤ component max, max 2 decimals. Weight sets sum to 100.

## 8. Edge Cases
- Transferred-out student mid-exam → INCOMPLETE, excluded from merit.
- Two students tie fully on all tiebreaks → share merit position.
- Grading system edited after processing → results untouched (snapshot); reprocess uses snapshot unless explicitly reset.
- Practical-only subjects, MCQ-only class tests → distribution flexibility covered.
- Bangla medium report card → bilingual template (EN/BN toggle in settings).

## 9. Testing Checklist
- [ ] Unit: calculation engine golden tests (NCTB fixtures incl. 4th-subject bonus, component fail, absent), ranking ties.
- [ ] e2e: entry→submit→verify→lock→process→publish; correction flow.
- [ ] Frontend: grid keyboard nav, out-of-range guard.
- [ ] Manual: report card PDF matches a real BD school sample.

## 10. Completion Checklist
- [ ] Mark lifecycle + engine
- [ ] Results, merit, tabulation, report cards, transcripts
- [ ] Publish + SMS + public search API
- [ ] Analytics
- [ ] Tests passing
- [ ] Docs: `docs/modules/15-marks-results.md`

---

# Module 16 — Fees & Payments

## 1. Goal
Fee structures, invoicing (monthly + one-off), discounts/waivers/scholarships, collection (cash/bank + SSLCommerz/bKash/Nagad online), receipts, dues tracking, late fines, and collection reports. Also completes the admission payment interface.

## 2. Dependencies
- Modules 09, 11; Module 17 for payment SMS receipts.

## 3. Database Design
- `fee_heads`: `id`, `school_id`, `name` ("Tuition","Exam Fee","Admission","Transport","Session Charge"), `type ENUM('RECURRING_MONTHLY','ONE_TIME','ON_DEMAND')`, `is_refundable BOOL`, audit.
- `fee_structures`: `id`, `school_id`, `session_id`, `class_id`, `group_id NULL`, `fee_head_id FK`, `amount NUMERIC(12,2)`, `due_day INT NULL` (monthly), audit. `uq(session, class, group, fee_head)`.
- `student_fee_overrides`: `id`, `enrollment_id`, `fee_head_id`, `type ENUM('DISCOUNT_PERCENT','DISCOUNT_FLAT','WAIVER','SCHOLARSHIP')`, `value NUMERIC`, `reason`, `approved_by`, `valid_from/to`, audit.
- `invoices`: `id`, `school_id`, `invoice_no uq` (`INV-{YY}{MM}-{SEQ6}`), `enrollment_id FK`, `billing_month DATE NULL`, `subtotal`, `discount_total`, `fine_total`, `paid_total`, `payable` (generated), `status ENUM('UNPAID','PARTIAL','PAID','OVERDUE','CANCELLED','REFUNDED')`, `due_date`, audit. Child `invoice_items(id, invoice_id, fee_head_id, description, amount, discount)`.
- `payments`: `id`, `payment_no uq`, `invoice_id FK`, `amount`, `method ENUM('CASH','BANK','SSLCOMMERZ','BKASH','NAGAD','ROCKET','CHEQUE','ADJUSTMENT')`, `gateway_txn_id NULL uq`, `gateway_payload JSONB NULL`, `status ENUM('PENDING','SUCCESS','FAILED','REFUNDED','CANCELLED')`, `received_by NULL`, `paid_at`, audit.
- `payment_refunds`: `id, payment_id, amount, reason, approved_by, refunded_at`.
- `fines_config` in settings (grace days, flat/percent per month, cap).

## 4. Backend Tasks (NestJS)
- [ ] Fee head/structure CRUD; structure clone-to-session.
- [ ] Invoice generation job: monthly batch (1st of month, prorate from enrollment_date for mid-year joiners), on-demand single/bulk (e.g., exam fee for class 8).
- [ ] Discount engine applied at generation (overrides) + manual line discount with permission.
- [ ] Fine job: nightly, applies late fine per config to OVERDUE invoices (idempotent per month).
- [ ] Collection: offline payment endpoint (cash/bank/cheque) with receipt PDF + SMS; partial payments supported.
- [ ] Gateway integrations (adapter pattern `PaymentGatewayService` → `SslcommerzAdapter`, `BkashAdapter`, `NagadAdapter`):
      init payment (returns redirect/checkout URL), IPN/callback verify (server-to-server validation mandatory), reconcile-by-txn endpoint, sandbox/live mode per settings.
- [ ] Admission payment interface (Module 10) wired to same adapters.
- [ ] Dues ledger per student; clearance-check service (consumed by Modules 09/14/27).
- [ ] Reports: daily collection (by method/collector), monthly summary, dues by class/section (aging buckets), head-wise income, defaulter list export + bulk dues SMS.
### APIs
```
CRUD /api/v1/fee-heads | fee-structures      POST /api/v1/fee-structures/clone
CRUD /api/v1/fee-overrides
POST /api/v1/invoices/generate {scope}       CRUD /api/v1/invoices  (cancel w/ reason)
POST /api/v1/invoices/:id/payments           (offline)
POST /api/v1/payments/online/init            {invoice_id, gateway}
POST /api/v1/payments/callback/:gateway      (@Public, signature-verified)
POST /api/v1/payments/:txn/reconcile
GET  /api/v1/students/:id/dues | ledger
GET  /api/v1/fee-reports/daily|monthly|dues|head-wise|defaulters
GET  /api/v1/payments/:id/receipt.pdf
```

## 5. Frontend Tasks (Next.js)
- [ ] Fee setup pages (heads, structure matrix class × head editable grid, overrides on student profile Fees tab).
- [ ] Invoice generation wizard (scope preview: N invoices, total ৳X).
- [ ] Collection desk: search student → dues list → select invoices → amount → method → confirm → print receipt (thermal-friendly + A5 templates).
- [ ] Invoice list (status filters, aging), invoice detail with payment history and refund action.
- [ ] Portal (student/parent): dues card, invoice list, **Pay Now** → gateway redirect → success/failure pages → receipt download.
- [ ] Reports pages with charts (collection trend, method split, dues aging).

## 6. Business Rules
- Invoice regeneration for same enrollment+month blocked (idempotency key).
- Payment > payable blocked; overpayment path = advance adjustment invoice item (explicit, permission-gated).
- Gateway payment marked SUCCESS **only after server-side validation API confirms** (never trust redirect params).
- Cancelling a PAID invoice requires refund first. Receipts immutable; corrections via refund + new payment.
- Waivers require approval permission; all monetary overrides audited with reason.

## 7. Validation Rules
- Amounts > 0, 2 decimals. Due date ≥ invoice date. Callback signature/hash verified per gateway spec; txn_id unique.

## 8. Edge Cases
- IPN retries/duplicates → idempotent by `gateway_txn_id`.
- Callback lost (user closed bKash app) → PENDING payment; reconciliation cron queries gateway status hourly for PENDING > 15 min.
- Partial month enrollment & transport mid-month opt-in → proration rules documented in settings.
- Sibling combined payment → multi-invoice checkout (single gateway session covering selected invoices across siblings of one guardian).
- Refund limits per gateway (bKash refund window) → surfaced errors.

## 9. Testing Checklist
- [ ] Unit: proration, fine idempotency, discount stacking order (percent then flat, cap at amount), status transitions.
- [ ] e2e: generate→collect offline→receipt; sandbox online flow per gateway (mock adapters in CI, real sandbox manually).
- [ ] Frontend: collection desk flow, portal payment redirect handling.
- [ ] Manual: SSLCommerz/bKash/Nagad sandbox end-to-end incl. failure & cancel paths.

## 10. Completion Checklist
- [ ] Structures, invoicing, fines, collection
- [ ] All three gateways sandbox-verified + reconciliation
- [ ] Receipts + reports
- [ ] Admission payments wired
- [ ] Tests passing
- [ ] Docs: `docs/modules/16-fees-payments.md`

---

# Module 17 — Communication & Notifications

## 1. Goal
Unified notification service: SMS (BD gateway), email, in-app notifications; template management with variables; notices & circulars; bulk sends (birthday wishes, emergency alerts); delivery tracking and SMS credit accounting.

## 2. Dependencies
- Modules 02 (queue), 04 (gateway settings), 09.

## 3. Database Design
- `notification_templates`: `id`, `school_id`, `code` ("ABSENT_ALERT","RESULT_PUBLISHED","FEE_RECEIPT","ADMISSION_SELECTED","BIRTHDAY"…), `channel ENUM('SMS','EMAIL','IN_APP')`, `subject NULL`, `body TEXT` (handlebars vars: `{{student_name}}`), `language ENUM('EN','BN')`, `is_active`, audit. `uq(school_id, code, channel, language)`.
- `notifications`: `id`, `school_id`, `channel`, `recipient_type ENUM('USER','GUARDIAN','STUDENT','STAFF','RAW')`, `recipient_id NULL`, `destination` (phone/email), `template_code NULL`, `payload JSONB`, `body_rendered TEXT`, `status ENUM('QUEUED','SENT','DELIVERED','FAILED','CANCELLED')`, `provider_msg_id NULL`, `error NULL`, `cost NUMERIC(8,4) NULL`, `sent_at`, `created_at`. Monthly partition-ready.
- `notices`: `id`, `school_id`, `title`, `body RICHTEXT`, `audience ENUM('ALL','STUDENTS','PARENTS','TEACHERS','STAFF','CLASS','SECTION')`, `audience_ref JSONB NULL`, `attachment_urls JSONB`, `is_published`, `publish_at`, `is_website_visible BOOL`, `pinned BOOL`, audit/soft-delete.
- `sms_credits`: ledger `id, school_id, type ENUM('PURCHASE','CONSUME','ADJUST'), qty INT, balance_after INT, ref, created_at`.

## 4. Backend Tasks (NestJS)
- [ ] `NotificationService.send(code, recipient, vars, channel[])` — single entry point all modules call; renders template, enqueues, respects quiet hours (setting, e.g. no SMS 21:00–08:00 except EMERGENCY).
- [ ] SMS provider adapter interface + one concrete BD adapter (configurable HTTP gateway: url, params mapping, masking/non-masking sender id) + delivery-report webhook.
- [ ] Email via SMTP (nodemailer) with MJML/handlebars templates.
- [ ] In-app notifications: table-backed + `GET /notifications` + unread badge (polling now; SSE/WebSocket in Phase 3).
- [ ] Bulk composer: audience resolver (all parents of class 7, defaulters list, custom numbers CSV) → preview count & SMS cost estimate → confirm → chunked queue (rate-limited to provider caps).
- [ ] Scheduled: birthday-wish daily job; scheduled notices publisher.
- [ ] Credit accounting: decrement per SMS part (Bangla = UCS-2, 70 chars/part — compute parts correctly!), low-balance alert to admin.
- [ ] Notices CRUD; portal + website feeds.
### APIs
```
CRUD /api/v1/notification-templates (+ POST /:id/preview)
POST /api/v1/notifications/send | bulk        GET /api/v1/notifications (log, filters)
POST /api/v1/webhooks/sms-dlr                  (@Public, secret-key verified)
GET  /api/v1/notifications/me  PUT /me/read
CRUD /api/v1/notices (+ publish)
GET  /api/v1/sms-credits/balance | ledger      POST /adjust
```

## 5. Frontend Tasks (Next.js)
- [ ] Template manager (variable helper chips, EN/BN tabs, live preview with sample data, SMS part counter).
- [ ] Bulk send wizard (audience builder → message → cost estimate → confirm) + send log with status/DLR chips and retry-failed action.
- [ ] Notices manager + rich text editor + attachments; portal notice board; header bell dropdown (in-app).
- [ ] SMS credit dashboard (balance, monthly usage chart).

## 6. Business Rules
- All module-originated messages must go through NotificationService (no direct gateway calls) — enforced by convention & code review.
- EMERGENCY priority bypasses quiet hours and rate spreading.
- Failed SMS auto-retry ×2 with backoff, then FAILED (visible, manually retryable).
- Bulk sends > threshold (setting, default 500) require `notification.bulk.large` permission.
- Bangla body → part calculation switches to 70-char segments; UI warns on cost jump.

## 7. Validation Rules
- Template variables validated against per-code allowed set. Phone normalization before send. Attachment ≤ 5 MB.

## 8. Edge Cases
- Provider down → circuit breaker pauses queue, admin alert, auto-resume on health.
- DLR arrives before send-ack recorded → upsert-safe webhook.
- Duplicate bulk submit (double-click) → idempotency key per composer session.
- Guardian with two children absent same day → merge into single SMS (dedupe window by destination+template).

## 9. Testing Checklist
- [ ] Unit: Bangla/Unicode part counting, quiet hours, dedupe merge, credit ledger math.
- [ ] e2e: send→DLR→status update; bulk chunking; notice publish→portal visibility.
- [ ] Manual: real gateway sandbox with masking sender.

## 10. Completion Checklist
- [ ] NotificationService adopted by Modules 10/12/15/16 (retro-wire their queued events)
- [ ] SMS/Email/In-app all functional
- [ ] Templates + bulk + credits
- [ ] Tests passing
- [ ] Docs: `docs/modules/17-communication.md`

---

# Module 18 — Portals & Dashboards + Reports v1  *(Phase 1 capstone)*

## 1. Goal
Assemble role-specific experiences from existing APIs: Student Portal, Parent Portal, Teacher Portal, Accountant workspace, Principal/Admin dashboard — plus the consolidated Reports v1 index. Mostly frontend composition + a few aggregate endpoints.

## 2. Dependencies
- Modules 02–17.

## 3. Database Design
- No new business tables. Optional `dashboard_snapshots` cache table (`school_id, key, data JSONB, computed_at`) for expensive aggregates (nightly job).

## 4. Backend Tasks (NestJS)
- [ ] Aggregate endpoints (each cached 5–15 min):
```
GET /api/v1/dashboard/admin      {students{total,byClass}, todayAttendance%, feeCollection{today,month,duesTotal}, pendingAdmissions, teacherAttendanceToday, recentNotices, upcomingEvents, resultStats}
GET /api/v1/portal/student/overview     (me-scoped: routine today, attendance %, latest result, dues, notices, assignments placeholder)
GET /api/v1/portal/parent/overview      (per child cards)
GET /api/v1/portal/teacher/overview     (today's periods, my sections, pending mark entries, notices)
GET /api/v1/dashboard/accountant        (today collection by method, pending invoices, monthly trend)
```
- [ ] "Me-scope" guards: student/parent tokens can only access own/children data — dedicated `OwnershipGuard` (parent→children via student_guardians) applied to every portal route retroactively verified.
- [ ] Reports index registry: every existing report registered with code, permission, params schema → `GET /api/v1/reports` powers a unified Reports page.

## 5. Frontend Tasks (Next.js)
- [ ] `(portal)` layouts per user_type with tailored nav.
- [ ] Student portal pages: Overview, Profile, Routine, Attendance (calendar heat view), Results (+ report card download), Payments/Dues (+ Pay Now), Notices, Documents/Certificates (downloads).
- [ ] Parent portal: child switcher, mirrors student pages + SMS history + contact-school form (creates complaint ticket in Module 28 — stub as message to admin inbox now).
- [ ] Teacher portal: Today view, My Routine, Take Attendance shortcut, Mark Entry shortcut, My Students (performance snapshot), Leaves, Notices.
- [ ] Principal/Admin dashboard: stat cards + charts (attendance trend 30d, collection trend, class-wise strength, GPA distribution last exam), quick links, activity feed (audit tail).
- [ ] Accountant workspace home.
- [ ] Reports hub page: searchable catalog of all reports with param forms + export.
- [ ] Full responsive & accessibility pass (keyboard nav, contrast, focus states) across portals.

## 6. Business Rules
- Portal users see only PUBLISHED artifacts (routines, results, notices targeted to them).
- Parent with multiple children in school → single account, child switcher (link children by guardian).
- Dues visibility: parents always see; students see per setting.

## 7. Validation Rules
- Ownership guard on every `:id` the portal touches (IDOR prevention) — checklist per endpoint in completion doc.

## 8. Edge Cases
- Guardian of a TRANSFERRED child → child card read-only historical.
- Brand-new school mid-setup → dashboards render zero-states gracefully.
- Teacher with no assignments → onboarding empty state with instructions.

## 9. Testing Checklist
- [ ] e2e security suite: portal IDOR attempts (student A → student B data) all 403.
- [ ] Frontend: portal flows on mobile viewport (parents are mobile-first users).
- [ ] Load: admin dashboard aggregate < 500 ms cached.

## 10. Completion Checklist
- [ ] All five experiences shipped
- [ ] Ownership/IDOR audit complete
- [ ] Reports hub
- [ ] **Phase 1 MVP demo-ready end-to-end** (scripted demo: admission→enrollment→attendance→exam→result→fee→SMS)
- [ ] Docs: `docs/modules/18-portals-dashboards.md`

---

# Module 19 — Website CMS (Public Site)  *(Phase 2 begins)*

## 1. Goal
The school's public website: dynamic CMS pages (about, principal message, committee, history, mission/vision), notices/news/events feeds, gallery, teacher/staff directory, achievements, downloads, career, contact, FAQ — plus the live integrations already API-ready: online admission, result search, student & certificate verification. SEO-first, fast, mobile responsive.

## 2. Dependencies
- Modules 04, 05, 10, 15, 17; Module 27 completes certificate verification (endpoint stub now).

## 3. Database Design
- `cms_pages`: `id`, `school_id`, `slug uq(school)`, `title`, `title_bn`, `content RICHTEXT/JSON blocks`, `meta_title`, `meta_description`, `og_image_url`, `status ENUM('DRAFT','PUBLISHED')`, `template ENUM('DEFAULT','LANDING','CONTACT')`, audit/soft-delete.
- `news_posts`: `id`, `school_id`, `slug`, `title`, `excerpt`, `content`, `cover_url`, `category ENUM('NEWS','BLOG','ACHIEVEMENT')`, `published_at`, `status`, audit/soft-delete.
- `galleries`: `id, school_id, title, event_date, cover_url, status` + `gallery_items(id, gallery_id, type ENUM('IMAGE','VIDEO_URL'), url, caption, display_order)`.
- `downloads`: `id, school_id, title, category, file_url, size_bytes, download_count, status`, audit.
- `careers`: `id, school_id, title, description, deadline, status`, + applications (name, phone, email, cv_url).
- `faqs`: `id, school_id, question, answer, category, display_order`.
- `committee_members`: `id, school_id, name, designation, photo_url, message NULL, display_order`.
- `contact_messages`: `id, school_id, name, phone, email, subject, body, status ENUM('NEW','READ','REPLIED'), created_at`.
- Website settings group: hero slides JSONB, quick links, footer, social URLs, Google Maps embed, reCAPTCHA keys, analytics ID.

## 4. Backend Tasks (NestJS)
- [ ] CRUD for all entities above (admin-guarded) + `@Public()` read endpoints (published only), all cached (Redis 60 s) and rate-limited.
- [ ] Public composite endpoints: `GET /public/home` (hero, latest notices/news/events, stats, gallery preview), `GET /public/teachers` (directory: name, designation, photo, qualifications summary — no personal contacts), `GET /public/notices|news|events` (paginated, searchable).
- [ ] Result search endpoint (from Module 15) + student verification: `POST /public/verify/student {student_uid|qr_token}` → returns name, class, status, photo (privacy-limited fields; toggle in settings).
- [ ] Contact form (reCAPTCHA verified) → contact_messages + admin notification.
- [ ] Download counter increment; career application upload (CV pdf ≤ 5 MB).
- [ ] Sitemap.xml + robots.txt generation endpoints; RSS for news.
### APIs (admin)
```
CRUD /api/v1/cms/pages | news | galleries | downloads | careers | faqs | committee
GET  /api/v1/cms/contact-messages (+ PUT /:id/status)
```

## 5. Frontend Tasks (Next.js — `(public)` route group, SSR/ISR)
- [ ] Rendering strategy: ISR (revalidate 60 s) for content pages; SSR for search/verification; static for shells.
- [ ] Pages: Home (hero slider, notice ticker, stats, news/events, gallery strip, principal message teaser), About/History/Mission (CMS pages), Principal Message, Managing Committee, Teacher & Staff Directory, Notice Board (search+filter+attachment download), News/Blog (+detail), Events + Academic Calendar (public events only), Gallery (+lightbox), Achievements, Downloads, Career (+apply form), FAQ, Contact (form + map), Admission portal (Module 10 pages linked), Result Search, Student Verification, Certificate Verification (stub UI until Module 27).
- [ ] SEO: metadata API per page, OpenGraph, JSON-LD (Organization/School), canonical URLs, Bangla `lang` handling; Lighthouse targets: Performance ≥ 90, SEO ≥ 95, A11y ≥ 90 mobile.
- [ ] Image optimization (`next/image` + S3 loader), skeletons, 404/500 branded pages.
- [ ] Optional Bangla/English site language toggle (content fields already dual).

## 6. Business Rules
- Only PUBLISHED + `is_website_visible` content served publicly; drafts previewable via signed preview token.
- Verification endpoints heavily rate-limited (10/min/IP) + reCAPTCHA to prevent scraping.
- Teacher directory shows only opted-in/active teachers; no phone/email exposure.

## 7. Validation Rules
- Slug kebab-case unique; reserved slugs blocked (admin, api, portal…). Upload types whitelisted.

## 8. Edge Cases
- School with no content yet → tasteful defaults, hide empty sections.
- Very large galleries → paginated item loading.
- Result search during publish spike (result day!) → cached result payloads, queue-backed search, CDN headers; load-test this path.

## 9. Testing Checklist
- [ ] e2e: public endpoints leak no unpublished/private data (dedicated privacy test suite).
- [ ] Lighthouse CI budget check.
- [ ] Manual: result-day load simulation (k6, 200 rps on result search).

## 10. Completion Checklist
- [ ] All public pages + CMS admin
- [ ] SEO + performance budgets met
- [ ] Verification & result search live
- [ ] Docs: `docs/modules/19-website-cms.md`

---

# Module 20 — Accounting & Finance

## 1. Goal
Double-entry accounting: chart of accounts, vouchers (debit/credit/journal/contra), auto-posting from fees & payroll, cash/bank books, ledgers, trial balance, income statement, balance sheet, and budgets.

## 2. Dependencies
- Module 16 (fee postings); Module 21 consumes salary posting hooks.

## 3. Database Design
- `account_groups` (fixed tree: Assets, Liabilities, Equity, Income, Expense) → `accounts`: `id`, `school_id`, `group`, `parent_id NULL` (tree), `code uq(school)`, `name`, `type ENUM('CASH','BANK','RECEIVABLE','PAYABLE','INCOME','EXPENSE','EQUITY','OTHER')`, `opening_balance NUMERIC`, `is_system BOOL` (auto-posting targets), `is_active`, audit/soft-delete.
- `vouchers`: `id`, `school_id`, `voucher_no uq` (`DV/CV/JV/CN-{YY}-{SEQ}` per type), `type ENUM('DEBIT','CREDIT','JOURNAL','CONTRA')`, `date`, `narration`, `reference NULL` (invoice/payroll id), `source ENUM('MANUAL','FEES','PAYROLL','INVENTORY','ADMISSION')`, `status ENUM('DRAFT','POSTED','CANCELLED')`, `posted_by`, audit.
- `voucher_entries`: `id`, `voucher_id FK`, `account_id FK`, `debit NUMERIC DEFAULT 0`, `credit NUMERIC DEFAULT 0`, `chk(debit=0 OR credit=0)`, `chk(debit+credit>0)`.
- `budgets`: `id, school_id, session_id, account_id, amount, period ENUM('YEARLY','MONTHLY')` + actual-vs-budget derived.
- `fiscal_periods`: `id, school_id, name, start_date, end_date, status ENUM('OPEN','CLOSED')`.

## 4. Backend Tasks (NestJS)
- [ ] COA CRUD with seeded BD-school default tree (Tuition Income, Exam Fee Income, Salary Expense, Utilities, Bank accounts, Cash in Hand…).
- [ ] Voucher service: create/post (validates Σdebit = Σcredit, period OPEN), cancel (reversal voucher, never delete POSTED), numbering per type.
- [ ] Auto-posting listeners: `payment.success` → Dr Cash/Bank-or-Gateway, Cr Fee Income (per head→account mapping table); `payment.refunded` reversal; payroll disbursed (Module 21) → Dr Salary Expense, Cr Bank; mapping config UI-driven.
- [ ] Reports (all: date-range, PDF/XLSX): Cash Book, Bank Book (per bank account), General Ledger (per account, running balance), Trial Balance, Income Statement, Balance Sheet, Receipts & Payments, Budget vs Actual.
- [ ] Period close: locks vouchers ≤ end_date; closing entries optional.
### APIs
```
CRUD /api/v1/accounts        GET /api/v1/accounts/tree
CRUD /api/v1/vouchers (+ /:id/post /:id/cancel)
GET/PUT /api/v1/accounting/posting-map
GET  /api/v1/accounting/reports/cash-book|bank-book|ledger|trial-balance|income-statement|balance-sheet|budget-vs-actual
CRUD /api/v1/budgets | fiscal-periods (+ /:id/close)
```

## 5. Frontend Tasks (Next.js)
- [ ] COA tree manager (drag nesting, code auto-suggest).
- [ ] Voucher entry screen: date, type, dynamic Dr/Cr rows with account autocomplete, live balance indicator (must hit 0 to post), attachment upload, print voucher.
- [ ] Posting-map settings page (fee head → income account; gateway → bank/clearing account).
- [ ] Report pages: parameter bar + tabular results + drill-down (trial balance row → ledger → voucher), export/print.
- [ ] Budget editor + variance dashboard.

## 6. Business Rules
- Every POSTED voucher balances exactly; unbalanced cannot post (DB-level trigger safety net + service check).
- POSTED vouchers immutable — corrections via reversal + new voucher.
- Auto vouchers are system-source; manual edits forbidden (cancel/reverse only).
- No posting into CLOSED periods (override: reopen with `accounting.period.reopen` + audit).
- Cash account can't go negative (setting-toggleable hard/soft check).

## 7. Validation Rules
- Voucher date within an OPEN fiscal period & not future beyond N days. Account leaf-only posting (no group-node entries). Amount 2 decimals.

## 8. Edge Cases
- Gateway settlements: bKash pays out T+1 net of charges → clearing account pattern + settlement entry tool (record charges as expense).
- Backdated fee payment after period close → posts to open period with note (BD practice) — documented behavior.
- Opening balances mid-year adoption → opening balance journal wizard.

## 9. Testing Checklist
- [ ] Unit: balance validation, reversal integrity, report math (fixtures with known trial balance).
- [ ] e2e: payment event → auto voucher → appears in cash book & income statement.
- [ ] Frontend: voucher grid UX, drill-down chain.

## 10. Completion Checklist
- [ ] COA + vouchers + auto-posting
- [ ] All seven reports reconcile on fixture data
- [ ] Period close
- [ ] Docs: `docs/modules/20-accounting.md`

---

# Module 21 — HR & Payroll

## 1. Goal
Consolidated HR (unified employee view over teachers+staff, leave management proper, increments) and payroll: salary structures, allowances/deductions, bonuses (incl. festival bonus), provident fund, tax, monthly salary generation, payslips, disbursement, and payroll reports — with attendance/leave integration and accounting posting.

## 2. Dependencies
- Modules 07, 08, 12, 20.

## 3. Database Design
- `leave_types`: `id, school_id, name, code, annual_quota NUMERIC, carry_forward BOOL, max_carry NUMERIC, is_paid BOOL, applicable_to ENUM('ALL','TEACHER','STAFF')`.
- `leave_balances`: `id, person_type, person_id, session_id, leave_type_id, allocated, used, carried` (uq per person/type/session).
- `leave_applications`: supersedes Module 08 interim table (migration moves data): `id, person_type, person_id, leave_type_id, from_date, to_date, half_day BOOL, days NUMERIC, reason, status ENUM('PENDING','APPROVED','REJECTED','CANCELLED'), approver_chain JSONB, approved_by, attachment_url NULL`, audit.
- `salary_structures`: `id, school_id, name, basic NUMERIC` + `salary_components(id, structure_id, name, type ENUM('ALLOWANCE','DEDUCTION'), calc ENUM('FLAT','PERCENT_OF_BASIC'), value NUMERIC, is_taxable BOOL, is_pf_base BOOL)` — e.g., House Rent 40%, Medical flat, PF deduction %.
- `employee_salaries`: `id, person_type, person_id, structure_id, basic_override NULL, effective_from, bank_account JSONB NULL, payment_mode ENUM('BANK','CASH','MOBILE_BANKING')`, audit. History kept (no update-in-place; new row per change).
- `payroll_runs`: `id, school_id, month DATE, status ENUM('DRAFT','GENERATED','APPROVED','DISBURSED','CANCELLED'), generated_by, approved_by, disbursed_at`, `uq(school_id, month)`.
- `payslips`: `id, payroll_run_id, person_type, person_id, gross, total_allowances, total_deductions, attendance_deduction, tax, pf_employee, pf_employer, bonus, net_payable, days_present, days_leave_paid, days_absent, breakdown JSONB, status ENUM('PENDING','PAID','HELD')`, audit.
- `bonus_runs`: `id, school_id, name ("Eid-ul-Fitr Bonus 2027"), type ENUM('FESTIVAL','PERFORMANCE','OTHER'), basis ENUM('PERCENT_OF_BASIC','FLAT'), value, month_paid_with NULL`.
- `pf_ledger`: `id, person_id, person_type, month, employee_amt, employer_amt, balance_after` (+ withdrawal records).

## 4. Backend Tasks (NestJS)
- [ ] Leave: type CRUD, yearly balance allocation job, apply/approve flow (quota check, overlap check), calendar integration (approved leave → attendance LEAVE marks, paid/unpaid flag).
- [ ] Salary structure & assignment CRUD (history-preserving).
- [ ] Payroll generation engine: for month M — base from structure, prorate by joining/exit date, unpaid-leave & absent deductions (working-days aware via Module 05 holidays), bonuses attached to run, PF both sides, tax (simple slab config in settings — BD income tax slabs configurable), rounding rules → payslips DRAFT.
- [ ] Approval → lock; disbursement marking (bulk + per person), bank advice sheet XLSX export, payslip PDFs + SMS/email dispatch.
- [ ] Accounting hook: on DISBURSED → salary expense/PF payable/tax payable vouchers via posting map.
- [ ] Reports: monthly payroll register, PF ledger, tax deduction summary, salary-grade distribution, YTD per employee.
### APIs
```
CRUD /api/v1/leave-types | leave-applications (+ approve/reject/cancel)  GET /api/v1/leave-balances/:person
CRUD /api/v1/salary-structures       PUT /api/v1/employees/:id/salary
POST /api/v1/payroll-runs {month}    POST /:id/generate|approve|disburse|cancel
GET  /api/v1/payroll-runs/:id/payslips     GET /api/v1/payslips/:id/pdf
CRUD /api/v1/bonus-runs
GET  /api/v1/payroll/reports/register|pf|tax|ytd
```

## 5. Frontend Tasks (Next.js)
- [ ] Leave: my-leave (portal) apply form with balance display, approval inbox, team calendar view.
- [ ] Structure builder (component rows with live sample calculation preview).
- [ ] Payroll run wizard: month → generate → review grid (per-person expandable breakdown, edit-with-reason on DRAFT) → approve → disburse (checklist + bank advice download).
- [ ] Payslip viewer/PDF; employee self-service payslip history in portal.
- [ ] Reports pages.

## 6. Business Rules
- One payroll run per month; regeneration only while DRAFT (wipes DRAFT payslips).
- Absent deduction = basic/working-days × absent-days (config: basic vs gross base).
- Festival bonus eligibility: min service months setting; prorated option.
- HELD payslips (disciplinary) excluded from disbursement & voucher until released.
- Approved payroll immutable; corrections next month via adjustment component (audited).

## 7. Validation Rules
- PERCENT components 0–100. Effective_from ≤ run month. Bank fields required when mode=BANK.

## 8. Edge Cases
- Mid-month joiner/exit proration; unpaid leave spanning months; teacher who is also exam-committee (allowance one-off) → ad-hoc payslip line with reason.
- MPO-affiliated teachers (govt pays part) → structure supports zero-basic + school-paid allowances only.
- Attendance not finalized when generating → warning listing unmarked days; generation allowed with `payroll.generate.force`.

## 9. Testing Checklist
- [ ] Unit: engine golden fixtures (proration, unpaid leave, PF, tax slabs, rounding).
- [ ] e2e: full run lifecycle; accounting vouchers created on disburse.
- [ ] Frontend: run wizard states; payslip PDF sample verified.

## 10. Completion Checklist
- [ ] Leave system migrated & unified
- [ ] Payroll engine + payslips + disbursement
- [ ] Accounting integration
- [ ] Docs: `docs/modules/21-hr-payroll.md`

---

# Module 22 — Assignments & Homework

## 1. Goal
Teachers publish assignments/homework and learning materials (class notes) to sections; students view/submit (file or text); teachers evaluate with marks/feedback; parents see status.

## 2. Dependencies
- Modules 08, 11, 17, 18 (portals).

## 3. Database Design
- `assignments`: `id`, `school_id`, `session_id`, `section_id FK`, `subject_id FK`, `teacher_id FK`, `type ENUM('ASSIGNMENT','HOMEWORK')`, `title`, `instructions RICHTEXT`, `attachment_urls JSONB`, `assigned_at`, `due_at`, `full_marks INT NULL`, `allow_late BOOL`, `status ENUM('DRAFT','PUBLISHED','CLOSED')`, audit/soft-delete.
- `assignment_submissions`: `id`, `assignment_id FK`, `enrollment_id FK`, `text_answer NULL`, `attachment_urls JSONB`, `submitted_at`, `is_late BOOL`, `marks NUMERIC NULL`, `feedback NULL`, `evaluated_by NULL`, `evaluated_at NULL`, `status ENUM('SUBMITTED','RESUBMITTED','EVALUATED','RETURNED')`. `uq(assignment_id, enrollment_id)`.
- `learning_materials`: `id, school_id, session_id, section_id NULL (null=class-wide), class_id, subject_id, teacher_id, title, description, file_urls JSONB, type ENUM('NOTE','SLIDE','VIDEO_URL','LINK','OTHER')`, audit/soft-delete.

## 4. Backend Tasks (NestJS)
- [ ] Teacher-scoped CRUD (only own sections/subjects — policy check against teacher_section_subjects).
- [ ] Publish → notification to section students/parents (template `ASSIGNMENT_NEW`), due-soon reminder job (24 h before).
- [ ] Submission endpoints (student-owned), late detection, resubmission per setting.
- [ ] Evaluation bulk grid endpoint; return-for-revision flow.
- [ ] Files: student uploads ≤ 10 MB × 3, pdf/doc/img; virus-scan hook placeholder (ClamAV container optional).
- [ ] Stats: per-assignment submission %, per-student pending list (feeds portals).
### APIs
```
CRUD /api/v1/assignments (+ /:id/publish /:id/close)
GET  /api/v1/assignments/:id/submissions      PUT /api/v1/submissions/:id/evaluate|return
POST /api/v1/portal/assignments/:id/submit    GET /api/v1/portal/assignments (me)
CRUD /api/v1/learning-materials
```

## 5. Frontend Tasks (Next.js)
- [ ] Teacher portal: assignment list per section, create form (rich text + attachments + due picker), submissions review table (status chips, inline mark+feedback, download-all zip).
- [ ] Student portal: assignments list (due badges, pending/submitted/evaluated tabs), detail + submit form, materials library (filter by subject).
- [ ] Parent portal: child's pending/late overview.

## 6. Business Rules
- Students submit only for own enrollment & only PUBLISHED, non-CLOSED assignments; late only if `allow_late`.
- Marks ≤ full_marks; evaluation editable until CLOSED, then locked.
- Teacher sees only own; head/admin see all (permission).

## 7. Validation Rules
- due_at > assigned_at; title ≤ 200 chars; VIDEO_URL/LINK must be valid https URLs (YouTube/Drive whitelist setting).

## 8. Edge Cases
- Student transfers section mid-assignment → old submissions retained, new section's assignments apply forward.
- Teacher reassigned → new teacher inherits evaluation rights for that section-subject.
- Zero-submission auto-close reminder to teacher after due+3d.

## 9. Testing Checklist
- [ ] Unit: ownership policies, late flag.
- [ ] e2e: publish→notify→submit→evaluate cycle; IDOR attempts on submissions.
- [ ] Frontend: upload constraints, tabs/status filters.

## 10. Completion Checklist
- [ ] Full cycle live in portals
- [ ] Notifications wired
- [ ] Docs: `docs/modules/22-assignments.md`

---

# Module 23 — Library Management

## 1. Goal
Book catalog (categories, authors, publishers), copies with barcode/QR, member management (students/teachers), issue/return/renew, fines, and library reports.

## 2. Dependencies
- Modules 08, 09; Module 16 (fine collection into fees, optional link) & 24 (books as assets, informational link).

## 3. Database Design
- `book_categories`, `authors`, `publishers`: simple masters (id, school_id, name, audit/soft-delete).
- `books`: `id`, `school_id`, `title`, `title_bn`, `isbn NULL`, `category_id`, `publisher_id NULL`, `edition`, `language`, `price NUMERIC NULL`, `cover_url`, `rack_no`, `description`, audit/soft-delete; `book_authors(book_id, author_id)`.
- `book_copies`: `id`, `book_id FK`, `accession_no uq(school)` (barcode value), `status ENUM('AVAILABLE','ISSUED','RESERVED','LOST','DAMAGED','WITHDRAWN')`, `condition`, `added_at`, audit.
- `library_members`: `id, school_id, person_type ENUM('STUDENT','TEACHER','STAFF'), person_id, card_no uq, max_books INT (from policy), status`, audit. `uq(person_type, person_id)`.
- `book_issues`: `id`, `copy_id FK`, `member_id FK`, `issued_at`, `due_at`, `returned_at NULL`, `renew_count INT DEFAULT 0`, `fine_amount NUMERIC DEFAULT 0`, `fine_paid BOOL`, `fine_waived_by NULL`, `issued_by`, `returned_to NULL`, `remarks`. Partial index: one open issue per copy.
- Policy settings: loan days (student 7 / teacher 14), max renews, fine/day, max books.

## 4. Backend Tasks (NestJS)
- [ ] Masters + book CRUD; bulk copy generation (N copies → sequential accession numbers); barcode label PDF sheets (Code128).
- [ ] Member auto-provision on first issue (or explicit enroll); card printing.
- [ ] Circulation desk endpoints: issue (scan accession + member card/UID), return (auto fine calc: overdue days × rate, holiday-aware option), renew (limit + no-reservation check), mark lost/damaged (fine = book price × multiplier setting).
- [ ] Fine handling: collect at desk (creates library income record; optional voucher via posting map) or waive (permission).
- [ ] Reports: issued/overdue lists (+ overdue SMS job weekly), popular titles, category stock, member history, stock-check (physical verification mode: scan-all, diff report).
### APIs
```
CRUD /api/v1/library/categories|authors|publishers|books
POST /api/v1/library/books/:id/copies {count}      GET /copies/:accession
CRUD /api/v1/library/members
POST /api/v1/library/issue | return | renew        POST /copies/:id/mark-lost
POST /api/v1/library/fines/:issueId/collect|waive
GET  /api/v1/library/reports/overdue|popular|stock|member/:id
```

## 5. Frontend Tasks (Next.js)
- [ ] Catalog manager (book form with author multi-select, cover upload; copies tab with status chips, label print).
- [ ] Circulation desk screen: keyboard/scanner-first (accession input autofocus → book card; member input → member card with current issues & fines), big Issue/Return buttons, fine prompt on overdue return.
- [ ] OPAC (search) page in student/teacher portal: availability badge, my-issues list with due dates.
- [ ] Reports + overdue dashboard.

## 6. Business Rules
- Member over max_books or with unpaid fine > threshold → issue blocked (override permission).
- Copy must be AVAILABLE to issue; LOST copies excluded from stock counts; renew blocked if overdue.
- Student leaving school (status change) → library clearance check hooks into Module 09 clearance service.

## 7. Validation Rules
- ISBN-10/13 checksum if provided; accession pattern from settings; fine ≥ 0.

## 8. Edge Cases
- Damaged-on-return dispute → condition note + partial fine with reason.
- Same title different editions → separate books (guideline in UI helper text).
- Barcode scanner sends Enter suffix → desk inputs handle it.

## 9. Testing Checklist
- [ ] Unit: fine calculator (holiday-aware), issue guards.
- [ ] e2e: issue→renew→overdue return→fine collect; clearance block.
- [ ] Manual: real barcode scanner desk test.

## 10. Completion Checklist
- [ ] Catalog + circulation + fines + reports
- [ ] Portal OPAC
- [ ] Docs: `docs/modules/23-library.md`

---

# Module 24 — Inventory & Assets

## 1. Goal
School assets (furniture, computers, lab equipment) and consumable stock (stationery): suppliers, purchases, stock levels, issue/return to departments-rooms-persons, asset lifecycle, and inventory reports.

## 2. Dependencies
- Module 07 (departments/staff); Module 20 (purchase expense posting, optional).

## 3. Database Design
- `suppliers`: `id, school_id, name, contact_person, phone, email, address, status`, audit/soft-delete.
- `item_categories` (tree) → `items`: `id, school_id, name, code uq, category_id, type ENUM('ASSET','CONSUMABLE'), unit ENUM('PCS','BOX','REAM','SET','LITER','KG','OTHER'), reorder_level INT NULL, description`, audit/soft-delete.
- `purchases`: `id, school_id, purchase_no uq, supplier_id, date, invoice_ref, total NUMERIC, status ENUM('DRAFT','RECEIVED','CANCELLED')` + `purchase_items(id, purchase_id, item_id, qty, unit_price, total)`.
- `stock_ledger`: append-only `id, item_id, txn ENUM('PURCHASE','ISSUE','RETURN','ADJUST','DISPOSE'), qty_in, qty_out, balance_after, ref_type, ref_id, remarks, created_by, created_at`.
- `asset_units`: `id, item_id, asset_tag uq (QR/barcode), serial_no NULL, purchase_item_id, location ENUM-free (room/dept text + dept_id NULL), custodian_person NULL, status ENUM('IN_STORE','ASSIGNED','UNDER_REPAIR','DISPOSED','LOST'), warranty_until NULL, condition`, audit.
- `stock_issues`: `id, issue_no, issued_to ENUM('DEPARTMENT','PERSON','ROOM'), ref, items JSONB or child rows, status ENUM('ISSUED','PARTIAL_RETURN','RETURNED')` + rows (item, qty, returned_qty).

## 4. Backend Tasks (NestJS)
- [ ] Masters + purchase flow (RECEIVE → ledger in + asset_units generation for ASSET items with tag sequence + label PDF).
- [ ] Issue/return for consumables (ledger out/in) and asset assignment/transfer (custodian history via audit).
- [ ] Stock adjustment (count corrections, permission + reason) & disposal flow (approval → status + ledger).
- [ ] Low-stock alert job (reorder_level) → admin notification.
- [ ] Optional posting: RECEIVED purchase → expense/asset voucher via posting map.
- [ ] Reports: current stock (valuation FIFO-simple: last price × qty — document simplification), item ledger, purchases by supplier/period, asset register (by location/custodian/status), warranty-expiring, consumption by department.
### APIs
```
CRUD /api/v1/inventory/suppliers|categories|items
CRUD /api/v1/inventory/purchases (+ /:id/receive|cancel)
POST /api/v1/inventory/issues (+ /:id/return)      POST /adjustments  POST /assets/:id/transfer|repair|dispose
GET  /api/v1/inventory/reports/stock|ledger/:item|assets|low-stock|consumption
```

## 5. Frontend Tasks (Next.js)
- [ ] Item catalog + stock badges; purchase entry form (line grid, supplier autocomplete) + receive confirm.
- [ ] Issue desk (recipient picker, multi-item rows, print gate-pass-style slip); return processing.
- [ ] Asset register table (filters: location, custodian, status), asset detail (history timeline), tag label printing.
- [ ] Adjustment & disposal dialogs with reason enforcement; low-stock dashboard widget.

## 6. Business Rules
- Ledger is the source of truth; stock balance never edited directly.
- Issue qty ≤ available; consumable returns ≤ issued.
- DISPOSED/LOST assets excluded from register counts; disposal needs approval permission.
- Purchase RECEIVED is immutable (cancel = reversal entries).

## 7. Validation Rules
- Qty > 0 integers (or 3-decimal for LITER/KG); unit_price ≥ 0; warranty date ≥ purchase date.

## 8. Edge Cases
- Item bought in BOX issued in PCS → conversion factor field on item (box_size), ledger normalized to base unit.
- Lab equipment shared custody → custodian = department, room-level location.
- Physical count mismatch → bulk adjustment wizard from count sheet import.

## 9. Testing Checklist
- [ ] Unit: ledger balance math incl. adjustments/reversals; unit conversion.
- [ ] e2e: purchase→receive→issue→return chain; disposal approval.
- [ ] Frontend: purchase grid, asset timeline.

## 10. Completion Checklist
- [ ] Stock + assets + reports
- [ ] Alerts + labels
- [ ] Docs: `docs/modules/24-inventory.md`

---

# Module 25 — Transport Management

## 1. Goal
Vehicles, routes & stops, drivers/helpers, student transport assignment with stop-wise fees (feeding Module 16 invoicing), fuel & maintenance expense tracking, and transport reports.

## 2. Dependencies
- Modules 09, 16; Module 20 (expense posting optional).

## 3. Database Design
- `vehicles`: `id, school_id, reg_no uq, type ENUM('BUS','MICROBUS','VAN','OTHER'), capacity, fitness_expiry, tax_token_expiry, insurance_expiry, status ENUM('ACTIVE','MAINTENANCE','INACTIVE')`, audit/soft-delete.
- `drivers`: `id, school_id, staff_id NULL FK, name, phone, license_no, license_expiry, status`, audit.
- `routes`: `id, school_id, name, description, vehicle_id NULL, driver_id NULL, helper_name NULL, status` + `route_stops(id, route_id, name, pickup_time, drop_time, monthly_fee NUMERIC, display_order)`.
- `transport_assignments`: `id, enrollment_id FK, route_id, stop_id, start_date, end_date NULL, status ENUM('ACTIVE','SUSPENDED','ENDED')`, audit. Partial uq: one ACTIVE per enrollment.
- `vehicle_expenses`: `id, vehicle_id, type ENUM('FUEL','MAINTENANCE','REPAIR','TOLL','OTHER'), date, amount, odometer NULL, description, receipt_url NULL`, audit.

## 4. Backend Tasks (NestJS)
- [ ] CRUD everything; route-stop ordering; capacity tracking (assigned vs vehicle capacity).
- [ ] Assignment service → registers monthly Transport fee override/line for invoicing (integration contract with Module 16: fee head "Transport", amount from stop; proration on mid-month start/end).
- [ ] Expiry alert job (fitness/tax/insurance/license within 30 days → admin notification).
- [ ] Expense entry + optional voucher posting.
- [ ] Reports: route roster (per route/stop student list + guardian phones — for driver sheet PDF), vehicle expense summary (per km if odometer), fee collection vs assigned, capacity utilization.
### APIs
```
CRUD /api/v1/transport/vehicles|drivers|routes (+ stops nested)
CRUD /api/v1/transport/assignments (+ /:id/suspend|end)
CRUD /api/v1/transport/expenses
GET  /api/v1/transport/reports/roster/:routeId|expenses|utilization
```

## 5. Frontend Tasks (Next.js)
- [ ] Vehicle/driver/route managers; route detail with draggable stops + fee editing; capacity bar.
- [ ] Assignment flow from student profile (route→stop picker showing fee) + bulk assign by section.
- [ ] Expense log with monthly chart; expiry alerts widget.
- [ ] Roster print view; parent portal shows child's route/stop/times.

## 6. Business Rules
- Assignment requires ACTIVE route with vehicle; over-capacity warns (hard block setting).
- Ending an assignment stops future transport invoicing (current month per proration rule).
- Vehicle in MAINTENANCE keeps route visible but flagged; expenses attachable regardless.

## 7. Validation Rules
- BD reg no format free-text but uq; times HH:MM; fees ≥ 0; expiry dates ≥ today on create (warn otherwise).

## 8. Edge Cases
- Sibling same stop discount → handled via Module 16 override, not transport module.
- Route split/merge mid-year → bulk reassignment tool preserving fee continuity.
- Driver replaced temporarily → route-level substitute field (no schedule engine — keep simple).

## 9. Testing Checklist
- [ ] Unit: fee proration handoff contract, capacity math.
- [ ] e2e: assign→invoice generated next cycle→end assignment→invoice stops.
- [ ] Frontend: stop reorder, roster PDF.

## 10. Completion Checklist
- [ ] Fleet + routes + assignments + fees integration
- [ ] Expenses + alerts + reports
- [ ] Docs: `docs/modules/25-transport.md`

---

# Module 26 — Hostel Management

## 1. Goal
Hostels, rooms & beds, student allocation with hostel fees (Module 16 integration), mess management basics (monthly mess charge, meal on/off), and hostel reports.

## 2. Dependencies
- Modules 09, 16.

## 3. Database Design
- `hostels`: `id, school_id, name, type ENUM('BOYS','GIRLS'), warden_staff_id NULL, address, capacity, status`, audit/soft-delete.
- `hostel_rooms`: `id, hostel_id, room_no, floor, type ENUM('STANDARD','AC','SHARED'), bed_count, monthly_fee NUMERIC`, `uq(hostel_id, room_no)` + `hostel_beds(id, room_id, bed_no, status ENUM('VACANT','OCCUPIED','MAINTENANCE'))`.
- `hostel_allocations`: `id, enrollment_id, bed_id, start_date, end_date NULL, status ENUM('ACTIVE','VACATED','SUSPENDED'), security_deposit NUMERIC, deposit_refunded BOOL`, partial uq ACTIVE per enrollment & per bed, audit.
- `mess_plans`: `id, hostel_id, name, monthly_charge NUMERIC` ; `mess_enrollments(id, allocation_id, plan_id, start_date, end_date)` ; `meal_offs(id, allocation_id, from_date, to_date, approved_by)` (charge adjustment per day-rate setting).

## 4. Backend Tasks (NestJS)
- [ ] CRUD hostels/rooms/beds (bulk bed generation), allocation service (gender check vs hostel type, bed VACANT check) → hostel + mess fee lines to Module 16 (prorated).
- [ ] Vacate flow (end allocation, deposit refund record, bed → VACANT), transfer bed/room.
- [ ] Meal-off approval → prorated mess credit next invoice.
- [ ] Reports: occupancy (hostel/floor/room), resident list (with guardian contacts), fee dues among residents, meal-off summary.
### APIs
```
CRUD /api/v1/hostels (+rooms +beds nested)
POST /api/v1/hostel-allocations (+ /:id/vacate|transfer|suspend)
CRUD /api/v1/mess-plans | mess-enrollments | meal-offs (+approve)
GET  /api/v1/hostel/reports/occupancy|residents|dues
```

## 5. Frontend Tasks (Next.js)
- [ ] Hostel dashboard: occupancy heat grid (rooms as cards, beds as chips, click-to-allocate).
- [ ] Allocation dialog from student profile; vacate/transfer flows with deposit handling.
- [ ] Mess plan manager; meal-off approval inbox.
- [ ] Resident register + print; parent portal shows allocation details.

## 6. Business Rules
- Student gender must match hostel type; one active allocation per student; bed exclusivity.
- Vacate requires dues clearance check (override permission); deposit refund recorded (accounting voucher optional).
- Mess charge follows allocation dates; meal-off min duration setting (e.g., ≥ 3 days).

## 7. Validation Rules
- bed_count = generated beds; fees ≥ 0; date ranges valid & within session.

## 8. Edge Cases
- Room maintenance with occupants → transfer wizard before status change.
- Mid-month allocation + meal-off overlap → proration precedence documented (allocation window first, then meal-offs inside it).

## 9. Testing Checklist
- [ ] Unit: proration + meal-off credit math; gender/exclusivity guards.
- [ ] e2e: allocate→invoice→meal-off→credit→vacate.
- [ ] Frontend: occupancy grid interactions.

## 10. Completion Checklist
- [ ] Allocation + fees + mess
- [ ] Reports
- [ ] Docs: `docs/modules/26-hostel.md`

---

# Module 27 — Document Management & Certificates

## 1. Goal
Central document archive plus certificate engine: testimonial, transfer certificate (TC), character certificate, prize/participation certificates — templated PDFs with QR verification codes, issuance register, and the public certificate-verification page (completing Module 19's stub).

## 2. Dependencies
- Modules 09, 15 (result data on TC/testimonial), 16 (clearance), 19.

## 3. Database Design
- `certificate_templates`: `id, school_id, type ENUM('TRANSFER','CHARACTER','TESTIMONIAL','PRIZE','PARTICIPATION','CUSTOM'), name, body_html (handlebars vars), background_url NULL, signatories JSONB, is_active`, audit.
- `certificates`: `id, school_id, certificate_no uq (TC-{YY}-{SEQ4} per type), type, student_id FK, template_id, data_snapshot JSONB (name, class, session, GPA, conduct...), verify_code uq (random 10-char), file_url, status ENUM('DRAFT','ISSUED','REVOKED'), issued_by, issued_at, revoked_reason NULL`, audit.
- `document_archive`: generalizes student/staff documents already built — adds `archive_folders(id, school_id, name, parent_id)` + `archive_files(id, folder_id, title, file_url, tags TEXT[], linked_type NULL, linked_id NULL, uploaded_by)`, audit/soft-delete.

## 4. Backend Tasks (NestJS)
- [ ] Template CRUD with variable palette per type + live preview render.
- [ ] Issue flow: pick student+type → auto-fill snapshot (enrollment, results, attendance %, conduct default) → clearance check (dues, library, hostel — aggregated clearance service) → generate PDF (QR encodes verify URL+code) → ISSUED + register entry + optional SMS.
- [ ] TC special rule: issuing TC sets student status TRANSFERRED (confirm step) and locks portal.
- [ ] Revoke endpoint (reason, keeps file, verification shows REVOKED).
- [ ] Public verification: `GET /public/verify/certificate/:code` → type, student name, class, issue date, VALID/REVOKED (rate-limited).
- [ ] Bulk prize certificates (e.g., merit top-3 per class from an exam) wizard endpoint.
- [ ] Archive CRUD with folder tree + search by tag/title.
### APIs
```
CRUD /api/v1/certificate-templates (+ /:id/preview)
POST /api/v1/certificates (+ /:id/revoke)   GET /api/v1/certificates (register, filters)
GET  /api/v1/certificates/:id/pdf
POST /api/v1/certificates/bulk-prize {exam_id, top_n}
GET  /api/v1/public/verify/certificate/:code
CRUD /api/v1/archive/folders|files
```

## 5. Frontend Tasks (Next.js)
- [ ] Template designer (HTML editor + variable chips + preview pane + background upload).
- [ ] Issue wizard (student search → data review/edit → clearance status panel → confirm → download/print).
- [ ] Certificate register table (filters, reprint, revoke).
- [ ] Archive explorer (folder tree, upload, tag filter, preview).
- [ ] Public verification page (code entry / QR-scan landing) — polished, branded.
- [ ] Student portal: my certificates download list.

## 6. Business Rules
- Certificate numbers sequential per type/year, never reused; data immutable post-issue (snapshot).
- TC requires full clearance (hard) — override `certificate.clearance.override` with mandatory reason.
- Only ISSUED certs verify VALID; DRAFTs invisible publicly.

## 7. Validation Rules
- Template vars must exist in palette; verify_code collision-checked; signatory images ≤ 500 KB.

## 8. Edge Cases
- Legacy/manual certificates (pre-system) → manual register entry with custom number + verify code (backfill support).
- Name correction after issue → revoke + reissue (both in register, linked).
- Duplicate TC request (lost original) → "Duplicate" watermark reissue referencing original number.

## 9. Testing Checklist
- [ ] Unit: numbering, snapshot completeness, clearance aggregation.
- [ ] e2e: issue TC → student status change → public verify VALID → revoke → verify shows REVOKED.
- [ ] Manual: print fidelity on A4 with background.

## 10. Completion Checklist
- [ ] Templates + issuance + register + revoke
- [ ] Public verification live (Module 19 stub replaced)
- [ ] Archive
- [ ] Docs: `docs/modules/27-documents-certificates.md`

---

# Module 28 — Complaint, Visitor & Alumni Management

## 1. Goal
Three light workflow modules bundled: (a) complaints/suggestions/feedback with tracking & resolution, (b) visitor entry/appointments/gate passes, (c) alumni registration, directory, events, donation tracking.

## 2. Dependencies
- Modules 07, 09, 17, 19 (public alumni registration + complaint form).

## 3. Database Design
- `tickets` (complaints): `id, school_id, ticket_no uq (CMP-{YY}-{SEQ}), type ENUM('COMPLAINT','SUGGESTION','FEEDBACK'), category ENUM('ACADEMIC','FEES','TRANSPORT','HOSTEL','TEACHER','FACILITY','OTHER'), subject, description, attachments JSONB, raised_by_type ENUM('GUARDIAN','STUDENT','STAFF','ANONYMOUS','PUBLIC'), raised_by_id NULL, contact JSONB, assigned_to NULL, priority ENUM('LOW','MEDIUM','HIGH','URGENT'), status ENUM('OPEN','IN_PROGRESS','RESOLVED','CLOSED','REOPENED'), resolution TEXT NULL, resolved_at, satisfaction_rating INT NULL`, audit + `ticket_comments(id, ticket_id, author_id NULL, body, is_internal BOOL, created_at)`.
- `visitors`: `id, school_id, name, phone, nid NULL, purpose ENUM('MEETING','ADMISSION_QUERY','GUARDIAN_VISIT','VENDOR','OFFICIAL','OTHER'), whom_to_meet (staff_id NULL + free text), card_no NULL, photo_url NULL, check_in, check_out NULL, gate_pass_no NULL, appointment_id NULL`, audit; `appointments(id, visitor_name, phone, with_staff_id, scheduled_at, status ENUM('PENDING','APPROVED','REJECTED','COMPLETED','NO_SHOW'), notes)`.
- `alumni`: `id, school_id, student_id NULL (linked if in system), name, batch_year, last_class, phone, email, profession, organization, photo_url, is_public_profile BOOL, status ENUM('PENDING','APPROVED','REJECTED')`, audit; `alumni_events(id, title, date, venue, description, fee NUMERIC NULL)` + registrations; `donations(id, alumni_id NULL, donor_name, amount, purpose, method, received_at, receipt_no uq)`, audit.

## 4. Backend Tasks (NestJS)
- [ ] Tickets: create (portal + public form w/ reCAPTCHA), assignment & status flow, SLA reminder job (OPEN > 72 h → escalation notification), comment threads (internal vs visible), satisfaction prompt on RESOLVED, reports (by category/status/avg resolution time).
- [ ] Visitors: quick check-in (photo webcam capture optional), gate pass PDF, checkout, appointment request→approve (SMS confirm), daily register report; auto-checkout job at day end (flag).
- [ ] Alumni: public self-registration → approval queue (match hint against past GRADUATED students), directory (public: only approved+is_public), events + registration, donation entry + receipt PDF + summary reports (accounting posting optional).
### APIs
```
CRUD /api/v1/tickets (+ /:id/assign|status|comments)   POST /api/v1/public/tickets
CRUD /api/v1/visitors (+ /:id/checkout)  CRUD /api/v1/appointments (+approve/reject)
CRUD /api/v1/alumni (+ /:id/approve)     POST /api/v1/public/alumni/register
CRUD /api/v1/alumni-events (+registrations)   CRUD /api/v1/donations
GET  /api/v1/reports/tickets|visitors|donations
```

## 5. Frontend Tasks (Next.js)
- [ ] Ticket inbox (kanban by status + table view, priority chips, assignment dropdown, comment thread drawer); portal "Contact School" (replaces Module 18 stub); public complaint form.
- [ ] Visitor desk screen (fast form, camera capture, gate pass print, live in-building list, checkout button); appointment calendar.
- [ ] Alumni: public register page + directory (search by batch); admin approval queue; events manager; donation entry + receipts; donation dashboard.

## 6. Business Rules
- Anonymous complaints allowed (setting) — no requester notifications.
- Only assignee/admin change ticket status; REOPENED allowed within 7 days of CLOSED.
- Visitor must checkout same day (auto-flag otherwise); gate pass required setting per school.
- Alumni directory exposes only opted-in fields; donations receipts immutable.

## 7. Validation Rules
- Ticket subject ≤ 200; rating 1–5; batch_year 1950–current; donation amount > 0.

## 8. Edge Cases
- Complaint about a specific teacher → visibility restricted (sensitive category hides from general staff, admin/principal only).
- Alumni claiming a student record already claimed → conflict queue for manual resolve.
- Visitor for exam duty (external invigilator) → purpose OFFICIAL + multi-day pass flag.

## 9. Testing Checklist
- [ ] Unit: SLA escalation, reopen window, directory privacy filter.
- [ ] e2e: public complaint→resolve→rating; visitor in/out; alumni register→approve→directory.
- [ ] Frontend: kanban drag, camera capture fallback.

## 10. Completion Checklist
- [ ] Tickets + Visitors + Alumni all live
- [ ] Public forms integrated on website
- [ ] Docs: `docs/modules/28-complaint-visitor-alumni.md`

---

# Module 29 — Reports & Analytics v2

## 1. Goal
Elevate reporting: unified report builder framework, cross-module analytics dashboards, scheduled report emails, website visitor analytics ingestion, and export center — consolidating and extending every module's reports.

## 2. Dependencies
- All Phase 1–2 modules.

## 3. Database Design
- `report_definitions`: `id, code uq, name, module, params_schema JSONB, permissions, output ENUM('TABLE','CHART','PDF','XLSX')` (registry table replacing the code-only registry from Module 18).
- `report_schedules`: `id, school_id, report_code, params JSONB, cron, recipients JSONB (emails/user_ids), format, last_run_at, status`, audit.
- `report_runs`: `id, schedule_id NULL, report_code, params, requested_by, status ENUM('QUEUED','RUNNING','DONE','FAILED'), file_url NULL, row_count, duration_ms, created_at`.
- `site_analytics_daily`: `id, school_id, date, page_views, unique_visitors, top_pages JSONB` (ingested from a lightweight self-hosted tracker or GA API — decide; default: server-side page-view counter middleware on public routes).
- Materialized views for heavy aggregates: `mv_attendance_monthly`, `mv_collection_monthly`, `mv_result_summary` (refreshed nightly).

## 4. Backend Tasks (NestJS)
- [ ] Report engine: definition registry, param validation, async execution queue (large exports never block requests), file delivery via signed S3 URLs, retention (30 d auto-purge).
- [ ] Scheduler (cron per schedule) → run → email with attachment/link.
- [ ] Analytics endpoints powering executive dashboard: enrollment trends (YoY), attendance heatmap (section × month), fee realization %, dues aging, result trends (pass % & GPA avg per exam over time), teacher workload & leave patterns, SMS spend, library/inventory/transport KPIs.
- [ ] MV refresh jobs + manual refresh endpoint.
- [ ] Export center: my exports list (report_runs by user).
### APIs
```
GET  /api/v1/reports (catalog)   POST /api/v1/reports/:code/run   GET /api/v1/report-runs (+/:id)
CRUD /api/v1/report-schedules
GET  /api/v1/analytics/executive | enrollment | attendance-heatmap | finance | results | operations
GET  /api/v1/analytics/website
```

## 5. Frontend Tasks (Next.js)
- [ ] Reports hub v2: catalog with param forms auto-generated from params_schema, run→toast→export center.
- [ ] Executive analytics dashboard: filterable (session), chart grid (line/bar/heatmap via Recharts), drill-through links to source module pages, PDF snapshot export.
- [ ] Schedule manager (cron presets: daily/weekly/monthly, recipient picker, test-run).
- [ ] Export center page (status, download, re-run).

## 6. Business Rules
- Report access enforced per definition permission (engine-level, not just UI).
- Scheduled reports run in school timezone (Asia/Dhaka); failures retry ×2 then notify owner.
- Exports containing sensitive columns (medical, salary) require the specific data permission — engine strips columns otherwise.

## 7. Validation Rules
- Cron whitelist (no sub-hourly); params validated against schema; recipient emails valid.

## 8. Edge Cases
- Huge export (50k rows) → streamed XLSX generation, memory-bounded.
- MV refresh during report run → runs read committed snapshot; document eventual freshness (≤ 24 h) on affected reports.
- Deleted user owning schedules → schedules auto-disabled, admin notified.

## 9. Testing Checklist
- [ ] Unit: engine param validation, column-stripping, cron scheduling.
- [ ] e2e: run→file→download; schedule fire (time-travel test).
- [ ] Load: executive dashboard < 1 s on seeded 5-year dataset.

## 10. Completion Checklist
- [ ] Engine + schedules + export center
- [ ] Executive dashboard
- [ ] MVs + website analytics
- [ ] Docs: `docs/modules/29-reports-analytics.md`

---

# Module 30 — System Administration, Backup & Deployment Hardening  *(Phase 3 begins)*

## 1. Goal
Production operations: automated backup/restore, log & audit retention, health monitoring & alerting, deployment pipeline (staging→prod), security hardening pass, data lifecycle jobs, and super-admin system console.

## 2. Dependencies
- All prior modules (hardens the whole system).

## 3. Database Design
- `backup_records`: `id, type ENUM('DB','FILES','FULL'), started_at, finished_at, size_bytes, location, checksum, status ENUM('RUNNING','SUCCESS','FAILED'), triggered ENUM('SCHEDULED','MANUAL')`.
- `system_jobs_log`: `id, job_name, started_at, finished_at, status, error NULL, meta JSONB` (all cron jobs report here).
- Retention policies in settings (audit 24 mo, notifications 12 mo, report files 30 d, login activity 12 mo).

## 4. Backend Tasks (NestJS)
- [ ] Backup service: nightly `pg_dump` (custom format) + S3 file-manifest sync → encrypted upload to off-site bucket, checksum verify, rotation (7 daily / 4 weekly / 12 monthly), success/failure alert; manual trigger + **documented, rehearsed restore runbook** (restore into staging monthly job proves backups).
- [ ] Retention jobs: partition drops/archival per policy; audit-log archive to S3 parquet/ndjson before drop.
- [ ] Monitoring: Prometheus metrics endpoint (`/metrics` — http durations, queue depth, job failures, DB pool), Grafana dashboards provisioning files, Uptime alerts (healthcheck → SMS/email to super admin); Sentry (or self-hosted GlitchTip) wiring both repos.
- [ ] Security hardening checklist execution: dependency audit gate in CI, secrets rotation procedure, Postgres least-privilege roles, Nginx config (TLS 1.2+, HSTS, rate-limit zones, body size), fail2ban notes, CSP headers on frontend, `npm audit`/`trivy` image scan in CI, penetration-test checklist (OWASP ASVS L1 self-assessment documented).
- [ ] Deployment: production Docker Compose (or single-node swarm) with Nginx reverse proxy + certbot, zero-downtime deploy script (migrate → new containers → healthcheck → switch), staging environment parity, `.env` management doc, GitHub Actions CD (staging auto, prod manual approval).
- [ ] Super-admin console APIs: system info, job log, backup list + trigger, cache flush, maintenance mode toggle (503 page + admin bypass), feature flags table (simple).
### APIs
```
GET  /api/v1/system/info | jobs | metrics-summary
GET/POST /api/v1/system/backups (+ /:id/verify)
POST /api/v1/system/maintenance {on|off}
GET/PUT /api/v1/system/feature-flags
```

## 5. Frontend Tasks (Next.js)
- [ ] System console (super admin): health cards, job history table, backup list + trigger + last-verified badge, retention settings, maintenance mode switch, feature flags.
- [ ] Maintenance mode page; global banner when staging.

## 6. Business Rules
- A backup that hasn't been restore-verified within 35 days flags the console red.
- Maintenance mode blocks all non-super-admin API access (503 + Retry-After).
- Prod deploys require green staging e2e suite + manual approval.

## 7. Validation Rules
- Retention minimums enforced (audit ≥ 12 mo — compliance floor).

## 8. Edge Cases
- Backup during heavy write → `pg_dump` consistent snapshot fine; document VACUUM/analyze schedule.
- S3 outage during backup → local retention fallback dir + alert.
- Restore drill collides with staging testing → scheduled window + banner.

## 9. Testing Checklist
- [ ] Full restore drill executed & timed (RTO documented).
- [ ] Chaos basics: kill Redis/postgres containers → system degrades & recovers as designed.
- [ ] CI security gates fail on planted vulnerable dep (verify gate works).

## 10. Completion Checklist
- [ ] Backups + verified restore
- [ ] Monitoring + alerting live
- [ ] Hardened prod deployment + CD
- [ ] System console
- [ ] Docs: `docs/modules/30-sysadmin.md` (+ `RUNBOOK.md` in repo root)

---

# Module 31 — Multi-School (SaaS) Enablement

## 1. Goal
Activate the dormant `school_id` architecture: multiple schools on one deployment with strict tenant isolation, per-school domains/subdomains, plans & subscription billing, super-admin tenant management, and per-tenant theming.

## 2. Dependencies
- Module 30 (ops maturity first).

## 3. Database Design
- `schools` gains: `subdomain uq`, `custom_domain uq NULL`, `plan_id FK`, `status ENUM('TRIAL','ACTIVE','SUSPENDED','CANCELLED')`, `trial_ends_at`, `storage_used_bytes`, `sms_balance` (moves from ledger scope), `onboarded_at`.
- `plans`: `id, name, price_monthly, limits JSONB {students_max, sms_included, storage_gb, modules_enabled[]}`.
- `subscriptions`: `id, school_id, plan_id, period_start, period_end, amount, status, payment_ref`, audit.
- Row-level security review: EVERY tenant table verified for `school_id` + composite indexes `(school_id, …)`; optional Postgres RLS policies as defense-in-depth (decide & document).

## 4. Backend Tasks (NestJS)
- [ ] Tenant resolution middleware: subdomain/custom-domain → school context injected; JWT carries `school_id`; cross-checks on every request (token school ≙ host school).
- [ ] `TenantGuard` + repository base class auto-scoping every query by `school_id` (audit sweep: no raw unscoped queries — lint rule/AST check in CI).
- [ ] Super-admin (platform) area: school onboarding wizard (creates school + admin + seeds roles/grading/COA), suspend/reactivate (suspension blocks logins with billing message), plan enforcement (student cap, module flags gate NestJS modules + frontend menus), usage metering jobs (storage, SMS).
- [ ] Subscription billing: invoice generation for schools, gateway payment (reuse adapters), dunning reminders, auto-suspend after grace.
- [ ] Per-tenant theming: logo/colors already per school — extend to public website theme tokens; per-tenant email/SMS sender config.
- [ ] Data export per tenant (offboarding: full ZIP — SQL subset + files) & tenant deletion procedure (legal retention documented).
### APIs
```
Platform: CRUD /api/v1/platform/schools (+ suspend/activate)   CRUD /plans   GET /platform/usage
GET/POST /api/v1/platform/subscriptions | invoices
POST /api/v1/platform/schools/:id/export
```

## 5. Frontend Tasks (Next.js)
- [ ] Platform console (separate route group `(platform)`, super-admin only): schools table with usage/status, onboarding wizard, plan manager, billing screens, per-school impersonation ("login as school admin" — heavily audited).
- [ ] Tenant-aware theming loader on public site + portal; suspended-school lock screens.
- [ ] Marketing/landing site for the SaaS itself (optional flag — simple page now).

## 6. Business Rules
- Absolute isolation: any cross-tenant read = critical bug class; automated cross-tenant test suite (tenant A token vs tenant B resources → all 403/404) runs in CI.
- Impersonation sessions time-boxed (30 min), banner-visible, fully audited.
- Plan downgrade below current usage blocked until usage reduced.
- SUSPENDED tenants: data retained 90 days, then offboarding flow.

## 7. Validation Rules
- Subdomain: 3–30 chars, kebab, reserved list; custom domain verified via DNS TXT before activation.

## 8. Edge Cases
- Two schools same custom-domain typo attempt → verification prevents; certificate automation (certbot DNS/SNI) per domain.
- Shared guardians across two tenant schools (real BD case: siblings in different schools) → separate accounts per tenant by design (document clearly).
- Global platform announcements → platform-level notice channel to all tenant admins.

## 9. Testing Checklist
- [ ] Cross-tenant isolation suite (the critical one) green.
- [ ] e2e: onboarding→trial→subscribe→suspend→reactivate.
- [ ] Load: 20 tenants seeded, dashboard latencies hold.

## 10. Completion Checklist
- [ ] Tenant middleware + scoped repos + isolation suite
- [ ] Platform console + billing
- [ ] Theming + domains
- [ ] Docs: `docs/modules/31-multi-school.md`

---

# Module 32 — Future Expansion Track

## 1. Goal
Structured backlog implemented as sub-projects, each getting its own mini-roadmap when scheduled: Mobile apps, QR/RFID hardware attendance, LMS, AI analytics, chatbot, government reporting, BI.

## 2. Dependencies
- Modules 30–31 as platform baseline; individual items depend on their domain modules.

## 3–5. Design/Backend/Frontend (per sub-project, to be expanded when activated)
- **32a Mobile API v2 & Apps**: versioned mobile-optimized endpoints (field-sparse payloads, cursor pagination), push notifications (FCM — extends Module 17 channel enum), React Native or Flutter app (student/parent first, teacher second); offline attendance draft sync.
- **32b QR/RFID Hardware Attendance**: device registration table, device API keys, batch check-in ingestion endpoint (idempotent), anti-passback rules, gate display integration; extends Module 12.
- **32c Online Classes & LMS**: lesson plans, video content (external embed first), live-class links (Zoom/Meet), quizzes (question bank, auto-grade MCQ), progress tracking; extends Module 22.
- **32d AI Analytics & Insights**: at-risk student model (attendance+results+fees signals → risk score with explanation), teacher-facing suggestions, term-over-term anomaly alerts; strictly assistive, human-reviewed; extends Module 29.
- **32e AI Chatbot**: parent/student FAQ + account-scoped queries ("my child's dues?") via LLM with tool-calling against portal APIs, Bangla+English; guardrails (no data outside own scope — reuse OwnershipGuard).
- **32f Digital certificate QR at scale + govt reporting**: BANBEIS/board export formats (research per board), scheduled submissions.
- **32g BI**: read-replica + Metabase/Superset embedding for power users.

## 6–8. Rules/Validation/Edge Cases
- Defined per sub-project at activation; every sub-project must pass the same security (ownership/tenant) suites.

## 9. Testing Checklist
- Per sub-project; mobile adds device-matrix testing.

## 10. Completion Checklist
- [ ] Each activated sub-project gets appended here as 32a…, with the full 10-section template, before implementation begins.

---

## Cross-Cutting Backlog (tracked, not yet scheduled)
- Teacher substitution scheduling (from Module 13)
- WebSocket/SSE real-time notifications (Module 17 polling upgrade)
- Advance fee payments proper wallet (Module 16)
- Multi-language full i18n framework (currently EN + BN fields)
- Accessibility audit to WCAG 2.1 AA formal certification
