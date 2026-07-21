# PROJECT_CONTEXT.md — SMIS Living Project Memory

> Updated whenever a module changes the architecture or introduces reusable patterns.
> **Last updated:** 2026-07-22 (Module 12 complete — student + staff attendance keyed on `enrollment_id`, QR check-in, student leave with retroactive LEAVE correction, auto-absent + absent-SMS jobs, report/export suite; `CalendarService.workingDays()` added as the shared percentage denominator; M09 attendance-history and the M11 promotion rollback guard are live)

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
| `PasswordService` / `TokenService` / `OtpService` | argon2id + policy, JWT/reset/refresh tokens, hashed OTPs. `OtpService` exported from AuthModule since M10 (public admission phone verify, purpose `ADMISSION`) | M02 |
| `StudentsService` (exported by `StudentModule` since M10) | one-call student registration (gap-free UID + guardian phone dedup + warn-only duplicates) — the admission conversion path reuses it; M11 bulk flows may too | M09→10 |
| `RecaptchaService` / `AdmissionTokenService` (AdmissionModule-local) | Google reCAPTCHA verify (disabled when `RECAPTCHA_SECRET_KEY` empty, fails OPEN on network errors) / 30-min signed phone-verification tokens | M10 |
| `notifications` BullMQ queue | email (SMTP) + SMS (log-only until M17) job contract | M02 |
| `NotificationService.send()` | ALL SMS/email/in-app — no direct gateway calls anywhere | M17 |
| `SequenceService` (exported by `SequenceModule`) | gap-free document numbers: per-(school, prefix) counters in `document_sequences`, claimed by an atomic row-locking upsert INSIDE the caller's transaction (rollback returns the number); token-pattern renderer `{SCHOOL_CODE} {YYYY} {YY} {MM} {SEQ<n>}`. Employee IDs (M07) use setting `general.employee_id_pattern` + counter `staff:{YY}`; student UIDs/applications/invoices/vouchers (M09/10/16/20) reuse it | M07 |
| `CalendarService.isHoliday(schoolId, date, appliesTo?)` (exported by `AcademicModule`) | weekly off-days (M04 setting `general.weekly_holidays`) + holiday ranges → `{holiday, reason, title}`; consumed by Attendance (M12) / Payroll (M21) | M05 |
| `CalendarService.workingDays(schoolId, from, to, appliesTo?)` | YYYY-MM-DD list of working days in a range (one holidays query + one settings read, unlike per-date `isHoliday`) — **the denominator of every attendance/payroll percentage**; pure core in `calendar/working-days.util.ts` | M05→12 |
| Attendance engine (`attendance/calc/percentage.util.ts`, `calc/clock.util.ts`) | dependency-free: `countByStatus`/`presentEquivalent`/`summarize` (`present + late + ½ half-day ÷ working days`, HOLIDAY rows removed from both sides) and the Asia/Dhaka clock helpers (`dhakaToday`, `dhakaMinutesOfDay`, `minutesOfDay`). Importable from any module (M09 student history does) without touching AttendanceModule | M12 |
| `AttendanceReportsService` + `StudentAttendancesRepository` / `StaffAttendancesRepository` (exported by `AttendanceModule`) | daily/monthly/student/staff/summary/late-analysis reports for M18 dashboards; the repositories for M21 payroll and the M09/M11 re-provisions | M12 |
| `AttendanceSettingsService` (AttendanceModule-local) | one typed read of the whole `attendance.*` settings group (mode, late/half-day minutes, edit window, job times, SMS cap); malformed HH:mm falls back to the registry default instead of 500-ing the sheet | M12 |
| `TIMETABLE_CONFLICT_CHECKER` (DI token, TeacherModule) | assignment-time conflict hook — bound to a no-op until M13 provides the real checker (swap the provider, keep the token) | M08 |
| `teacher.leave.approved` event (`TEACHER_EVENTS.LEAVE_APPROVED`) | consumed since M12 — `AttendanceListener` marks those days LEAVE in `staff_attendances` (holidays skipped) | M08→12 |
| `SessionsService` (exported by `AcademicModule`) | current-session resolution + session rules for session-scoped modules | M05 |
| `parseDate` (`academic/calendar/date.util.ts`) | strict YYYY-MM-DD parsing (regex shape ≠ valid date — always parse through this) | M05 |
| `buildIcs` (`academic/calendar/ics.util.ts`) | dependency-free RFC 5545 writer (all-day events) | M05 |
| `SectionsRepository` (exported by `AcademicModule`) | roster-side section queries for enrollment (M11) | M06 |
| `StructureCloneService` | yearly rollover: additive/idempotent clone of sections + curriculum maps with preview | M06 |
| `StudentsRepository` / `GuardiansRepository` (exported by `StudentModule`) | student & guardian queries for admission conversion (M10), enrollment (M11), fees (M16), library/transport/hostel | M09 |
| `EnrollmentsService` (exported by `EnrollmentModule`) | canonical roster queries `getSectionStudents(sectionId)` / `getStudentCurrentEnrollment(studentId, sessionId)` — all attendance/marks/fees key on the returned `enrollment_id`; also owns enroll/bulk/transfer/renumber + promotion. `EnrollmentsRepository` re-provided in AcademicModule for the section delete-guard (avoids a cycle) | M11 |
| `StudentStatusHistoryRepository` / `IdCardService` (exported by `StudentModule` since M11) | promotion graduates write status-history rows; section-scoped batch ID cards reuse the M09 generator | M09→11 |
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

`schools` ← everything. `users` ←1:1→ `staff_profiles|teachers|students|guardians` (role-specific profile tables). **Live since M07:** `staff_profiles` (user_id unique FK, employee_id from SequenceService — its unique index deliberately IGNORES `deleted_at`, IDs never reused) + `staff_documents` (hard-deleted with their S3 object) + `document_sequences` (shared counters). Staff creation = one transaction (sequence + user + default role by designation + profile); RESIGNED/TERMINATED cascade deactivates the user via event listener (sessions revoked first). **Live since M08:** `teachers` (SEPARATE table sharing the user — not a staff_profiles extension; personal columns duplicated + salary_grade/mpo_index_no/specialization; same never-reuse employee-ID rule) with `teacher_qualifications`, `teacher_subjects` (expertise), `teacher_section_subjects` (one teacher per session×section×subject slot — upsert replaces, audit keeps history), `teacher_leaves` (interim → M21), `teacher_evaluations`, `teacher_documents`; `sections.class_teacher_id` FK now real (cap per session via `academic.max_class_teacher_sections`). **Live since M09:** `students` (permanent `student_uid` from SequenceService — its unique index IGNORES `deleted_at`, never reused; lazy `user_id`; rotatable `qr_token`; birth-cert soft-unique per school) —M:N→ `guardians` (shared across siblings, deduped by phone, lazy `user_id`) via `student_guardians` (composite PK, one primary per student = partial unique `WHERE is_primary`, promote/demote transactional); `student_medical_info` (1:1, permission-gated `student.medical.view`), `student_documents` (S3, hard-deleted with object), `student_status_history` (append-only). **Live since M11:** `enrollments` = student × session × class/section/group/shift with a roll number (all attendance/marks/fees hang off `enrollment_id`, NOT `student_id`) — one live enrollment per (student, session) and roll unique per (session, section) are PARTIAL unique indexes excluding soft-deleted + CANCELLED rows; `enrollment_transfers` (append-only section-move log); `promotion_batches` →1:N→ `promotion_items` (DRAFT→EXECUTED→ROLLED_BACK; execute closes old enrollments + creates new-session ones + graduates final-class students; `to_enrollment_id` on the item lets rollback delete exactly what it created). **Live since M10:** `admission_cycles` (session-scoped campaign, soft-unique name) →1:N→ `admission_cycle_classes` (per-class seats + fee, uq cycle+class) and `admission_applications` (applicant/guardian SNAPSHOTS — master student/guardian rows created only at conversion; `application_no` never reused; live-duplicate partial unique on cycle+class+phone+dob excluding CANCELLED/REJECTED/EXPIRED; `student_id` FK set on ADMITTED) + `admission_tests` (one slot per cycle+class). **Live since M06:** `classes`/`subjects`/`departments`/`shifts`/`groups` are session-independent masters; `sections` = class × session (identity unique incl. NULL-safe shift via COALESCE index; `class_teacher_id` FK deferred to M08); `class_subjects` defines curriculum per class × session (× optional group). **Live since M12:** `student_attendances` hangs off `enrollment_id` (never `student_id`) with `section_id` denormalized AT MARKING TIME so a mid-year transfer cannot retro-move history; identity is a partial unique over `(enrollment_id, date, COALESCE(period_id, nil uuid))` excluding soft-deleted rows (`period_id` is a bare UUID column until M13 adds periods + the FK). `staff_attendances` is polymorphic over the two employee tables (`person_type` + `person_id`, no FK, one row per person per date). `student_leave_applications` (student × session range, reusing the M08 `leave_status_enum`) — approving one rewrites recorded ABSENT/HALF_DAY days in the range to LEAVE. Exams → `exam_subjects` → `marks` → `results`. `invoices`→`payments`. Full graph grows per module; see each module §3.

## 9. Authentication Flow

**Live since M02.** Login (email/phone + password, argon2id) → access JWT 15 min (in memory) + rotating opaque refresh 7/30 d (httpOnly `hs_refresh` cookie, path `/api/v1/auth`) → rotation with reuse-detection (reuse outside 5 s two-tab grace ⇒ revoke ALL sessions + SMS alert; rotation never extends the session window). **Since M09** one contact may back one account PER user type (a guardian who is also staff) — uniqueness is `(school_id, user_type, contact)`, and login verifies the password against EVERY candidate for the identifier (`UsersRepository.findAllByIdentifier`), a failed attempt counting against each unlocked one; OTP/reset target the oldest candidate until username login lands. OTP (6-digit, hashed, 5 min, 3 attempts, 60 s resend) for reset/verification; verify-otp mints a 10-min reset token. Lockout 5 fails/15 min (423). Generic errors everywhere (no account enumeration). Frontend: axios single-flight refresh interceptor → `/auth/refresh`; `proxy.ts` guards route groups via the `hs_session` hint cookie; forced-change interstitial when `must_change_password`. Bootstrap Super Admin comes from the seed (`admin@hexschool.local`).

## 10. Authorization Flow

**Live since M03.** RBAC: permission codes registry (TS code = source of truth, idempotently synced to `permissions`; removed codes orphan-flagged and denied) → roles (11 system roles seeded per school, non-deletable/non-renamable, core sets locked extend-only) → users (`user_roles`; every user keeps ≥1 role, last `super-admin` holder protected). `PermissionsGuard` + `@RequirePermissions()` (AND) / `@RequireAnyPermission()` (OR); permissions cached in Redis 5 min (`perm:{userId}`), invalidated on role change, DB fallback if Redis is down; Super Admin (`user_type`) bypasses. **Guard chain is pinned in `AppModule` providers (Throttler → JwtAuthGuard → PermissionsGuard) — global-guard order follows provider registration order, so never register APP_GUARDs from feature modules.** Role edits use optimistic concurrency (`expectedUpdatedAt` → 409). Frontend `<Can>`/`usePermissions()` + `ADMIN_MENU` permission-per-item config (UI gating only; API is authoritative). Portals add ownership checks (student=self, parent=children via `student_guardians`).

**Audit (M03):** every successful mutating request writes an immutable `audit_logs` row via the global `AuditInterceptor`. New modules: set precise diffs from services via `AuditContextService.set({entityType, entityId, oldValues, newValues})`; use `@Audit({action})` for verb overrides and `@SkipAudit()` only for machine noise. `action` is VARCHAR — extend `AUDIT_ACTIONS` (both repos) instead of migrating an enum.

## 11. Global Business Rules

- One `is_current` academic session (DB partial unique index since M05); sessions never overlap in dates; COMPLETED sessions are read-only for entry flows — **enforced since M12** (attendance marking refuses a COMPLETED/ARCHIVED session; M15 marks entry must do the same). Activate rolls the demoted ACTIVE session to COMPLETED.
- One enrollment per student per session; roll unique per section.
- One attendance record per student per date (per period once M13 lands); attendance may not be taken for a future date, outside its session, or on a holiday without `attendance.holiday.override`. Attendance % = `(present + late + ½ half-day) ÷ working days`, working days excluding holidays, weekly off-days and days before the student's `enrollment_date`.
- Published results/receipts/vouchers/certificates are immutable — corrections via reversal/reissue with audit trail.
- All money NUMERIC(12,2) BDT; every monetary override needs permission + reason.
- Soft delete everywhere except append-only logs (audit, ledger, login activity, notifications).
- Timezone: store UTC, display Asia/Dhaka; weekly holiday configurable (default Friday).

## 12. Common Validation Rules

BD phone `^01[3-9]\d{8}$` (normalized). NID 10/13/17 digits. Birth cert 17 digits. Password ≥ 8 with upper/lower/digit. Uploads whitelisted by type/size per feature. Bangla SMS = 70-char UCS-2 segments (cost calc).

## 13. Reusable Hooks (frontend)

`useAppDispatch`/`useAppSelector`/`useAuth` (typed Redux hooks, M02), `useDebounce`, `usePermissions` (`can`/`canAny`/`isSuperAdmin`, M03), `useAcademicSession` (session switcher: `sessions`/`selected`/`current`/`select`, M05); planned: `useDataTable`, `useConfirm`. (Grows per module.)

## 14. Environment Variables

See `.env.example` in each repo. Core: `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `S3_*` (+ optional `S3_BUCKET_BRANDING` since M04), `SMTP_*`, `SETTINGS_ENCRYPTION_KEY` (32 chars — consumed since M04; rotating it orphans stored secrets), `CORS_ORIGINS`, optional `SEED_SUPER_ADMIN_PASSWORD`; frontend `NEXT_PUBLIC_API_URL`. Gateway credentials (SMS/SSLCommerz/bKash/Nagad) live in **encrypted school settings**, not env (M04 decision); `RECAPTCHA_SECRET_KEY` (optional, empty = captcha disabled — M10) + frontend `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`. Joi-validated at boot.

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
| Employee-ID unique index NOT soft-delete-scoped (unlike other business uniques) | "Employee IDs never reused, even after soft delete" (M07 §6) — the index must keep holding deleted rows' IDs | M07 |
| Deleting staff soft-deletes the USER too (not just the profile) | the partial uniques on users free the email/phone for a future account; sessions revoked | M07 |
| Credential notifications (welcome/reset) are fire-and-forget enqueues | BullMQ with Redis down buffers `await add()` forever; the admin holds the returned temp password either way — delivery must never block or fail the mutation | M07 |
| Staff-status cascade: revoke sessions BEFORE flipping user status | status is the observable "cascade done" signal (e2e polls it); a session must never outlive an INACTIVE flip | M07 |
| `teachers` = separate table sharing the user (NOT extending staff_profiles) | roadmap M08 §3 offered both; separate keeps teaching/non-teaching lifecycles independent (designations, MPO, expertise); M21 payroll unifies over both | M08 |
| Assignment expertise-override is a runtime permission check in the service (not a route decorator) | same route serves both cases; only the `override:true` branch needs `teacher.assign.override` (PermissionsService lookup, Super Admin bypass) | M08 |
| Resign guard counts CURRENT-session duties only | past sessions are history, future ones aren't scheduled yet; the transfer helper moves current-session assignments | M08 |
| User uniqueness `(school_id, user_type, contact)`, not `(school_id, contact)` | roadmap M09 §8: a guardian may also be staff, so one phone/email backs one account per type; login checks every candidate (no account enumeration — password decides) | M09 |
| `students`/`guardians` are SEPARATE role-profile tables sharing `users` (not one "person" table) | mirrors staff/teachers; a guardian who is also staff has two profiles + two typed accounts, deliberately | M09 |
| Guardian dedup by phone (unique NOT enforced in DB) | data quality varies; `guardians.create` refuses a used phone in the service, but siblings intentionally share one row via linking | M09 |
| ID cards via pdfkit + qrcode, QR encodes `qr_token` (not the row id) | token is rotatable, so a leaked/printed card is revocable without touching the PK; binary responses use `StreamableFile` + `@SkipEnvelope` | M09 |
| XLSX import commits row-by-row through `StudentsService.create` | each row gets the same gap-free UID + guardian dedup + duplicate warnings as manual entry; one bad row never rolls back its neighbours | M09 |
| Student UID pattern in settings (`general.student_id_pattern`), like employee IDs | per-school configurable, no migration; reuses SequenceService counter `student:{YEAR}` | M09 |
| Applicant/guardian data stored as SNAPSHOTS on `admission_applications` | applications are historical records; student/guardian master rows are created only at conversion via `StudentsService.create` (dedup + UID in one path, snapshots never drift with later edits) | M10 |
| Public phone verification = OTP → short-lived signed token (30 min, access secret) | no DB session for anonymous applicants; the token gates photo-upload/apply and pins the application to the verified phone | M10 |
| Live-duplicate partial unique excludes CANCELLED/REJECTED/EXPIRED | a rejected/cancelled applicant may legitimately reapply within the same cycle | M10 |
| Merit statuses are engine-owned; manual PUT /status limited to a transition map | SELECTED/PASSED/ADMITTED/EXPIRED must only come from marks/merit/convert/expiry endpoints — keeps the funnel auditable | M10 |
| reCAPTCHA fails OPEN on network errors (still fails CLOSED on Google rejection) | admissions must not go down with Google; empty secret disables entirely for dev/test | M10 |
| Mark entry does NOT SMS PASSED/FAILED (listener covers every other status) | marks get corrected/re-entered; the merit list (SELECTED/WAITLISTED) is the authoritative announcement | M10 |
| Enrollment uniques are PARTIAL (exclude CANCELLED + soft-deleted) | a CANCELLED enrollment must free both the (student, session) slot and the (session, section, roll) so the student can be re-enrolled | M11 |
| Renumber uses a two-phase negative-temp update | assigning 1…N in one pass would transiently collide with existing rolls under the partial unique index; parking every row at a negative roll first sidesteps it | M11 |
| Promotion capacity NOT enforced at execute (only interactive enroll/transfer) | promotion is an administrative bulk op; blocking mid-batch on capacity would strand students — capacity is an enroll-time concern | M11 |
| `EnrollmentsRepository` re-provided in AcademicModule (not importing EnrollmentModule) | the M06 section delete-guard needs an enrollment check, but EnrollmentModule imports AcademicModule — re-provisioning the stateless repo keeps the graph acyclic (same trick as TeachersRepository in M08) | M11 |
| Promotion rollback guard is a hook, always-allow for now | attendance (M12) / marks (M15) tables don't exist yet — the guard point is in `PromotionService.rollback` and must start blocking once they land | M11 |
| `student_attendances.section_id` denormalized from the enrollment AT MARKING TIME | a section transfer mutates `enrollments.section_id` in place, so reading the section through the enrollment would retro-move every past day into the new section; the monthly register must keep showing each day under the section the student actually sat in (roadmap M12 §8) | M12 |
| `staff_attendances` is polymorphic (`person_type` + `person_id`, no FK) | teachers and staff_profiles are deliberately separate tables (M08); one attendance table with a discriminator beats two near-identical tables or a forced merge, and matches the audit-log no-FK pattern | M12 |
| Attendance identity index uses COALESCE over `period_id` | daily-mode rows have NULL periods and Postgres treats NULLs as distinct — without COALESCE the "one record per student per date" rule would not hold (same trick as the M06 section identity index) | M12 |
| Holiday / re-mark / past-edit overrides are runtime permission checks in the service | one route serves the normal and the elevated case; only the override branch needs the extra code (PermissionsService lookup, Super Admin bypass) — the M08 assignment-override precedent | M12 |
| Auto-absent only fills sections that ALREADY have a mark that day | a teacher who never opened the sheet must not silently absent a whole class; a marked section is the signal that someone took the register | M12 |
| Absent-SMS dedupe is a column (`absent_notified_at`), not a separate log table | one row per student per day already exists — the flag makes the 15-minute job idempotent and the daily cap a simple `take` | M12 |
| Students with no primary guardian are flagged notified anyway | otherwise every 15-minute run re-logs the same warning for the rest of the day; the warning fires once and the gap shows up in the guardian data, where it belongs | M12 |
| `EmployeeDirectoryRepository` doesn't extend `BaseRepository` | the staff sheet's person list spans `teachers` and `staff_profiles`, and BaseRepository binds to exactly one model delegate — it stays a repository (services never touch Prisma, §4) with narrow selects and no business logic | M12 |
| Report JSON shapes and file renderers live in separate services | `AttendanceReportsService` owns the contract the UI reads; `AttendanceExportService` is pure presentation over those shapes, so XLSX/PDF can change without touching the API | M12 |
| Asia/Dhaka handled as a fixed +06:00 offset in `clock.util.ts` | Bangladesh has no DST, so the arithmetic is exact and needs no timezone library; revisit only if M31 onboards a DST-observing country | M12 |
| QR scanning uses the browser's `BarcodeDetector` with a manual fallback | no scanner dependency to vendor or keep current; unsupported browsers (and USB scanners, which just type) use the text field, which is the more reliable path at a school gate anyway | M12 |

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
- ~~**M03:** user role assignment has API only~~ — UI shipped as the M07 staff-detail Roles tab.
- **M03:** `audit_logs` monthly partitioning + retention deferred to M30. ~~users/roles FKs deferred~~ — added in M04.
- **M03→04:** `PermissionsCacheService` still owns its own Redis client — fold into the generic `RedisCacheService` during a quiet module.
- **M04:** gateway configs have no persisted `verified_at` state (test endpoints report pass/fail only); revisit with M16/M17.
- **M04:** in-browser logo-upload click-through pending (API/resize/signed-URL layers individually verified).
- ~~**M06:** `sections.class_teacher_id` is a bare UUID column~~ — FK added in M08.
- **M06:** "subject removal blocked once marks exist" guard slot in ClassSubjectsService awaits the M15 marks table.
- **M06:** one e2e suite leaves an open handle at teardown (`--forceExit` in use); chase with `--detectOpenHandles`.
- **M07:** in-browser photo/document upload click-through against MinIO pending (validation + storage layers individually verified — same status as the M04 logo).
- **M07:** temp password is returned in the reset API response (admin handover) — revisit once M17 makes SMS delivery real (config-gate the response field).
- **M08:** `TIMETABLE_CONFLICT_CHECKER` is a no-op — M13 MUST swap the provider; workload/schedule are assignment-count-based until then.
- **M08:** `teacher_qualifications.document_url` reserved but unused (certificate scans go through teacher_documents).
- **M08:** in-browser click-through pending: assignment matrix, leave inbox, teacher uploads (API layers e2e-tested).
- ~~**M09:** SECTION-scoped batch ID cards wait for M11 rosters~~ — shipped in M11 (`POST /sections/:id/id-cards`).
- **M09:** ID-card layout is one built-in CR80 template (branding wired); "template configurable" (roadmap) deferred.
- ~~**M09:** `attendance-history` returns an empty self-describing shape~~ — live since M12 (counts + % over MARKED days; the working-day denominator lives on `GET /attendance/reports/student/:id`). `performance-history` still waits for M15.
- **M09:** in-browser click-through pending: student photo/document upload, ID-card print preview (generation + storage e2e-tested).
- **M09:** multi-account holders (same contact across user types) reset via the OLDEST account until username login exists — revisit with the portals (M18).
- **M10:** server-side draft save/resume (phone+OTP) not implemented — public wizard keeps a localStorage draft only.
- **M10:** online payment + reconciliation-by-txn-id stubbed until M16 (`recordPayment` is the offline slot; `payment_ref/method/paid_at` columns are the callback landing zone).
- **M10:** ADMITTED students have no enrollment until M11 backfills (roadmap ordering note: run M11 before the first real admission cycle).
- **M10:** conversion = `StudentsService.create` (own tx) then application update — a crash between the two leaves a SELECTED app with an already-created student; re-admit reconciles manually.
- ~~**M10:** ADMITTED students have no enrollment until M11 backfills~~ — M11 has no dedicated backfill endpoint by design; ADMITTED→ACTIVE students surface in the `/enrollments/enrollable` picker and are enrolled via the normal single/bulk flow.
- **M11:** promotion execution does NOT enforce target-section capacity (interactive enroll/transfer do).
- ~~**M11:** promotion rollback guard is a no-op hook~~ — live since M12 for attendance (409 when the created enrollments have marks); **M15 must extend the same check to marks**.
- ~~**M11:** `enrollments.enrollment_date` … not yet consumed~~ — M12 consumes it (days before the join date never count toward attendance); fee proration still waits for M16.
- **M12:** period mode is schema-only — `period_id` is a bare UUID column and `attendance.mode` is unused until M13 adds periods, the FK and the per-period UI.
- **M12:** QR check-in always resolves the CURRENT session's enrollment, so the accepted `date` parameter cannot back-date across a session boundary.
- **M12:** the attendance percentage counts LEAVE in the denominator (the roadmap formula) — schools wanting approved leave excluded need a new setting.
- **M12:** `AutoAbsentJob`/`AbsentSmsJob` loop every school every 15 minutes — fine at one school, shard or queue for M31.
- **M12:** absent SMS is queued only (log-only until M17 wires the gateway).
- **M12:** attendance PDF exports are plain tables (no branding) until the M18 report engine; the daily roll-up loads each section's roster in a loop.
- **M12:** in-browser click-throughs pending: QR scanner on a real phone camera, and the marking grid with 100+ students (virtualization deferred).
- **M11:** in-browser click-throughs pending: enroll picker, promotion wizard, section batch ID cards (API layers e2e-tested).
- **Cross-module (pre-M09):** `school.e2e-spec` "PUT /school writes an audit diff" is flaky — it reads the fire-and-forget audit row immediately after the mutation (§16 "audit writes fire-and-forget"), so it loses the race under load. Poll for the row (as other suites do) when next touching that suite.
